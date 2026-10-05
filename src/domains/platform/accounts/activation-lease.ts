/**
 * In-process lock around the sponsor's sequence number. Every activation is
 * sourced by the sponsor, so two prepared at once would share a sequence
 * number and one would fail. The lease is held from prepare until submit
 * finishes (or until it expires, which outlasts the transaction's own
 * timeout so an abandoned activation can never land later).
 *
 * Only correct with a single backend instance; more instances need channel
 * accounts or a shared lock.
 */
export class ActivationLease {
  private holder?: { owner: string; timer: NodeJS.Timeout };
  private waiters: Array<() => void> = [];

  constructor(private readonly leaseMs: number) {}

  /**
   * Takes the lease for `owner`, waiting up to `waitMs` for the current
   * holder. The same owner re-preparing takes it over. Returns false on
   * timeout.
   */
  async acquire(owner: string, waitMs: number): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    while (this.holder && this.holder.owner !== owner) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== wake);
          resolve();
        }, remaining);
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        this.waiters.push(wake);
      });
    }
    if (this.holder) clearTimeout(this.holder.timer);
    const timer = setTimeout(() => this.release(owner), this.leaseMs);
    timer.unref?.();
    this.holder = { owner, timer };
    return true;
  }

  release(owner: string): void {
    if (this.holder?.owner !== owner) return;
    clearTimeout(this.holder.timer);
    this.holder = undefined;
    this.waiters.shift()?.();
  }

  heldBy(): string | undefined {
    return this.holder?.owner;
  }
}
