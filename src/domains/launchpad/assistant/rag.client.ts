import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Anthropic from "@anthropic-ai/sdk";

// Any MCP server speaking Streamable HTTP with JSON responses (the Neko Legal KB
// on Cloud Run is one). Its tools are listed at runtime and handed to Claude.

const TIMEOUT_MS = 15_000;
const TOOLS_TTL_MS = 10 * 60_000;
const RESULT_MAX_CHARS = 24_000;

export const RAG_PREFIX = "kb_";

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

@Injectable()
export class RagClient {
  private readonly logger = new Logger(RagClient.name);
  private toolsCache: { tools: McpTool[]; until: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  private get url(): string | null {
    return this.config.get<string>("LAUNCHPAD_RAG_URL")?.trim() || null;
  }

  private async rpc<T>(method: string, params?: unknown): Promise<T> {
    const url = this.url;
    if (!url) throw new Error("Knowledge base is not configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
      });
      if (res.status === 404) {
        throw new Error(
          "RAG server answered 404: the token in the URL doesn't match the server's"
        );
      }
      if (!res.ok) throw new Error(`RAG server answered ${res.status}`);
      const data = (await res.json()) as {
        result?: T;
        error?: { message?: string };
      };
      if (data.error) throw new Error(data.error.message ?? "RAG error");
      if (data.result === undefined) throw new Error("Empty RAG response");
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async tools(): Promise<Anthropic.Beta.BetaTool[]> {
    if (!this.url) return [];
    if (!this.toolsCache || this.toolsCache.until < Date.now()) {
      try {
        const { tools } = await this.rpc<{ tools: McpTool[] }>("tools/list");
        this.toolsCache = { tools, until: Date.now() + TOOLS_TTL_MS };
      } catch (err) {
        this.logger.warn(
          `RAG tools/list failed: ${err instanceof Error ? err.message : err}`
        );
        return [];
      }
    }
    return this.toolsCache.tools
      .map((t) => ({
        name: `${RAG_PREFIX}${t.name}`.slice(0, 64),
        description: `Knowledge base: ${t.description ?? t.name}`,
        input_schema: { type: "object" as const, ...(t.inputSchema ?? {}) },
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async call(
    prefixedName: string,
    args: Record<string, unknown>
  ): Promise<{ text: string; isError: boolean }> {
    try {
      const result = await this.rpc<{
        isError?: boolean;
        content?: { type?: string; text?: string }[];
      }>("tools/call", {
        name: prefixedName.slice(RAG_PREFIX.length),
        arguments: args,
      });
      const text = (result.content ?? [])
        .map((c) => (c.type === "text" ? (c.text ?? "") : ""))
        .join("\n")
        .slice(0, RESULT_MAX_CHARS);
      return { text: text || "(no results)", isError: Boolean(result.isError) };
    } catch (err) {
      return {
        text: `Knowledge base request failed: ${err instanceof Error ? err.message : "unknown error"}`,
        isError: true,
      };
    }
  }
}
