#!/usr/bin/env node
/**
 * Promote one existing user to an admin role.
 *
 * Usage:
 *   pnpm admin:promote founder@example.com
 *   pnpm admin:promote founder@example.com admin_ro
 *   pnpm admin:promote founder@example.com --role admin_rw --provider google
 */
import "dotenv/config";

import postgres from "postgres";

const ADMIN_ROLES = new Set(["admin_ro", "admin_rw"]);

function usage() {
  console.log(`Usage:
  pnpm admin:promote <email> [admin_ro|admin_rw] [--provider <provider>] [--dry-run]

Examples:
  pnpm admin:promote founder@example.com
  pnpm admin:promote founder@example.com admin_ro
  pnpm admin:promote founder@example.com --provider google

Defaults to admin_rw. If the same email has multiple auth providers, pass
--provider with the provider shown by the script.
`);
}

function parseArgs(argv) {
  const result = {
    email: undefined,
    role: undefined,
    provider: undefined,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }

    if (arg === "--dry-run") {
      result.dryRun = true;
      continue;
    }

    if (arg === "--provider") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) {
        throw new Error("--provider requires a value.");
      }
      result.provider = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith("--provider=")) {
      result.provider = arg.slice("--provider=".length);
      continue;
    }

    if (arg === "--role") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) {
        throw new Error("--role requires a value.");
      }
      result.role = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith("--role=")) {
      result.role = arg.slice("--role=".length);
      continue;
    }

    if (!result.email) {
      result.email = arg;
      continue;
    }

    if (!result.role) {
      result.role = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  result.email = result.email?.trim().toLowerCase();
  result.role = (result.role?.trim() || "admin_rw");
  result.provider = result.provider?.trim();

  return result;
}

function assertArgs(args) {
  if (!args.email) {
    throw new Error("Email is required.");
  }

  if (!args.email.includes("@")) {
    throw new Error(`Invalid email: ${args.email}`);
  }

  if (!ADMIN_ROLES.has(args.role)) {
    throw new Error(`Role must be admin_ro or admin_rw. Received: ${args.role}`);
  }

  if (args.provider === "") {
    throw new Error("--provider cannot be empty.");
  }
}

function printMatches(rows) {
  for (const row of rows) {
    console.log(
      `  - provider=${row.signin_provider || "(empty)"} role=${row.role} uuid=${row.uuid} id=${row.id}`
    );
  }
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
  assertArgs(args);
} catch (error) {
  console.error(error.message);
  console.error("");
  usage();
  process.exit(1);
}

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is required. Set it in .env or in the shell.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });
let exitCode = 0;

try {
  const rows = args.provider
    ? await sql`
        select id, uuid, email, role, signin_provider, two_factor_enabled
        from users
        where lower(email) = lower(${args.email})
          and signin_provider = ${args.provider}
        order by created_at asc nulls last, id asc
      `
    : await sql`
        select id, uuid, email, role, signin_provider, two_factor_enabled
        from users
        where lower(email) = lower(${args.email})
        order by created_at asc nulls last, id asc
      `;

  if (rows.length === 0) {
    console.error(`No user found for ${args.email}${args.provider ? ` with provider ${args.provider}` : ""}.`);
    exitCode = 1;
  } else if (rows.length > 1) {
    console.error(`More than one user matches ${args.email}. Refusing to guess.`);
    printMatches(rows);
    console.error("");
    console.error("Re-run with --provider <provider> after choosing the correct account.");
    exitCode = 1;
  } else {
    const user = rows[0];

    if (args.dryRun) {
      console.log(
        `Would promote ${user.email} (${user.uuid}) from ${user.role} to ${args.role}.`
      );
    } else if (user.role === args.role) {
      console.log(`${user.email} (${user.uuid}) is already ${args.role}.`);
    } else {
      const [updated] = await sql`
        update users
        set role = ${args.role}, updated_at = now()
        where id = ${user.id}
        returning uuid, email, role, signin_provider, two_factor_enabled
      `;

      console.log(
        `Promoted ${updated.email} (${updated.uuid}) to ${updated.role}.`
      );
    }

    const finalUser = rows[0];
    if (!finalUser.two_factor_enabled) {
      console.log(
        "Reminder: admin users must enable MFA from the public account page before entering the admin app."
      );
    }
  }
} catch (error) {
  console.error("Admin promotion failed:");
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

process.exit(exitCode);
