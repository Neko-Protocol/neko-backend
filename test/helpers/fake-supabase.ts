import { randomUUID } from "node:crypto";
import type { SupabaseService } from "@core/supabase/supabase.service";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

const UNIQUE: Record<string, string[][]> = {
  account_identities: [["provider", "provider_subject"]],
  wallets: [["chain", "network", "address"]],
  wallet_activations: [["wallet_id", "network"]],
};

const DEFAULTS: Record<string, Row> = {
  accounts: {
    email: null,
    display_name: null,
    country: null,
    locale: null,
    terms_version: null,
    terms_accepted_at: null,
  },
  wallets: { provider: null, provider_wallet_id: null, is_primary: false },
  wallet_activations: { tx_hash: null, error: null },
};

export class FakeSupabase {
  readonly tables: Record<string, Row[]> = {};
  private seq = 0;

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  asService(): SupabaseService {
    return { client: { from: (t: string) => new Query(this, t) } } as never;
  }

  conflict(table: string, row: Row, ignore?: Row): boolean {
    return (UNIQUE[table] ?? []).some((cols) =>
      this.rows(table).some(
        (r) => r !== ignore && cols.every((c) => r[c] === row[c])
      )
    );
  }

  newRow(table: string, values: Row): Row {
    return {
      id: randomUUID(),
      ...DEFAULTS[table],
      created_at: new Date(Date.now() + this.seq++).toISOString(),
      ...values,
    };
  }
}

type Result = { data: unknown; error: unknown; count?: number };

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row = {};
  private onConflict: string[] = [];
  private filters: Filter[] = [];
  private mode: "many" | "single" | "maybe" = "many";
  private embeds: string[] = [];
  private countOnly = false;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string
  ) {}

  select(columns = "*", opts?: { count?: "exact"; head?: boolean }) {
    this.embeds = [...columns.matchAll(/(\w+)\(\*\)/g)].map((m) => m[1]);
    this.countOnly = Boolean(opts?.head);
    return this;
  }
  insert(payload: Row) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload: Row, opts: { onConflict: string }) {
    this.op = "upsert";
    this.payload = payload;
    this.onConflict = opts.onConflict.split(",");
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  is(col: string, value: unknown) {
    this.filters.push((r) => (r[col] ?? null) === value);
    return this;
  }
  gte(col: string, value: string) {
    this.filters.push((r) => String(r[col]) >= value);
    return this;
  }
  in(col: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  order() {
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then<T1 = Result, T2 = never>(
    resolve?: ((v: Result) => T1 | PromiseLike<T1>) | null,
    reject?: ((e: unknown) => T2 | PromiseLike<T2>) | null
  ): Promise<T1 | T2> {
    return Promise.resolve(this.run()).then(resolve, reject);
  }

  private run(): Result {
    const rows = this.db.rows(this.table);
    const match = () => rows.filter((r) => this.filters.every((f) => f(r)));
    const dup = { code: "23505", message: "duplicate key" };
    let out: Row[] = [];

    switch (this.op) {
      case "select":
        out = match();
        break;
      case "insert": {
        if (this.db.conflict(this.table, this.payload)) {
          return { data: null, error: dup };
        }
        const row = this.db.newRow(this.table, this.payload);
        rows.push(row);
        out = [row];
        break;
      }
      case "update":
        out = match();
        out.forEach((r) => Object.assign(r, this.payload));
        break;
      case "delete":
        out = match();
        this.db.tables[this.table] = rows.filter((r) => !out.includes(r));
        break;
      case "upsert": {
        const existing = rows.find((r) =>
          this.onConflict.every((c) => r[c] === this.payload[c])
        );
        if (existing) Object.assign(existing, this.payload);
        else rows.push(this.db.newRow(this.table, this.payload));
        break;
      }
    }

    if (this.op === "select" && this.embeds.length > 0) {
      const fk = `${this.table.replace(/s$/, "")}_id`;
      out = out.map((row) => {
        const copy: Row = { ...row };
        for (const child of this.embeds) {
          copy[child] = this.db.rows(child).filter((c) => c[fk] === row.id);
        }
        return copy;
      });
    }
    if (this.countOnly)
      return { data: null, error: null, count: out.length } as Result;

    if (this.mode === "single") {
      return out.length === 1
        ? { data: out[0], error: null }
        : { data: null, error: { code: "PGRST116" } };
    }
    if (this.mode === "maybe") return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
}
