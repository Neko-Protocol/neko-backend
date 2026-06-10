import { Test } from "@nestjs/testing";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

describe("UsersController", () => {
  const WALLET = "GABCDEF1234567890";

  function buildController(svc: Partial<UsersService>) {
    const service = {
      register: jest.fn(),
      get: jest.fn(),
      updatePreferences: jest.fn(),
      startEmailVerification: jest.fn(),
      confirmEmail: jest.fn(),
      ...svc,
    };
    return Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    })
      .compile()
      .then((mod) => ({
        controller: mod.get(UsersController),
        service: mod.get(UsersService) as typeof service,
      }));
  }

  it("register delegates to svc.register(dto)", async () => {
    const dto = { wallet_address: WALLET, wallet_provider: "freighter" };
    const { controller, service } = await buildController({
      register: jest.fn().mockResolvedValue({ ok: true }),
    });

    await controller.register(dto);

    expect(service.register).toHaveBeenCalledWith(dto);
  });

  it("get trims wallet and delegates to svc.get", async () => {
    const { controller, service } = await buildController({
      get: jest.fn().mockResolvedValue(null),
    });

    await controller.get("  WALLET  ");

    expect(service.get).toHaveBeenCalledWith("WALLET");
  });

  it("updatePreferences delegates to svc.updatePreferences(dto)", async () => {
    const dto = { wallet_address: WALLET, preferences: { currency: "USD" } };
    const { controller, service } = await buildController({
      updatePreferences: jest.fn().mockResolvedValue({ ok: true }),
    });

    await controller.updatePreferences(dto);

    expect(service.updatePreferences).toHaveBeenCalledWith(dto);
  });

  it("startEmail delegates to svc.startEmailVerification(dto)", async () => {
    const dto = { wallet_address: WALLET, email: "user@example.com" };
    const { controller, service } = await buildController({
      startEmailVerification: jest.fn().mockResolvedValue({ ok: true }),
    });

    await controller.startEmail(dto);

    expect(service.startEmailVerification).toHaveBeenCalledWith(dto);
  });

  it("confirmEmail delegates to svc.confirmEmail(dto)", async () => {
    const dto = { wallet: WALLET, access_token: "token-abc" };
    const { controller, service } = await buildController({
      confirmEmail: jest.fn().mockResolvedValue({ ok: true }),
    });

    await controller.confirmEmail(dto);

    expect(service.confirmEmail).toHaveBeenCalledWith(dto);
  });
});
