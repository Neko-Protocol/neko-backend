import { ActivationLease } from "./activation-lease";

describe("ActivationLease", () => {
  afterEach(() => jest.useRealTimers());

  it("serialises owners and hands over on release", async () => {
    const lease = new ActivationLease(60_000);
    expect(await lease.acquire("A", 0)).toBe(true);

    const second = lease.acquire("B", 5_000);
    expect(lease.heldBy()).toBe("A");
    lease.release("A");
    await expect(second).resolves.toBe(true);
    expect(lease.heldBy()).toBe("B");
  });

  it("times out when the holder does not release", async () => {
    const lease = new ActivationLease(60_000);
    await lease.acquire("A", 0);
    expect(await lease.acquire("B", 20)).toBe(false);
    expect(lease.heldBy()).toBe("A");
  });

  it("lets the same owner re-acquire", async () => {
    const lease = new ActivationLease(60_000);
    await lease.acquire("A", 0);
    expect(await lease.acquire("A", 0)).toBe(true);
  });

  it("expires an abandoned lease", async () => {
    jest.useFakeTimers();
    const lease = new ActivationLease(1_000);
    await lease.acquire("A", 0);
    jest.advanceTimersByTime(1_001);
    expect(lease.heldBy()).toBeUndefined();
  });

  it("ignores a release from a non-holder", async () => {
    const lease = new ActivationLease(60_000);
    await lease.acquire("A", 0);
    lease.release("B");
    expect(lease.heldBy()).toBe("A");
  });
});
