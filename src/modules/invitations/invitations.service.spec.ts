import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailService } from "../email/email.service";
import { SupabaseService } from "../supabase/supabase.service";
import { InvitationsService } from "./invitations.service";

function makeService(): InvitationsService {
  const supabase = { client: {} } as unknown as SupabaseService;
  const email = { send: jest.fn() } as unknown as EmailService;
  const config = { get: () => undefined } as unknown as ConfigService;
  return new InvitationsService(supabase, email, config);
}

describe("InvitationsService body validation", () => {
  it("rejects a missing email", async () => {
    await expect(makeService().create({})).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it("rejects a malformed email", async () => {
    await expect(
      makeService().create({ email: "not-an-email" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
