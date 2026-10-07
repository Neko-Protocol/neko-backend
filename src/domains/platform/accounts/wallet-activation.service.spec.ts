import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Account,
  Asset,
  Keypair,
  Networks,
  NotFoundError,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { assertActivationOnly } from "@neko-protocol/wallet-core";
import { createMockWallet } from "@neko-protocol/wallet-core/mock";
import { PrivyService } from "@core/privy/privy.service";
import { SponsorService } from "@core/stellar/sponsor.service";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { TrustlineResolver } from "@core/stellar/trustline-resolver";
import { TransactionService } from "@domains/chain/transaction/transaction.service";
import { FakeSupabase } from "../../../../test/helpers/fake-supabase";
import { AccountsService } from "./accounts.service";
import { WalletActivationService } from "./wallet-activation.service";

const PASSPHRASE = Networks.PUBLIC;
const PRINCIPAL = { userId: "did:privy:ana", sessionId: "s1" };
const SPONSOR = Keypair.random();
const USDC = new Asset("USDC", Keypair.random().publicKey());
const USDC_ID = `USDC:${USDC.getIssuer()}`;

type Balances = {
  asset_type: string;
  balance?: string;
  asset_code?: string;
  asset_issuer?: string;
}[];

function setup(
  opts: {
    userOnChain?: Balances;
    sponsorXlm?: string;
    sendStatus?: "SUCCESS" | "FAILED" | "PENDING";
    userSponsor?: string;
    dailyCap?: number;
    maxTrustlines?: number;
  } = {}
) {
  const user = createMockWallet();
  const wallets = new Map([[PRINCIPAL.userId, user]]);
  const db = new FakeSupabase();
  const env: Record<string, unknown> = {
    STELLAR_NETWORK: "mainnet",
    SPONSOR_SECRET_KEY: SPONSOR.secret(),
    SPONSOR_TRUSTLINES: USDC_ID,
    SPONSOR_DAILY_ACTIVATION_CAP: opts.dailyCap ?? 100,
    SPONSOR_MAX_TRUSTLINES_PER_WALLET: opts.maxTrustlines,
  };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;

  const loadAccount = jest.fn(async (address: string) => {
    if (address === SPONSOR.publicKey()) {
      return {
        balances: [{ asset_type: "native", balance: opts.sponsorXlm ?? "200" }],
      };
    }
    if (opts.userOnChain) {
      return { balances: opts.userOnChain, sponsor: opts.userSponsor };
    }
    throw new NotFoundError("not found", {});
  });
  const stellar = {
    getNetworkPassphrase: () => PASSPHRASE,
    horizon: { loadAccount },
    rpc: { getAccount: async (a: string) => new Account(a, "100") },
  } as unknown as StellarRpcService;

  const privy = {
    getUser: async (userId: string) => ({
      userId,
      email: `${userId}@example.com`,
      stellarWallets: [
        { address: wallets.get(userId)!.address, walletId: `pw_${userId}` },
      ],
    }),
  } as unknown as PrivyService;

  const accounts = new AccountsService(db.asService(), privy, config);
  const sponsor = new SponsorService(config, stellar);
  const sendAndWait = jest.fn(async (tx: { hash(): Buffer }) => ({
    status: opts.sendStatus ?? "SUCCESS",
    hash: tx.hash().toString("hex"),
  }));
  const service = new WalletActivationService(
    accounts,
    sponsor,
    stellar,
    { sendAndWait } as unknown as TransactionService,
    db.asService(),
    config,
    new TrustlineResolver(stellar)
  );
  /** Signs up another Privy user with their own wallet. */
  const addUser = async (userId: string) => {
    const wallet = createMockWallet();
    wallets.set(userId, wallet);
    const principal = { userId, sessionId: `s-${userId}` };
    await accounts.bootstrap(principal);
    return { principal, wallet };
  };
  return { user, db, accounts, service, sendAndWait, addUser };
}

describe("WalletActivationService", () => {
  beforeAll(() => Logger.overrideLogger(false));

  it("prepare -> client guard -> sign -> submit activates the wallet", async () => {
    const { user, accounts, service, sendAndWait, db } = setup();
    await accounts.bootstrap(PRINCIPAL);

    const prepared = await service.prepare(PRINCIPAL);
    expect(prepared.sponsor_address).toBe(SPONSOR.publicKey());
    expect(prepared.network_passphrase).toBe(PASSPHRASE);

    // What the app does before signing.
    expect(() =>
      assertActivationOnly({
        xdr: prepared.xdr,
        networkPassphrase: prepared.network_passphrase,
        sponsor: prepared.sponsor_address,
        user: user.address,
        allowedTrustlines: [USDC_ID],
      })
    ).not.toThrow();

    const tx = TransactionBuilder.fromXDR(prepared.xdr, PASSPHRASE);
    expect(tx.operations.map((o) => o.type)).toEqual([
      "beginSponsoringFutureReserves",
      "createAccount",
      "changeTrust",
      "endSponsoringFutureReserves",
    ]);
    expect(tx.signatures).toHaveLength(1);

    const signedXdr = await user.signTransaction(prepared.xdr, {
      networkPassphrase: PASSPHRASE,
    });
    const res = await service.submit(PRINCIPAL, signedXdr);

    expect(sendAndWait).toHaveBeenCalledTimes(1);
    const sent = sendAndWait.mock.calls[0][0] as unknown as {
      signatures: unknown[];
    };
    expect(sent.signatures).toHaveLength(2);
    expect(res.hash).toBe(prepared.hash);
    expect(res.wallet.activation_status).toBe("activated");
    expect(res.wallet.activation_tx_hash).toBe(prepared.hash);
    expect(db.rows("wallet_activations")[0]).toMatchObject({
      status: "activated",
      sponsor_address: SPONSOR.publicKey(),
    });
  });

  it("only opens missing trustlines when the account already exists", async () => {
    const { accounts, service } = setup({
      userOnChain: [{ asset_type: "native", balance: "0" }],
    });
    await accounts.bootstrap(PRINCIPAL);

    const prepared = await service.prepare(PRINCIPAL);
    const tx = TransactionBuilder.fromXDR(prepared.xdr, PASSPHRASE);
    expect(tx.operations.map((o) => o.type)).toEqual([
      "beginSponsoringFutureReserves",
      "changeTrust",
      "endSponsoringFutureReserves",
    ]);
  });

  it("marks an already usable account activated and answers ALREADY_ACTIVATED", async () => {
    const { accounts, service } = setup({
      userOnChain: [
        { asset_type: "native", balance: "0" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: USDC.getIssuer(),
          balance: "0",
        },
      ],
    });
    await accounts.bootstrap(PRINCIPAL);

    await expect(service.prepare(PRINCIPAL)).rejects.toMatchObject({
      response: { code: "ALREADY_ACTIVATED" },
    });
    const me = await accounts.me(PRINCIPAL);
    expect(me.wallets[0].activation_status).toBe("activated");
    await expect(service.prepare(PRINCIPAL)).rejects.toMatchObject({
      response: { code: "ALREADY_ACTIVATED" },
    });
  });

  it("refuses when the sponsor is nearly empty", async () => {
    const { accounts, service } = setup({ sponsorXlm: "1" });
    await accounts.bootstrap(PRINCIPAL);
    await expect(service.prepare(PRINCIPAL)).rejects.toMatchObject({
      response: { code: "SPONSOR_UNAVAILABLE" },
    });
  });

  it("rejects a submit that differs from what was prepared", async () => {
    const { user, accounts, service, sendAndWait } = setup();
    await accounts.bootstrap(PRINCIPAL);
    await service.prepare(PRINCIPAL);

    // A different, user-built transaction signed by the user.
    const forged = new TransactionBuilder(new Account(user.address, "1"), {
      fee: "100",
      networkPassphrase: PASSPHRASE,
    })
      .setTimeout(60)
      .addOperation(
        (await import("@stellar/stellar-sdk")).Operation.bumpSequence({
          bumpTo: "2",
        })
      )
      .build();
    const signed = await user.signTransaction(forged.toXDR(), {
      networkPassphrase: PASSPHRASE,
    });

    await expect(service.submit(PRINCIPAL, signed)).rejects.toMatchObject({
      response: { code: "ACTIVATION_TX_MISMATCH" },
    });
    expect(sendAndWait).not.toHaveBeenCalled();
  });

  it("rejects a submit without a prior prepare", async () => {
    const { accounts, service } = setup();
    await accounts.bootstrap(PRINCIPAL);
    const prepared = await service.prepare(PRINCIPAL);
    await service.submit(PRINCIPAL, prepared.xdr).catch(() => undefined);

    // Replay of the same XDR: the prepared entry is one-shot.
    await expect(service.submit(PRINCIPAL, prepared.xdr)).rejects.toMatchObject(
      { response: { code: "ACTIVATION_TX_MISMATCH" } }
    );
  });

  it("records a failed activation", async () => {
    const { user, accounts, service } = setup({ sendStatus: "FAILED" });
    await accounts.bootstrap(PRINCIPAL);
    const prepared = await service.prepare(PRINCIPAL);
    const signed = await user.signTransaction(prepared.xdr, {
      networkPassphrase: PASSPHRASE,
    });

    const res = await service.submit(PRINCIPAL, signed);
    expect(res.wallet.activation_status).toBe("failed");
  });

  it("serialises activations: a second user waits until the first submits", async () => {
    const { user, accounts, service, addUser } = setup();
    await accounts.bootstrap(PRINCIPAL);
    const bob = await addUser("did:privy:bob");

    const first = await service.prepare(PRINCIPAL);
    let secondDone = false;
    const second = service.prepare(bob.principal).then((r) => {
      secondDone = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(secondDone).toBe(false);

    const signed = await user.signTransaction(first.xdr, {
      networkPassphrase: PASSPHRASE,
    });
    await service.submit(PRINCIPAL, signed);
    await expect(second).resolves.toMatchObject({
      sponsor_address: SPONSOR.publicKey(),
    });
  });

  it("releases the lease when a submit is rejected", async () => {
    const { accounts, service, addUser } = setup();
    await accounts.bootstrap(PRINCIPAL);
    const bob = await addUser("did:privy:bob");

    await service.prepare(PRINCIPAL);
    await expect(service.submit(PRINCIPAL, "AAAA")).rejects.toBeDefined();
    await expect(service.prepare(bob.principal)).resolves.toBeDefined();
  });

  it("enforces the daily cap on new wallets but not on retries", async () => {
    const { accounts, service, addUser } = setup({ dailyCap: 1 });
    await accounts.bootstrap(PRINCIPAL);
    const bob = await addUser("did:privy:bob");

    await service.prepare(PRINCIPAL);
    await expect(service.prepare(bob.principal)).rejects.toMatchObject({
      response: { code: "ACTIVATION_LIMIT_REACHED" },
    });
    // Ana already started, so her retry is not a new activation.
    await expect(service.prepare(PRINCIPAL)).resolves.toBeDefined();
  });

  it.each([
    ["not ours", undefined, null],
    ["ours", SPONSOR.publicKey(), SPONSOR.publicKey()],
  ])(
    "records the on-chain sponsor of an already usable account (%s)",
    async (_label, userSponsor, expected) => {
      const { accounts, service, db } = setup({
        userSponsor,
        userOnChain: [
          { asset_type: "native", balance: "0" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: USDC.getIssuer(),
            balance: "0",
          },
        ],
      });
      await accounts.bootstrap(PRINCIPAL);
      await expect(service.prepare(PRINCIPAL)).rejects.toMatchObject({
        response: { code: "ALREADY_ACTIVATED" },
      });
      expect(db.rows("wallet_activations")[0].sponsor_address).toBe(expected);
    }
  );

  describe("trustlines", () => {
    const CETES_ID =
      "CETES:GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC";
    const USDC_BALANCE = {
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: USDC.getIssuer(),
      balance: "0",
    };

    async function activated(opts: Parameters<typeof setup>[0] = {}) {
      const ctx = setup({
        userOnChain: [{ asset_type: "native", balance: "0" }, USDC_BALANCE],
        ...opts,
      });
      await ctx.accounts.bootstrap(PRINCIPAL);
      await ctx.service.prepare(PRINCIPAL).catch(() => undefined);
      return ctx;
    }

    it("prepare -> sign -> submit opens a sponsored trustline", async () => {
      const { user, service, sendAndWait } = await activated();

      const prepared = await service.prepareTrustlines(PRINCIPAL, [CETES_ID]);
      const tx = TransactionBuilder.fromXDR(prepared.xdr, PASSPHRASE);
      expect(tx.operations.map((o) => o.type)).toEqual([
        "beginSponsoringFutureReserves",
        "changeTrust",
        "endSponsoringFutureReserves",
      ]);
      expect(() =>
        assertActivationOnly({
          xdr: prepared.xdr,
          networkPassphrase: PASSPHRASE,
          sponsor: SPONSOR.publicKey(),
          user: user.address,
          allowedTrustlines: [CETES_ID],
        })
      ).not.toThrow();

      const signed = await user.signTransaction(prepared.xdr, {
        networkPassphrase: PASSPHRASE,
      });
      const res = await service.submitTrustlines(PRINCIPAL, signed);
      expect(res.status).toBe("SUCCESS");
      expect(sendAndWait).toHaveBeenCalledTimes(1);
    });

    it("sponsors any classic asset, not just a list", async () => {
      const { service } = await activated();
      const any = `ANY:${Keypair.random().publicKey()}`;
      const prepared = await service.prepareTrustlines(PRINCIPAL, [any]);
      const tx = TransactionBuilder.fromXDR(prepared.xdr, PASSPHRASE);
      expect(tx.operations[1]).toMatchObject({ type: "changeTrust" });
    });

    it("refuses past the per-wallet trustline cap", async () => {
      const { service } = await activated({ maxTrustlines: 1 });
      await expect(
        service.prepareTrustlines(PRINCIPAL, [CETES_ID])
      ).rejects.toMatchObject({
        response: { code: "TRUSTLINE_LIMIT_REACHED" },
      });
    });

    it("answers TRUSTLINE_EXISTS when nothing is missing", async () => {
      const { service } = await activated();
      await expect(
        service.prepareTrustlines(PRINCIPAL, [USDC_ID])
      ).rejects.toMatchObject({ response: { code: "TRUSTLINE_EXISTS" } });
    });

    it("refuses a wallet that is not activated", async () => {
      const { accounts, service } = setup();
      await accounts.bootstrap(PRINCIPAL);
      await expect(
        service.prepareTrustlines(PRINCIPAL, [CETES_ID])
      ).rejects.toMatchObject({ response: { code: "WALLET_NOT_ACTIVATED" } });
    });

    it("rejects a submit that differs from what was prepared", async () => {
      const { service } = await activated();
      await service.prepareTrustlines(PRINCIPAL, [CETES_ID]);
      const other = new TransactionBuilder(
        new Account(SPONSOR.publicKey(), "1"),
        { fee: "100", networkPassphrase: PASSPHRASE }
      )
        .addOperation(
          Operation.changeTrust({
            asset: new Asset("JUNK", Keypair.random().publicKey()),
          })
        )
        .setTimeout(30)
        .build();
      await expect(
        service.submitTrustlines(PRINCIPAL, other.toXDR())
      ).rejects.toMatchObject({ response: { code: "ACTIVATION_TX_MISMATCH" } });
    });
  });
});
