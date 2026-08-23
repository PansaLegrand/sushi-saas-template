import { spawn, spawnSync } from "node:child_process";

import { databaseConnectionParts } from "./database-operations.mjs";

function commandExists(command, args = ["--version"], cwd) {
  return spawnSync(command, args, { cwd, stdio: "ignore" }).status === 0;
}

function isLoopback(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

export function resolvePostgresTool(tool, rawUrl, cwd) {
  const connection = databaseConnectionParts(rawUrl);
  const env = { ...process.env, PGPASSWORD: connection.password };

  if (commandExists(tool)) {
    return {
      command: tool,
      prefixArgs: [],
      connectionArgs: [`--dbname=${connection.safeUrl}`],
      env,
      mode: "native",
    };
  }

  const dockerReady =
    isLoopback(connection.hostname) &&
    commandExists(
      "docker",
      ["compose", "exec", "-T", "postgres", tool, "--version"],
      cwd,
    );
  if (!dockerReady) {
    throw new Error(
      `${tool} is not installed, and the bundled Postgres container is unavailable`,
    );
  }

  return {
    command: "docker",
    prefixArgs: ["compose", "exec", "-T", "-e", "PGPASSWORD", "postgres", tool],
    connectionArgs: [
      "--host=127.0.0.1",
      `--port=${connection.port}`,
      `--username=${connection.username}`,
      `--dbname=${connection.database}`,
    ],
    env,
    mode: "docker",
    cwd,
  };
}

export function spawnPostgresTool(spec, args, options = {}) {
  return spawn(
    spec.command,
    [...spec.prefixArgs, ...args, ...spec.connectionArgs],
    {
      cwd: spec.cwd ?? options.cwd,
      env: spec.env,
      stdio: options.stdio ?? ["ignore", "inherit", "inherit"],
    },
  );
}

export function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `command exited${signal ? ` from ${signal}` : ` with code ${code ?? 1}`}`,
          ),
        );
    });
  });
}
