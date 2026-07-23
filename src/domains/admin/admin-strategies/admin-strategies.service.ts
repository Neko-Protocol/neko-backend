import { BadRequestException, Injectable } from "@nestjs/common";
import { ErrorCode } from "@neko/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import { AuditService } from "@domains/platform/audit/audit.service";
import { CreateStrategyDto } from "./dto/create-strategy.dto";
import { UpdateStrategyDto } from "./dto/update-strategy.dto";
import {
  Strategy,
  StrategyStatus,
  StrategyType,
  StrategyWithStats,
  isStrategyStatus,
  isStrategyType,
} from "./admin-strategies.types";

const TYPE_FALLBACK: StrategyType = "acquisition";
const STATUS_FALLBACK: StrategyStatus = "active";

@Injectable()
export class AdminStrategiesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService
  ) {}

  private mapRow(row: Record<string, unknown>): Strategy | null {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) return null;

    const typeRaw = typeof row.type === "string" ? row.type : TYPE_FALLBACK;
    const type: StrategyType = isStrategyType(typeRaw)
      ? typeRaw
      : TYPE_FALLBACK;

    const statusRaw =
      typeof row.status === "string" ? row.status : STATUS_FALLBACK;
    const status: StrategyStatus = isStrategyStatus(statusRaw)
      ? statusRaw
      : STATUS_FALLBACK;

    let target_count = 0;
    if (
      typeof row.target_count === "number" &&
      Number.isFinite(row.target_count)
    ) {
      target_count = Math.max(0, Math.floor(row.target_count));
    }

    const tvRaw = row.target_volume;
    let target_volume = 0;
    if (typeof tvRaw === "number" && Number.isFinite(tvRaw)) {
      target_volume = Math.max(0, tvRaw);
    } else if (typeof tvRaw === "string" && Number.isFinite(Number(tvRaw))) {
      target_volume = Math.max(0, Number(tvRaw));
    }

    return {
      id,
      name: String(row.name ?? ""),
      description:
        row.description === null || row.description === undefined
          ? null
          : String(row.description),
      type,
      target_count,
      target_volume,
      status,
      assigned_to:
        row.assigned_to === null || row.assigned_to === undefined
          ? null
          : String(row.assigned_to),
      created_by:
        row.created_by === null || row.created_by === undefined
          ? null
          : String(row.created_by),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
      completed_at:
        typeof row.completed_at === "string" ? row.completed_at : null,
    };
  }

  async list(): Promise<StrategyWithStats[]> {
    const client = this.supabase.client;
    const [
      { data: stratRows, error: stratErr },
      { data: invRows, error: invErr },
    ] = await Promise.all([
      client
        .from("strategies")
        .select("*")
        .order("created_at", { ascending: false }),
      client
        .from("invitations")
        .select("strategy_id, status, volume_moved")
        .not("strategy_id", "is", null)
        .limit(2000),
    ]);

    if (stratErr || !stratRows?.length) return [];

    type Agg = {
      total: number;
      pending: number;
      accepted: number;
      expired: number;
      volume_moved: number;
    };

    const byStrategy = new Map<string, Agg>();
    if (!invErr && invRows?.length) {
      for (const r of invRows as Record<string, unknown>[]) {
        const sid = typeof r.strategy_id === "string" ? r.strategy_id : null;
        if (!sid) continue;
        const st = typeof r.status === "string" ? r.status : "pending";
        let agg = byStrategy.get(sid);
        if (!agg) {
          agg = {
            total: 0,
            pending: 0,
            accepted: 0,
            expired: 0,
            volume_moved: 0,
          };
          byStrategy.set(sid, agg);
        }
        agg.total += 1;
        if (st === "pending") agg.pending += 1;
        else if (st === "accepted") {
          agg.accepted += 1;
          const vm = Number(r.volume_moved);
          if (Number.isFinite(vm)) agg.volume_moved += vm;
        } else if (st === "expired") agg.expired += 1;
      }
    }

    const out: StrategyWithStats[] = [];
    for (const row of stratRows as Record<string, unknown>[]) {
      const base = this.mapRow(row);
      if (!base) continue;
      const agg = byStrategy.get(base.id) ?? {
        total: 0,
        pending: 0,
        accepted: 0,
        expired: 0,
        volume_moved: 0,
      };
      const acceptance_rate =
        agg.total === 0
          ? 0
          : Math.round((agg.accepted / agg.total) * 1000) / 10;

      out.push({
        ...base,
        total_invitations: agg.total,
        pending: agg.pending,
        accepted: agg.accepted,
        expired: agg.expired,
        acceptance_rate,
        total_volume_moved: agg.volume_moved,
      });
    }
    return out;
  }

  async get(id: string): Promise<Strategy | null> {
    const { data, error } = await this.supabase.client
      .from("strategies")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data || typeof data !== "object") return null;
    return this.mapRow(data as Record<string, unknown>);
  }

  async create(body: CreateStrategyDto): Promise<Strategy> {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      throw new BadRequestException({ code: ErrorCode.NAME_REQUIRED });
    }
    const typeRaw = typeof body.type === "string" ? body.type.trim() : "";
    if (!isStrategyType(typeRaw)) {
      throw new BadRequestException({ code: ErrorCode.INVALID_STRATEGY_TYPE });
    }

    const descriptionRaw =
      typeof body.description === "string" ? body.description.trim() : null;
    const description =
      descriptionRaw && descriptionRaw.length > 0 ? descriptionRaw : null;

    let target_count = Number(body.target_count);
    if (!Number.isFinite(target_count)) target_count = 0;
    target_count = Math.max(0, Math.floor(target_count));

    let target_volume = Number(body.target_volume);
    if (!Number.isFinite(target_volume)) target_volume = 0;
    target_volume = Math.max(0, target_volume);

    const assignedRaw =
      typeof body.assigned_to === "string" ? body.assigned_to.trim() : "";
    const assigned_to = assignedRaw.length > 0 ? assignedRaw : null;

    const statusRaw =
      typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
    const status: StrategyStatus =
      statusRaw && isStrategyStatus(statusRaw) ? statusRaw : STATUS_FALLBACK;

    const { data: inserted, error } = await this.supabase.client
      .from("strategies")
      .insert({
        name,
        description,
        type: typeRaw,
        target_count,
        target_volume,
        assigned_to,
        created_by: "admin",
        status,
      })
      .select("*")
      .maybeSingle();

    const strategy =
      !error && inserted
        ? this.mapRow(inserted as Record<string, unknown>)
        : null;
    if (!strategy) {
      throw new BadRequestException({
        code: ErrorCode.STRATEGY_CREATE_FAILED,
      });
    }
    return strategy;
  }

  async update(id: string, body: UpdateStrategyDto): Promise<void> {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body.name === "string") patch.name = body.name.trim();
    if (body.description !== undefined) {
      if (typeof body.description === "string") {
        const t = body.description.trim();
        patch.description = t.length > 0 ? t : null;
      } else if (body.description === null) {
        patch.description = null;
      }
    }
    if (typeof body.type === "string") {
      if (!isStrategyType(body.type)) {
        throw new BadRequestException({
          code: ErrorCode.INVALID_STRATEGY_TYPE,
        });
      }
      patch.type = body.type;
    }
    if (body.target_count !== undefined) {
      let n = Number(body.target_count);
      if (!Number.isFinite(n)) n = 0;
      patch.target_count = Math.max(0, Math.floor(n));
    }
    if (body.target_volume !== undefined) {
      const n = Number(body.target_volume);
      patch.target_volume = Number.isFinite(n) ? Math.max(0, n) : 0;
    }
    if (typeof body.status === "string") {
      const s = body.status.trim().toLowerCase();
      if (!isStrategyStatus(s)) {
        throw new BadRequestException({ code: ErrorCode.INVALID_STATUS });
      }
      patch.status = s;
    }
    if (body.assigned_to !== undefined) {
      const r =
        typeof body.assigned_to === "string" ? body.assigned_to.trim() : null;
      patch.assigned_to = r?.length ? r : null;
    }
    if (body.completed_at !== undefined) {
      if (body.completed_at === null) patch.completed_at = null;
      else if (typeof body.completed_at === "string")
        patch.completed_at = body.completed_at;
    }

    await this.supabase.client.from("strategies").update(patch).eq("id", id);
  }

  async delete(id: string): Promise<void> {
    await this.supabase.client.from("strategies").delete().eq("id", id);
  }

  private async sumAuditAmountUsdForWalletsSince(
    walletChunk: string[],
    createdAtGte: string
  ): Promise<number> {
    const rows = await this.audit.query("amount_in", {
      whereIn: { column: "wallet_address", values: walletChunk },
      gte: { column: "created_at", value: createdAtGte },
      notNull: "amount_in",
    });
    let sum = 0;
    for (const r of rows) {
      const v = Number(r.amount_in);
      if (Number.isFinite(v) && v > 0) sum += v;
    }
    return sum;
  }

  async getRealVolumeUsd(strategyId: string): Promise<number | null> {
    const client = this.supabase.client;
    const strategy = await this.get(strategyId);
    if (!strategy) return null;

    const { data: invRows, error: invErr } = await client
      .from("invitations")
      .select("email")
      .eq("strategy_id", strategyId);
    if (invErr || !invRows?.length) return 0;

    const emails = new Set<string>();
    for (const r of invRows as Record<string, unknown>[]) {
      const e = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
      if (e) emails.add(e);
    }
    if (emails.size === 0) return 0;

    const wallets = new Set<string>();
    const emailList = [...emails];
    const emailChunkSize = 100;
    for (let i = 0; i < emailList.length; i += emailChunkSize) {
      const chunk = emailList.slice(i, i + emailChunkSize);
      const { data: userRows } = await client
        .from("users")
        .select("wallet_address")
        .in("email", chunk);
      if (!userRows?.length) continue;
      for (const u of userRows as Record<string, unknown>[]) {
        const w =
          typeof u.wallet_address === "string" ? u.wallet_address.trim() : "";
        if (w) wallets.add(w);
      }
    }
    if (wallets.size === 0) return 0;

    const walletList = [...wallets];
    const walletChunkSize = 120;
    let total = 0;
    for (let i = 0; i < walletList.length; i += walletChunkSize) {
      const wchunk = walletList.slice(i, i + walletChunkSize);
      total += await this.sumAuditAmountUsdForWalletsSince(
        wchunk,
        strategy.created_at
      );
    }
    return total;
  }

  async getStats(): Promise<{
    total: number;
    active: number;
    paused: number;
    completed: number;
  }> {
    const client = this.supabase.client;
    const [total, active, paused, completed] = await Promise.all([
      client.from("strategies").select("*", { count: "exact", head: true }),
      client
        .from("strategies")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
      client
        .from("strategies")
        .select("*", { count: "exact", head: true })
        .eq("status", "paused"),
      client
        .from("strategies")
        .select("*", { count: "exact", head: true })
        .eq("status", "completed"),
    ]);

    return {
      total: total.count ?? 0,
      active: active.count ?? 0,
      paused: paused.count ?? 0,
      completed: completed.count ?? 0,
    };
  }
}
