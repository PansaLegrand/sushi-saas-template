import { getRequiredEnv, isProductionRuntime } from "@/lib/env";
import { AppError } from "@/lib/errors/app-error";
import { findCreditByTransNo } from "@/models/credit";
import { ensureDemoService } from "@/models/reservation";
import {
  findCredentialUserByEmail,
  markUserEmailVerified,
} from "@/models/user";
import { CreditsTransType, increaseCredits } from "@/services/credit";
import { ensurePersonalOrganization } from "@/services/organizations";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function assertDevelopmentDatabase() {
  if (isProductionRuntime()) {
    throw new AppError("SERVER_ERROR", {
      message: "development fixtures are disabled in production",
    });
  }

  const url = new URL(getRequiredEnv("DATABASE_URL"));
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!LOOPBACK_HOSTS.has(url.hostname) || database !== "sushi_dev") {
    throw new AppError("SERVER_ERROR", {
      message: "development fixtures require the loopback sushi_dev database",
    });
  }
}

export async function findDevelopmentFixtureUser(email: string) {
  assertDevelopmentDatabase();
  return findCredentialUserByEmail(email);
}

export async function seedDevelopmentFixtures(params: {
  email: string;
  credits: number;
}) {
  assertDevelopmentDatabase();
  const user = await findCredentialUserByEmail(params.email);
  if (!user) {
    throw new AppError("SERVER_ERROR", {
      message:
        "development fixture user must be created through Better Auth first",
    });
  }

  const verified = user.email_verified
    ? user
    : await markUserEmailVerified(user.id);
  if (!verified) {
    throw new AppError("SERVER_ERROR", {
      message: "could not verify the development fixture user",
    });
  }

  const organization = await ensurePersonalOrganization({
    id: verified.id,
    email: verified.email,
    nickname: verified.nickname,
  });
  const reservationService = await ensureDemoService();

  const creditTransaction = `dev-seed:${verified.uuid}`;
  let credit = await findCreditByTransNo(creditTransaction);
  if (!credit) {
    try {
      await increaseCredits({
        org_uuid: organization.uuid,
        user_uuid: verified.uuid,
        trans_type: CreditsTransType.SystemAdd,
        credits: params.credits,
        trans_no: creditTransaction,
        actor: "system:dev_seed",
        metadata: { source: "pnpm dev:seed" },
      });
    } catch (error) {
      // Two developers/processes can seed at once. The deterministic unique
      // transaction makes one insert win; converge on that row instead of
      // reporting a failed seed after the desired effect already happened.
      credit = await findCreditByTransNo(creditTransaction);
      if (!credit) throw error;
    }
    if (!credit) credit = await findCreditByTransNo(creditTransaction);
  }

  return {
    user: verified,
    organization,
    reservationService,
    credit,
  };
}
