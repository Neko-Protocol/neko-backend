import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

const CONNECT_TIMEOUT_MS = 3_000;
/**
 * How long to wait before warning that a configured Redis never came up. A
 * cache that silently never connects is worse than no cache: the app looks
 * healthy while every read goes upstream.
 */
const FIRST_CONNECT_GRACE_MS = 10_000;
/** A cache operation slower than this is not worth waiting for. */
const OP_TIMEOUT_MS = 250;

/**
 * Shared Redis-backed cache primitive.
 *
 * Two properties everything here depends on:
 *
 * **Fail-open.** Every Redis error path — unreachable, slow, unparseable —
 * degrades to running the fetcher. A missing or broken cache costs latency,
 * never correctness, and never a 5xx. An empty cache is a normal state.
 *
 * **Single-flight.** Concurrent callers for the same cold key share one
 * fetch. Without it, N users polling the same vault at the same moment
 * produce N upstream calls, which is the stampede the cache exists to
 * prevent.
 */
@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis | null = null;
  private connected = false;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private everConnected = false;
  private firstConnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const url = this.configService.get<string>("REDIS_URL");

    if (!url || !url.trim()) {
      this.logger.log(
        "REDIS_URL not set — shared caching disabled, every read goes to its source."
      );
      return;
    }

    this.client = new Redis(url, {
      connectTimeout: CONNECT_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 500, 5_000),
    });

    this.client.on("ready", () => {
      this.connected = true;
      this.everConnected = true;
      if (this.firstConnectTimer) {
        clearTimeout(this.firstConnectTimer);
        this.firstConnectTimer = null;
      }
      this.logger.log("Shared cache connected to Redis.");
    });

    // REDIS_URL was set, so caching was meant to be on. If it never comes up,
    // say so loudly once rather than degrading in silence.
    this.firstConnectTimer = setTimeout(() => {
      if (!this.everConnected) {
        this.logger.error(
          `REDIS_URL is configured but Redis has not connected after ${
            FIRST_CONNECT_GRACE_MS / 1000
          }s — running with no shared cache. Check the URL and that the service is reachable from this network.`
        );
      }
    }, FIRST_CONNECT_GRACE_MS);
    // Never hold the process open just for this warning.
    this.firstConnectTimer.unref?.();
    this.client.on("end", () => {
      this.connected = false;
    });
    this.client.on("error", (err: Error) => {
      // Log the transition only — a reconnect loop would otherwise flood.
      if (this.connected) {
        this.logger.warn(
          `Lost Redis (${err.message}) — serving everything as a miss.`
        );
      }
      this.connected = false;
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.firstConnectTimer) clearTimeout(this.firstConnectTimer);
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  isEnabled(): boolean {
    return this.client !== null && this.connected;
  }

  /**
   * Returns the cached value for `key`, or runs `fetch` and stores its result.
   * `hit` distinguishes a served-from-cache result for metrics.
   */
  async through<T>(
    key: string,
    ttlMs: number,
    fetch: () => Promise<T>
  ): Promise<{ value: T; hit: boolean }> {
    if (!this.isEnabled()) {
      return { value: await fetch(), hit: false };
    }

    const cached = await this.read<T>(key);
    if (cached !== undefined) return { value: cached, hit: true };

    const pending = this.inflight.get(key);
    if (pending) return { value: (await pending) as T, hit: true };

    const promise = (async () => {
      const value = await fetch();
      if (value !== undefined && value !== null) {
        await this.write(key, value, ttlMs);
      }
      return value;
    })();

    this.inflight.set(key, promise);
    try {
      return { value: (await promise) as T, hit: false };
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Drops a single key. Best effort — a stale entry expires on its own. */
  async invalidate(key: string): Promise<void> {
    if (!this.isEnabled() || !this.client) return;
    try {
      await this.client.del(key);
    } catch {
      // Ignored by design.
    }
  }

  private async read<T>(key: string): Promise<T | undefined> {
    if (!this.client) return undefined;
    try {
      const raw = await withTimeout(this.client.get(key), OP_TIMEOUT_MS);
      if (raw === null || raw === undefined) return undefined;
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  private async write(key: string, value: unknown, ttlMs: number) {
    if (!this.client) return;
    try {
      const payload = JSON.stringify(value);
      if (payload === undefined) return;
      await withTimeout(
        this.client.set(key, payload, "PX", ttlMs),
        OP_TIMEOUT_MS
      );
    } catch {
      // A failed write only costs a miss next time.
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("cache timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timer)
  ) as Promise<T>;
}
