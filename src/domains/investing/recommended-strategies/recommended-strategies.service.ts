import { BadRequestException, Injectable } from "@nestjs/common";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import {
  CreateRecommendedDto,
  UpdateRecommendedDto,
} from "./dto/create-recommended.dto";
import {
  CatalogDestination,
  DestinationKind,
  PublicRecommendedStrategy,
  RecommendedStrategy,
  isDestinationKind,
} from "./recommended-strategies.types";

function parseNullableNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseIntNumber(raw: unknown, fallback = 0): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  if (typeof raw === "string" && Number.isFinite(Number(raw))) {
    return Math.floor(Number(raw));
  }
  return fallback;
}

@Injectable()
export class RecommendedStrategiesService {
  constructor(private readonly supabase: SupabaseService) {}

  private mapRow(row: Record<string, unknown>): RecommendedStrategy | null {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) return null;

    const destKindRaw =
      typeof row.destination_kind === "string" ? row.destination_kind : "";
    const destination_kind: DestinationKind = isDestinationKind(destKindRaw)
      ? destKindRaw
      : "pool";

    let stack_kind: DestinationKind | null = null;
    if (row.stack_kind !== null && row.stack_kind !== undefined) {
      const sk = typeof row.stack_kind === "string" ? row.stack_kind : "";
      stack_kind = isDestinationKind(sk) ? sk : null;
    }

    return {
      id,
      name: String(row.name ?? ""),
      description:
        row.description === null || row.description === undefined
          ? null
          : String(row.description),
      token_code: String(row.token_code ?? ""),
      destination_kind,
      destination_id: String(row.destination_id ?? ""),
      stack_kind,
      stack_id:
        row.stack_id === null || row.stack_id === undefined
          ? null
          : String(row.stack_id),
      amount: parseNullableNumber(row.amount),
      snapshot_apy: parseNullableNumber(row.snapshot_apy),
      position: parseIntNumber(row.position, 0),
      is_active: typeof row.is_active === "boolean" ? row.is_active : true,
      created_by:
        row.created_by === null || row.created_by === undefined
          ? null
          : String(row.created_by),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  private parseStackFields(b: { stack_kind?: unknown; stack_id?: unknown }): {
    stack_kind: DestinationKind | null;
    stack_id: string | null;
  } {
    const hasKind =
      b.stack_kind !== undefined &&
      b.stack_kind !== null &&
      String(b.stack_kind).trim() !== "";
    const hasId =
      b.stack_id !== undefined &&
      b.stack_id !== null &&
      String(b.stack_id).trim() !== "";

    if (!hasKind && !hasId) return { stack_kind: null, stack_id: null };
    if (!hasKind || !hasId) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STACK,
        message: "stack_kind and stack_id must both be set or both empty",
      });
    }

    const kindRaw = String(b.stack_kind).trim();
    if (!isDestinationKind(kindRaw)) {
      throw new BadRequestException({ code: ErrorCode.INVALID_STACK_KIND });
    }
    return { stack_kind: kindRaw, stack_id: String(b.stack_id).trim() };
  }

  async listCatalogDestinations(): Promise<CatalogDestination[]> {
    const { data, error } = await this.supabase.client
      .from("destination_catalog")
      .select("kind, id, name, protocol, apy, accepted_token_codes")
      .order("name", { ascending: true });
    if (error || !data?.length) return [];

    const out: CatalogDestination[] = [];
    for (const row of data as Record<string, unknown>[]) {
      const kindRaw = typeof row.kind === "string" ? row.kind : "";
      if (!isDestinationKind(kindRaw)) continue;
      const id = typeof row.id === "string" ? row.id : "";
      if (!id) continue;

      const acceptedTokenCodes = Array.isArray(row.accepted_token_codes)
        ? row.accepted_token_codes.filter(
            (code): code is string => typeof code === "string"
          )
        : [];

      out.push({
        kind: kindRaw,
        id,
        name: String(row.name ?? ""),
        protocol: String(row.protocol ?? ""),
        apy: parseNullableNumber(row.apy),
        acceptedTokenCodes,
      });
    }
    return out;
  }

  /**
   * Public, simulator-facing list: only active strategies, mapped to the
   * camelCase DTO shape the web-app consumes.
   */
  async listPublic(): Promise<PublicRecommendedStrategy[]> {
    const { data, error } = await this.supabase.client
      .from("recommended_strategies")
      .select("*")
      .eq("is_active", true)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data?.length) return [];

    const out: PublicRecommendedStrategy[] = [];
    for (const row of data as Record<string, unknown>[]) {
      const mapped = this.mapRow(row);
      if (!mapped) continue;
      out.push({
        id: mapped.id,
        name: mapped.name,
        description: mapped.description,
        tokenCode: mapped.token_code,
        destinationKind: mapped.destination_kind,
        destinationId: mapped.destination_id,
        stackKind: mapped.stack_kind,
        stackId: mapped.stack_id,
        amount: mapped.amount === null ? null : String(mapped.amount),
        snapshotApy: mapped.snapshot_apy,
      });
    }
    return out;
  }

  async list(): Promise<RecommendedStrategy[]> {
    const { data, error } = await this.supabase.client
      .from("recommended_strategies")
      .select("*")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data?.length) return [];

    const out: RecommendedStrategy[] = [];
    for (const row of data as Record<string, unknown>[]) {
      const mapped = this.mapRow(row);
      if (mapped) out.push(mapped);
    }
    return out;
  }

  async get(id: string): Promise<RecommendedStrategy | null> {
    const { data, error } = await this.supabase.client
      .from("recommended_strategies")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data || typeof data !== "object") return null;
    return this.mapRow(data as Record<string, unknown>);
  }

  async create(body: CreateRecommendedDto): Promise<RecommendedStrategy> {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const token_code =
      typeof body.token_code === "string" ? body.token_code.trim() : "";
    const destinationKindRaw =
      typeof body.destination_kind === "string"
        ? body.destination_kind.trim()
        : "";
    const destination_id =
      typeof body.destination_id === "string" ? body.destination_id.trim() : "";

    if (!name) throw new BadRequestException({ code: ErrorCode.NAME_REQUIRED });
    if (!token_code) {
      throw new BadRequestException({ code: ErrorCode.TOKEN_CODE_REQUIRED });
    }
    if (!isDestinationKind(destinationKindRaw)) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_DESTINATION_KIND,
      });
    }
    if (!destination_id) {
      throw new BadRequestException({
        code: ErrorCode.DESTINATION_ID_REQUIRED,
      });
    }

    const descriptionRaw =
      typeof body.description === "string" ? body.description.trim() : null;
    const description =
      descriptionRaw && descriptionRaw.length > 0 ? descriptionRaw : null;

    const stack = this.parseStackFields(body);
    const position = Math.max(0, parseIntNumber(body.position, 0));
    const is_active =
      typeof body.is_active === "boolean" ? body.is_active : true;

    const { data: inserted, error } = await this.supabase.client
      .from("recommended_strategies")
      .insert({
        name,
        description,
        token_code,
        destination_kind: destinationKindRaw,
        destination_id,
        stack_kind: stack.stack_kind,
        stack_id: stack.stack_id,
        amount: parseNullableNumber(body.amount),
        snapshot_apy: parseNullableNumber(body.snapshot_apy),
        position,
        is_active,
        created_by: "admin",
      })
      .select("*")
      .maybeSingle();

    const strategy =
      !error && inserted
        ? this.mapRow(inserted as Record<string, unknown>)
        : null;
    if (!strategy) {
      throw new BadRequestException({
        code: ErrorCode.RECOMMENDED_CREATE_FAILED,
        message: error?.message,
      });
    }
    return strategy;
  }

  async update(id: string, body: UpdateRecommendedDto): Promise<void> {
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
    if (typeof body.token_code === "string") {
      patch.token_code = body.token_code.trim();
    }
    if (typeof body.destination_kind === "string") {
      if (!isDestinationKind(body.destination_kind)) {
        throw new BadRequestException({
          code: ErrorCode.INVALID_DESTINATION_KIND,
        });
      }
      patch.destination_kind = body.destination_kind;
    }
    if (typeof body.destination_id === "string") {
      patch.destination_id = body.destination_id.trim();
    }

    const hasStackKind = body.stack_kind !== undefined;
    const hasStackId = body.stack_id !== undefined;
    if (hasStackKind || hasStackId) {
      const kindEmpty =
        body.stack_kind === null ||
        body.stack_kind === undefined ||
        String(body.stack_kind).trim() === "";
      const idEmpty =
        body.stack_id === null ||
        body.stack_id === undefined ||
        String(body.stack_id).trim() === "";

      if (kindEmpty && idEmpty) {
        patch.stack_kind = null;
        patch.stack_id = null;
      } else if (kindEmpty || idEmpty) {
        throw new BadRequestException({
          code: ErrorCode.INVALID_STACK,
          message: "stack_kind and stack_id must both be set or both empty",
        });
      } else {
        const kindRaw = String(body.stack_kind).trim();
        if (!isDestinationKind(kindRaw)) {
          throw new BadRequestException({
            code: ErrorCode.INVALID_STACK_KIND,
          });
        }
        patch.stack_kind = kindRaw;
        patch.stack_id = String(body.stack_id).trim();
      }
    }

    if (body.amount !== undefined) {
      patch.amount = parseNullableNumber(body.amount);
    }
    if (body.snapshot_apy !== undefined) {
      patch.snapshot_apy = parseNullableNumber(body.snapshot_apy);
    }
    if (body.position !== undefined) {
      patch.position = Math.max(0, parseIntNumber(body.position, 0));
    }
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

    await this.supabase.client
      .from("recommended_strategies")
      .update(patch)
      .eq("id", id);
  }

  async delete(id: string): Promise<void> {
    await this.supabase.client
      .from("recommended_strategies")
      .delete()
      .eq("id", id);
  }
}
