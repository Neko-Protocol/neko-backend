import { NotificationsService } from "@domains/platform/notifications/notifications.service";
import { VaultPpsCron } from "./vault-pps.cron";
import { VaultPpsService } from "./vault-pps.service";

describe("VaultPpsCron daily valuation", () => {
  function setup(inserted: number) {
    const svc = { recordOnce: jest.fn().mockResolvedValue({ inserted }) };
    const notifications = {
      vaultDepositors: jest.fn().mockResolvedValue(["GA", "GB"]),
      emit: jest.fn().mockResolvedValue(undefined),
    };
    const cron = new VaultPpsCron(
      svc as unknown as VaultPpsService,
      notifications as unknown as NotificationsService
    );
    return { cron, notifications };
  }

  it("notifies every depositor once per UTC day after recording prices", async () => {
    const { cron, notifications } = setup(3);
    const day = new Date().toISOString().slice(0, 10);

    await cron.run();
    await cron.run();

    expect(notifications.vaultDepositors).toHaveBeenCalledTimes(1);
    expect(notifications.vaultDepositors).toHaveBeenCalledWith();
    expect(notifications.emit).toHaveBeenCalledTimes(2);
    expect(notifications.emit).toHaveBeenCalledWith({
      trigger: "portfolio_valuation",
      walletAddress: "GA",
      dedupeKey: `portfolio_valuation:${day}`,
    });
  });

  it("does not notify when the run recorded no prices", async () => {
    const { cron, notifications } = setup(0);

    await cron.run();

    expect(notifications.vaultDepositors).not.toHaveBeenCalled();
    expect(notifications.emit).not.toHaveBeenCalled();
  });
});
