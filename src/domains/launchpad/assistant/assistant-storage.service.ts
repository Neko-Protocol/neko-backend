import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "@core/supabase/supabase.service";

export const MAX_ASSISTANT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ASSISTANT_FILES = 8;
export const MAX_APPLICATION_FILE_BYTES = 20 * 1024 * 1024;

const SIGNED_LINK_TTL_SECONDS = 60 * 60 * 24 * 365;
const DOC_CACHE_MS = 10 * 60_000;
// Session folders hold the issuer's files ("<id>__<name>") plus these two.
const TRANSCRIPT_FILE = "_transcript.json";
const CLOSED_FILE = "_closed";

export type AssistantFileKind = "pdf" | "text" | "image";

const ASSISTANT_TYPES: Record<
  string,
  { mediaType: string; kind: AssistantFileKind }
> = {
  pdf: { mediaType: "application/pdf", kind: "pdf" },
  txt: { mediaType: "text/plain", kind: "text" },
  md: { mediaType: "text/markdown", kind: "text" },
  csv: { mediaType: "text/csv", kind: "text" },
  json: { mediaType: "application/json", kind: "text" },
  png: { mediaType: "image/png", kind: "image" },
  jpg: { mediaType: "image/jpeg", kind: "image" },
  jpeg: { mediaType: "image/jpeg", kind: "image" },
  webp: { mediaType: "image/webp", kind: "image" },
  gif: { mediaType: "image/gif", kind: "image" },
};

const APPLICATION_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
};

export interface SessionDocument {
  path: string;
  name: string;
  size: number;
  mediaType: string;
}

export interface TranscriptTurn {
  role: "user" | "assistant";
  text: string;
}

function extension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
}

export function assistantFileType(name: string) {
  return ASSISTANT_TYPES[extension(name)] ?? null;
}

export function applicationMediaType(name: string): string | null {
  return APPLICATION_TYPES[extension(name)] ?? null;
}

@Injectable()
export class AssistantStorageService {
  private readonly ready = new Map<string, Promise<void>>();
  private readonly docCache = new Map<
    string,
    { data: Buffer; until: number }
  >();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService
  ) {}

  private get assistantBucket(): string {
    return (
      this.config.get<string>("LAUNCHPAD_ASSISTANT_BUCKET") ||
      "launchpad-assistant-docs"
    );
  }

  private get applicationBucket(): string {
    return (
      this.config.get<string>("LAUNCHPAD_APPLICATION_BUCKET") ||
      "launchpad-application-docs"
    );
  }

  private async bucket(name: string, fileSizeLimit: number) {
    const storage = this.supabase.client.storage;
    let ready = this.ready.get(name);
    if (!ready) {
      ready = (async () => {
        const { data } = await storage.getBucket(name);
        if (data) return;
        const { error } = await storage.createBucket(name, {
          public: false,
          fileSizeLimit,
        });
        if (error && !/already exists/i.test(error.message)) throw error;
      })();
      this.ready.set(name, ready);
      ready.catch(() => this.ready.delete(name));
    }
    await ready;
    return storage.from(name);
  }

  private session() {
    return this.bucket(this.assistantBucket, MAX_ASSISTANT_FILE_BYTES);
  }

  prefix(accountId: string, sessionId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
      throw new BadRequestException({ code: "INVALID_SESSION" });
    }
    return `${accountId}/${sessionId}`;
  }

  async isClosed(prefix: string): Promise<boolean> {
    const store = await this.session();
    const { data } = await store.list(prefix, { search: CLOSED_FILE });
    return (data ?? []).some((f) => f.name === CLOSED_FILE);
  }

  async listDocuments(prefix: string): Promise<SessionDocument[]> {
    const store = await this.session();
    const { data, error } = await store.list(prefix, {
      limit: 100,
      sortBy: { column: "created_at", order: "asc" },
    });
    if (error) throw error;
    return (data ?? [])
      .filter((f) => f.id && f.name.includes("__"))
      .map((f) => ({
        path: `${prefix}/${f.name}`,
        name: f.name.split("__").slice(1).join("__") || f.name,
        size: Number(f.metadata?.size ?? 0),
        mediaType: String(f.metadata?.mimetype ?? ""),
      }));
  }

  async uploadDocument(
    prefix: string,
    file: { originalname: string; buffer: Buffer; size: number },
    mediaType: string
  ): Promise<SessionDocument> {
    const store = await this.session();
    const name = safeName(file.originalname);
    const path = `${prefix}/${crypto.randomUUID().slice(0, 8)}__${name}`;
    const { error } = await store.upload(path, file.buffer, {
      contentType: mediaType,
      upsert: false,
    });
    if (error) throw error;
    return { path, name, size: file.size, mediaType };
  }

  async downloadDocument(path: string): Promise<Buffer> {
    const hit = this.docCache.get(path);
    if (hit && hit.until > Date.now()) return hit.data;
    const store = await this.session();
    const { data, error } = await store.download(path);
    if (error || !data) throw error ?? new Error("DOWNLOAD_FAILED");
    const buffer = Buffer.from(await data.arrayBuffer());
    this.docCache.set(path, { data: buffer, until: Date.now() + DOC_CACHE_MS });
    for (const [key, value] of this.docCache) {
      if (value.until < Date.now()) this.docCache.delete(key);
    }
    return buffer;
  }

  async removeDocuments(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const store = await this.session();
    const { error } = await store.remove(paths);
    if (error) throw error;
    for (const path of paths) this.docCache.delete(path);
  }

  async readTranscript(prefix: string): Promise<TranscriptTurn[]> {
    const store = await this.session();
    const { data, error } = await store.download(
      `${prefix}/${TRANSCRIPT_FILE}`
    );
    if (error || !data) return [];
    try {
      const parsed = JSON.parse(await data.text()) as TranscriptTurn[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async appendTranscript(
    prefix: string,
    turns: TranscriptTurn[]
  ): Promise<void> {
    const store = await this.session();
    const next = [...(await this.readTranscript(prefix)), ...turns].slice(-80);
    await store.upload(
      `${prefix}/${TRANSCRIPT_FILE}`,
      Buffer.from(JSON.stringify(next)),
      {
        contentType: "application/json",
        upsert: true,
      }
    );
  }

  /** Deletes the session's files and transcript and blocks further use. */
  async closeSession(prefix: string): Promise<void> {
    const store = await this.session();
    const { data } = await store.list(prefix, { limit: 100 });
    const paths = (data ?? [])
      .filter((f) => f.id)
      .map((f) => `${prefix}/${f.name}`);
    await this.removeDocuments(paths);
    await store.upload(`${prefix}/${CLOSED_FILE}`, Buffer.from(""), {
      contentType: "text/plain",
      upsert: true,
    });
  }

  async uploadApplicationDocument(
    accountId: string,
    file: { originalname: string; buffer: Buffer },
    mediaType: string
  ): Promise<{ name: string; url: string }> {
    const store = await this.bucket(
      this.applicationBucket,
      MAX_APPLICATION_FILE_BYTES
    );
    const name = safeName(file.originalname);
    const path = `${accountId}/${crypto.randomUUID()}__${name}`;
    const { error } = await store.upload(path, file.buffer, {
      contentType: mediaType,
      upsert: false,
    });
    if (error) throw error;
    const { data, error: signError } = await store.createSignedUrl(
      path,
      SIGNED_LINK_TTL_SECONDS
    );
    if (signError || !data) throw signError ?? new Error("SIGN_FAILED");
    return { name, url: data.signedUrl };
  }
}
