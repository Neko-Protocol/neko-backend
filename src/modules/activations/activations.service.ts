import {
  BadGatewayException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BASE_FEE,
  Memo,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  buildNativePaymentOperation,
  matchesNativePayout,
  parseSignedTransaction,
} from "../../shared/stellar/payment-xdr";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { SupabaseService } from "@core/supabase/supabase.service";
import { EmailService } from "@core/email/email.service";
import { CreateActivationDto } from "./dto/create-activation.dto";
import { PrepareBatchPayoutDto } from "./dto/prepare-batch-payout.dto";
import { PreparePayoutDto } from "./dto/prepare-payout.dto";
import { SubmitBatchPayoutDto } from "./dto/submit-batch-payout.dto";
import { SubmitPayoutDto } from "./dto/submit-payout.dto";

const PAYOUT_MEMO = "neko-activation";
const STALE_PAYING_MS = 10 * 60 * 1000;
const FEE_MULTIPLIER = 10;
const ACTIVATION_INVITE_TEMPLATE = "activation-invite";
const ACTIVATION_PAYOUT_TEMPLATE = "activation-payout";

export interface ActivationSummary {
  id: string;
  name: string;
  reward_xlm: number;
  expires_at: string;
  created_by: string | null;
  created_at: string;
  counts: { total: number; pending: number; payable: number; paid: number };
}

export interface ActivationParticipant {
  id: string;
  activation_id: string;
  email: string;
  status: "pending" | "payable" | "paying" | "paid";
  matched_wallet: string | null;
  matched_at: string | null;
  paid_tx_hash: string | null;
  paid_by: string | null;
  paid_at: string | null;
  paid_amount_xlm: number | null;
}

@Injectable()
export class ActivationsService {
  private readonly logger = new Logger(ActivationsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly stellar: StellarRpcService,
    private readonly config: ConfigService,
    private readonly email: EmailService
  ) {}

  private dbNetwork(): string {
    const envNet =
      this.config.get<string>("STELLAR_NETWORK")?.trim().toUpperCase() ?? "";
    if (envNet === "MAINNET" || envNet === "PUBLIC") return "mainnet";
    return "testnet";
  }

  private async reconcile(activationId?: string): Promise<void> {
    const { error } = await this.supabase.client.rpc("activation_reconcile", {
      p_activation_id: activationId ?? null,
    });
    if (error) {
      this.logger.error(`activation_reconcile failed: ${error.message}`);
    }
  }

  async create(dto: CreateActivationDto) {
    const emails = Array.from(
      new Set(dto.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))
    );
    if (!emails.length) {
      throw new UnprocessableEntityException({
        code: "NO_EMAILS",
        message: "At least one valid email is required.",
      });
    }

    const { data: activation, error } = await this.supabase.client
      .from("activations")
      .insert({
        name: dto.name.trim(),
        reward_xlm: dto.reward_xlm,
        expires_at: dto.expires_at,
        created_by: dto.created_by?.trim() || null,
      })
      .select("*")
      .single();

    if (error || !activation) {
      this.logger.error(`create activation failed: ${error?.message}`);
      throw new InternalServerErrorException({ code: "CREATE_FAILED" });
    }

    const { error: participantsError } = await this.supabase.client
      .from("activation_participants")
      .insert(emails.map((email) => ({ activation_id: activation.id, email })));

    if (participantsError) {
      await this.supabase.client
        .from("activations")
        .delete()
        .eq("id", activation.id);
      this.logger.error(
        `create participants failed: ${participantsError.message}`
      );
      throw new InternalServerErrorException({ code: "CREATE_FAILED" });
    }

    if (dto.send_invites) {
      await this.sendInviteEmails(activation, emails);
    }

    return { ...activation, email_count: emails.length };
  }

  async sendInvites(activationId: string): Promise<{ sent: number }> {
    const activation = await this.loadActivation(activationId);

    const { data: rows, error } = await this.supabase.client
      .from("activation_participants")
      .select("email")
      .eq("activation_id", activationId)
      .eq("status", "pending");

    if (error) {
      throw new InternalServerErrorException({ code: "GET_FAILED" });
    }

    const emails = (rows ?? []).map((r) => r.email as string);
    await this.sendInviteEmails(activation, emails);
    return { sent: emails.length };
  }

  async list(): Promise<ActivationSummary[]> {
    await this.reconcile();

    const [{ data: activations, error }, { data: rows, error: rowsError }] =
      await Promise.all([
        this.supabase.client
          .from("activations")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
        this.supabase.client
          .from("activation_participants")
          .select("activation_id, status"),
      ]);

    if (error || rowsError) {
      this.logger.error(
        `list activations failed: ${error?.message ?? rowsError?.message}`
      );
      throw new InternalServerErrorException({ code: "LIST_FAILED" });
    }

    const counts = new Map<
      string,
      { total: number; pending: number; payable: number; paid: number }
    >();
    for (const row of rows ?? []) {
      const c = counts.get(row.activation_id) ?? {
        total: 0,
        pending: 0,
        payable: 0,
        paid: 0,
      };
      c.total += 1;
      if (row.status === "pending") c.pending += 1;
      else if (row.status === "payable" || row.status === "paying")
        c.payable += 1;
      else if (row.status === "paid") c.paid += 1;
      counts.set(row.activation_id, c);
    }

    return (activations ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      reward_xlm: Number(a.reward_xlm),
      expires_at: a.expires_at,
      created_by: a.created_by,
      created_at: a.created_at,
      counts: counts.get(a.id) ?? {
        total: 0,
        pending: 0,
        payable: 0,
        paid: 0,
      },
    }));
  }

  async getById(id: string) {
    await this.reconcile(id);

    const [{ data: activation, error }, { data: participants, error: pErr }] =
      await Promise.all([
        this.supabase.client
          .from("activations")
          .select("*")
          .eq("id", id)
          .maybeSingle(),
        this.supabase.client
          .from("activation_participants")
          .select(
            "id, activation_id, email, status, matched_wallet, matched_at, paid_tx_hash, paid_by, paid_at, paid_amount_xlm"
          )
          .eq("activation_id", id)
          .order("email"),
      ]);

    if (error || pErr) {
      throw new InternalServerErrorException({ code: "GET_FAILED" });
    }
    if (!activation) {
      throw new NotFoundException({ code: "ACTIVATION_NOT_FOUND" });
    }

    return {
      ...activation,
      reward_xlm: Number(activation.reward_xlm),
      participants: (participants ?? []) as ActivationParticipant[],
    };
  }

  async listPayable() {
    await this.reconcile();

    const { data, error } = await this.supabase.client
      .from("activation_participants")
      .select(
        "id, activation_id, email, status, matched_wallet, matched_at, activations(name, reward_xlm, expires_at)"
      )
      .eq("status", "payable")
      .order("matched_at", { ascending: true });

    if (error) {
      throw new InternalServerErrorException({ code: "LIST_PAYABLE_FAILED" });
    }
    return data ?? [];
  }

  async preparePayout(dto: PreparePayoutDto) {
    const participant = await this.loadParticipant(dto.participant_id);
    const activation = await this.loadActivation(participant.activation_id);
    const rewardXlm = Number(activation.reward_xlm);

    if (!participant.matched_wallet) {
      throw new UnprocessableEntityException({
        code: "NOT_MATCHED",
        message: "Participant has no matched wallet.",
      });
    }
    if (participant.matched_wallet === dto.admin_wallet) {
      throw new UnprocessableEntityException({
        code: "SELF_PAYOUT",
        message: "Recipient and paying wallet are the same account.",
      });
    }

    await this.lockForPaying(participant);

    try {
      const horizon = this.stellar.horizon;
      const destination = participant.matched_wallet;

      let destinationExists = true;
      try {
        await horizon.loadAccount(destination);
      } catch (err) {
        if (this.isHorizonNotFound(err)) destinationExists = false;
        else throw err;
      }

      if (!destinationExists && rewardXlm < 1) {
        throw new UnprocessableEntityException({
          code: "UNFUNDED_RECIPIENT",
          message:
            "Recipient account is unfunded and the reward is below the 1 XLM minimum needed to create it.",
        });
      }

      const source = await horizon.loadAccount(dto.admin_wallet);
      const amount = rewardXlm.toFixed(7);

      const tx = new TransactionBuilder(source, {
        fee: (parseInt(BASE_FEE, 10) * FEE_MULTIPLIER).toString(),
        networkPassphrase: this.stellar.getNetworkPassphrase(),
      })
        .addOperation(
          buildNativePaymentOperation({
            destination,
            amount,
            createAccount: !destinationExists,
          })
        )
        .addMemo(Memo.text(PAYOUT_MEMO))
        .setTimeout(300)
        .build();

      return {
        participant_id: participant.id,
        xdr: tx.toXDR(),
        network_passphrase: this.stellar.getNetworkPassphrase(),
        destination,
        reward_xlm: rewardXlm,
        creates_account: !destinationExists,
      };
    } catch (err) {
      await this.unlock(participant.id);
      if (err instanceof UnprocessableEntityException) throw err;
      if (this.isHorizonNotFound(err)) {
        throw new UnprocessableEntityException({
          code: "ADMIN_ACCOUNT_NOT_FOUND",
          message: "Paying account not found on the network.",
        });
      }
      this.logger.error(`preparePayout failed: ${String(err)}`);
      throw new BadGatewayException({ code: "HORIZON_ERROR" });
    }
  }

  async submitPayout(dto: SubmitPayoutDto) {
    const participant = await this.loadParticipant(dto.participant_id);
    if (participant.status !== "paying") {
      throw new ConflictException({
        code: participant.status === "paid" ? "ALREADY_PAID" : "NOT_PAYING",
        message: `Participant is '${participant.status}', expected 'paying'.`,
      });
    }
    const activation = await this.loadActivation(participant.activation_id);
    const rewardXlm = Number(activation.reward_xlm);

    const tx = this.parseAndValidateXdr(dto.signed_xdr, participant, rewardXlm);

    try {
      const result = await this.stellar.horizon.submitTransaction(tx);

      const { data: updated } = await this.supabase.client
        .from("activation_participants")
        .update({
          status: "paid",
          paid_tx_hash: result.hash,
          paid_by: tx.source,
          paid_at: new Date().toISOString(),
          paid_amount_xlm: rewardXlm,
          payout_started_at: null,
        })
        .eq("id", participant.id)
        .eq("status", "paying")
        .select("id");

      if (!updated?.length) {
        this.logger.warn(
          `payout submitted but row ${participant.id} was not in 'paying' state`
        );
      }

      await this.recordPayoutAudit(participant, rewardXlm, result.hash);

      await this.sendPayoutConfirmation({
        to: participant.email,
        activationName: activation.name,
        amountXlm: rewardXlm,
        wallet: participant.matched_wallet!,
        txHash: result.hash,
        paidAtISO: new Date().toISOString(),
      });

      return {
        ok: true,
        tx_hash: result.hash,
        participant_id: participant.id,
      };
    } catch (err) {
      await this.unlock(participant.id);
      const codes = this.extractHorizonResultCodes(err);
      this.logger.error(
        `submitPayout failed for ${participant.id}: ${codes ?? String(err)}`
      );
      throw new BadGatewayException({
        code: "SUBMIT_FAILED",
        message: codes
          ? `Transaction rejected: ${codes}`
          : "Failed to submit the payment to the network.",
      });
    }
  }

  async cancelPayout(participantId: string) {
    await this.unlock(participantId);
    return { ok: true };
  }

  async prepareBatchPayout(dto: PrepareBatchPayoutDto) {
    const activation = await this.loadActivation(dto.activation_id);
    const rewardXlm = Number(activation.reward_xlm);

    const { data: payableRows, error: listError } = await this.supabase.client
      .from("activation_participants")
      .select("*")
      .eq("activation_id", dto.activation_id)
      .eq("status", "payable")
      .order("matched_at", { ascending: true });

    if (listError) {
      throw new InternalServerErrorException({ code: "GET_FAILED" });
    }
    if (!payableRows?.length) {
      throw new UnprocessableEntityException({
        code: "NO_PAYABLE",
        message: "No payable participants for this activation.",
      });
    }

    const remainingPayable = Math.max(0, payableRows.length - 100);
    const chunk = payableRows.slice(0, 100);
    const eligible = chunk.filter(
      (p) => p.matched_wallet && p.matched_wallet !== dto.admin_wallet
    );

    if (!eligible.length) {
      throw new UnprocessableEntityException({
        code: "SELF_PAYOUT_ONLY",
        message: "All participants in this chunk pay to the admin wallet.",
      });
    }

    const locked: typeof eligible = [];
    for (const participant of eligible) {
      const ok = await this.tryLockForPaying(participant);
      if (ok) locked.push(participant);
    }

    if (!locked.length) {
      throw new ConflictException({
        code: "ALL_LOCKED",
        message: "All eligible participants are already being paid.",
      });
    }

    const lockedIds = locked.map((p) => p.id);

    try {
      const horizon = this.stellar.horizon;
      const source = await horizon.loadAccount(dto.admin_wallet);
      const amount = rewardXlm.toFixed(7);
      const included: typeof locked = [];
      const operations: ReturnType<typeof buildNativePaymentOperation>[] = [];

      for (const participant of locked) {
        const destination = participant.matched_wallet!;
        let destinationExists = true;
        try {
          await horizon.loadAccount(destination);
        } catch (err) {
          if (this.isHorizonNotFound(err)) destinationExists = false;
          else throw err;
        }

        if (!destinationExists && rewardXlm < 1) {
          await this.unlock(participant.id);
          continue;
        }

        included.push(participant);
        operations.push(
          buildNativePaymentOperation({
            destination,
            amount,
            createAccount: !destinationExists,
          })
        );
      }

      if (!operations.length) {
        throw new UnprocessableEntityException({
          code: "NO_ELIGIBLE",
          message:
            "No participants could be included (e.g. unfunded accounts below 1 XLM).",
        });
      }

      const opCount = operations.length;
      let builder = new TransactionBuilder(source, {
        fee: (parseInt(BASE_FEE, 10) * opCount * FEE_MULTIPLIER).toString(),
        networkPassphrase: this.stellar.getNetworkPassphrase(),
      })
        .addMemo(Memo.text(PAYOUT_MEMO))
        .setTimeout(300);

      for (const op of operations) {
        builder = builder.addOperation(op);
      }

      const tx = builder.build();

      return {
        activation_id: dto.activation_id,
        xdr: tx.toXDR(),
        network_passphrase: this.stellar.getNetworkPassphrase(),
        participant_ids: included.map((p) => p.id),
        reward_xlm: rewardXlm,
        op_count: opCount,
        remaining_payable: remainingPayable,
      };
    } catch (err) {
      await Promise.all(lockedIds.map((id) => this.unlock(id)));
      if (
        err instanceof UnprocessableEntityException ||
        err instanceof ConflictException
      ) {
        throw err;
      }
      if (this.isHorizonNotFound(err)) {
        throw new UnprocessableEntityException({
          code: "ADMIN_ACCOUNT_NOT_FOUND",
          message: "Paying account not found on the network.",
        });
      }
      this.logger.error(`prepareBatchPayout failed: ${String(err)}`);
      throw new BadGatewayException({ code: "HORIZON_ERROR" });
    }
  }

  async submitBatchPayout(dto: SubmitBatchPayoutDto) {
    const activation = await this.loadActivation(dto.activation_id);
    const rewardXlm = Number(activation.reward_xlm);

    const { data: rows, error } = await this.supabase.client
      .from("activation_participants")
      .select("*")
      .in("id", dto.participant_ids)
      .eq("activation_id", dto.activation_id);

    if (error) {
      throw new InternalServerErrorException({ code: "GET_FAILED" });
    }

    const paying = (rows ?? []).filter(
      (p) => p.status === "paying" && p.matched_wallet
    );

    if (!paying.length) {
      throw new ConflictException({
        code: "NOT_PAYING",
        message: "No participants in 'paying' state for this batch.",
      });
    }

    let tx: Transaction;
    try {
      tx = this.parseAndValidateBatchXdr(dto.signed_xdr, paying, rewardXlm);
    } catch (err) {
      if (err instanceof UnprocessableEntityException) {
        await Promise.all(paying.map((p) => this.unlock(p.id)));
      }
      throw err;
    }

    try {
      const result = await this.stellar.horizon.submitTransaction(tx);
      let paid = 0;
      const covered: typeof paying = [];

      for (const participant of paying) {
        const { data: updated } = await this.supabase.client
          .from("activation_participants")
          .update({
            status: "paid",
            paid_tx_hash: result.hash,
            paid_by: tx.source,
            paid_at: new Date().toISOString(),
            paid_amount_xlm: rewardXlm,
            payout_started_at: null,
          })
          .eq("id", participant.id)
          .eq("status", "paying")
          .select("id");

        if (updated?.length) {
          paid += 1;
          covered.push(participant);
          await this.recordPayoutAudit(participant, rewardXlm, result.hash);
        } else {
          this.logger.warn(
            `batch payout submitted but row ${participant.id} was not in 'paying' state`
          );
        }
      }

      await Promise.allSettled(
        covered.map((participant) =>
          this.sendPayoutConfirmation({
            to: participant.email,
            activationName: activation.name,
            amountXlm: rewardXlm,
            wallet: participant.matched_wallet!,
            txHash: result.hash,
            paidAtISO: new Date().toISOString(),
          })
        )
      );

      return { ok: true, tx_hash: result.hash, paid };
    } catch (err) {
      await Promise.all(paying.map((p) => this.unlock(p.id)));
      const codes = this.extractHorizonResultCodes(err);
      this.logger.error(
        `submitBatchPayout failed for activation ${dto.activation_id}: ${codes ?? String(err)}`
      );
      throw new BadGatewayException({
        code: "SUBMIT_FAILED",
        message: codes
          ? `Transaction rejected: ${codes}`
          : "Failed to submit the payment to the network.",
      });
    }
  }

  // ---- helpers ----

  private async loadParticipant(id: string) {
    const { data, error } = await this.supabase.client
      .from("activation_participants")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException({ code: "GET_FAILED" });
    }
    if (!data) {
      throw new NotFoundException({ code: "PARTICIPANT_NOT_FOUND" });
    }
    return data;
  }

  private async loadActivation(id: string) {
    const { data, error } = await this.supabase.client
      .from("activations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) {
      throw new NotFoundException({ code: "ACTIVATION_NOT_FOUND" });
    }
    return data;
  }

  /**
   * Transitions payable -> paying with an affected-rows check so two admins
   * can never prepare the same payout. A stale 'paying' lock (browser closed
   * mid-flow) is reclaimable after STALE_PAYING_MS.
   */
  private async lockForPaying(participant: {
    id: string;
    status: string;
    payout_started_at: string | null;
  }) {
    const now = new Date().toISOString();
    const { data: locked } = await this.supabase.client
      .from("activation_participants")
      .update({ status: "paying", payout_started_at: now })
      .eq("id", participant.id)
      .eq("status", "payable")
      .select("id");

    if (locked?.length) return;

    const staleCutoff = new Date(Date.now() - STALE_PAYING_MS).toISOString();
    const { data: reclaimed } = await this.supabase.client
      .from("activation_participants")
      .update({ payout_started_at: now })
      .eq("id", participant.id)
      .eq("status", "paying")
      .lt("payout_started_at", staleCutoff)
      .select("id");

    if (reclaimed?.length) return;

    const fresh = await this.loadParticipant(participant.id);
    throw new ConflictException({
      code: fresh.status === "paid" ? "ALREADY_PAID" : "ALREADY_PAYING",
      message: `Participant is '${fresh.status}'.`,
    });
  }

  private async tryLockForPaying(participant: {
    id: string;
    status: string;
    payout_started_at: string | null;
  }): Promise<boolean> {
    try {
      await this.lockForPaying(participant);
      return true;
    } catch {
      return false;
    }
  }

  private async unlock(participantId: string) {
    await this.supabase.client
      .from("activation_participants")
      .update({ status: "payable", payout_started_at: null })
      .eq("id", participantId)
      .eq("status", "paying");
  }

  private parseTransactionFromXdr(signedXdr: string): Transaction {
    const tx = parseSignedTransaction(
      signedXdr,
      this.stellar.getNetworkPassphrase()
    );
    if (!tx) {
      throw new UnprocessableEntityException({
        code: "INVALID_XDR",
        message: "Could not parse the signed transaction.",
      });
    }
    return tx;
  }

  /**
   * Re-derives the expected destination/amount from our own DB row before
   * submitting, so a tampered client cannot redirect or resize the payment.
   */
  private parseAndValidateXdr(
    signedXdr: string,
    participant: { matched_wallet: string | null },
    rewardXlm: number
  ): Transaction {
    const tx = this.parseTransactionFromXdr(signedXdr);
    const expectedAmount = rewardXlm.toFixed(7);
    const op = tx.operations.length === 1 ? tx.operations[0] : null;

    if (
      !op ||
      !participant.matched_wallet ||
      !matchesNativePayout(op, participant.matched_wallet, expectedAmount)
    ) {
      throw new UnprocessableEntityException({
        code: "XDR_MISMATCH",
        message:
          "Signed transaction does not match the expected payout destination/amount.",
      });
    }
    return tx;
  }

  private parseAndValidateBatchXdr(
    signedXdr: string,
    participants: Array<{ id: string; matched_wallet: string | null }>,
    rewardXlm: number
  ): Transaction {
    const tx = this.parseTransactionFromXdr(signedXdr);
    const expectedAmount = rewardXlm.toFixed(7);
    const expectedDestinations = new Set(
      participants.map((p) => p.matched_wallet).filter(Boolean) as string[]
    );

    if (tx.operations.length !== expectedDestinations.size) {
      throw new UnprocessableEntityException({
        code: "XDR_MISMATCH",
        message:
          "Signed transaction does not match the expected payout destination/amount.",
      });
    }

    const matchedDestinations = new Set<string>();
    for (const op of tx.operations) {
      const destination =
        op.type === "payment" || op.type === "createAccount"
          ? op.destination
          : null;
      if (
        !destination ||
        !expectedDestinations.has(destination) ||
        matchedDestinations.has(destination) ||
        !matchesNativePayout(op, destination, expectedAmount)
      ) {
        throw new UnprocessableEntityException({
          code: "XDR_MISMATCH",
          message:
            "Signed transaction does not match the expected payout destination/amount.",
        });
      }
      matchedDestinations.add(destination);
    }

    return tx;
  }

  private async sendPayoutConfirmation(params: {
    to: string;
    activationName: string;
    amountXlm: number;
    wallet: string;
    txHash: string;
    paidAtISO: string;
  }): Promise<void> {
    try {
      await this.email.sendTemplate({
        to: params.to,
        templateId: ACTIVATION_PAYOUT_TEMPLATE,
        variables: {
          activation_name: params.activationName,
          amount_xlm: params.amountXlm,
          wallet: params.wallet,
          paid_at: new Date(params.paidAtISO).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
          tx_hash: params.txHash,
        },
      });
    } catch (err) {
      this.logger.warn(`payout confirmation email failed: ${String(err)}`);
    }
  }

  private async sendInviteEmails(
    activation: {
      name: string;
      reward_xlm: number | string;
      expires_at: string;
    },
    emails: string[]
  ): Promise<void> {
    if (!emails.length) return;

    const messages = emails.map((email) => ({
      to: email,
      templateId: ACTIVATION_INVITE_TEMPLATE,
      variables: {
        activation_name: activation.name,
        reward_xlm: Number(activation.reward_xlm),
        participant_email: email,
        expires_at: new Date(activation.expires_at).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      },
    }));

    try {
      await this.email.sendTemplateBatch(messages);
    } catch (err) {
      this.logger.warn(`activation invite emails failed: ${String(err)}`);
    }
  }

  /**
   * Mirrors the web-app /api/audit USD pricing so the external volume-counting
   * pipeline sees activation payouts like any other transaction.
   */
  private async recordPayoutAudit(
    participant: { matched_wallet: string | null },
    rewardXlm: number,
    txHash: string
  ) {
    try {
      let amountInUsd: number | null = null;
      const { data: priceRow } = await this.supabase.client
        .from("asset_price_history")
        .select("price")
        .eq("symbol", "XLM")
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (priceRow?.price && priceRow.price > 0) {
        amountInUsd = rewardXlm * priceRow.price;
      }

      const { error } = await this.supabase.client.from("audit_logs").insert({
        wallet_address: participant.matched_wallet,
        action_type: "activation_payout",
        asset_in: "XLM",
        token_amount_in: rewardXlm,
        amount_in: amountInUsd,
        network: this.dbNetwork(),
        tx_hash: txHash,
      });
      if (error) {
        this.logger.error(`payout audit insert failed: ${error.message}`);
      }
    } catch (err) {
      this.logger.error(`payout audit insert failed: ${String(err)}`);
    }
  }

  private isHorizonNotFound(err: unknown): boolean {
    return (
      (err as { response?: { status?: number } })?.response?.status === 404
    );
  }

  private extractHorizonResultCodes(err: unknown): string | null {
    const extras = (
      err as {
        response?: {
          data?: {
            extras?: {
              result_codes?: { transaction?: string; operations?: string[] };
            };
          };
        };
      }
    )?.response?.data?.extras;
    if (!extras?.result_codes) return null;
    const { transaction, operations } = extras.result_codes;
    return [transaction, ...(operations ?? [])].filter(Boolean).join(", ");
  }
}
