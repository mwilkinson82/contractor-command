import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const binaries =
  "/tmp/athena-accounting-pg17/node_modules/@embedded-postgres/darwin-arm64/native/bin";
const socket = mkdtempSync("/tmp/athena-sched-buyout-pg-");
const data = `${socket}/data`;
mkdirSync("output/cross-domain", { recursive: true });
const run = (name, args, options = {}) => spawnSync(name, args, { encoding: "utf8", ...options });
let started = false,
  exitCode = 1;
try {
  const init = run(`${binaries}/initdb`, [
    "-D",
    data,
    "-A",
    "trust",
    "-U",
    "postgres",
    "--no-locale",
    "-E",
    "UTF8",
  ]);
  if (init.status !== 0) throw new Error(`Disposable initdb failed: ${init.stderr}`);
  const start = run(`${binaries}/pg_ctl`, [
    "-D",
    data,
    "-l",
    `${socket}/postgres.log`,
    "-o",
    `-h '' -k ${socket} -p 65449 -c unix_socket_permissions=0700`,
    "-w",
    "start",
  ]);
  if (start.status !== 0)
    throw new Error(
      `Disposable PostgreSQL start failed: ${start.stderr}\n${readFileSync(`${socket}/postgres.log`, "utf8")}`,
    );
  started = true;
  const test = run(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "src/lib/mcp/scheduling-buyout-db.test.ts",
      "--reporter=json",
      "--outputFile=output/cross-domain/native-tests.json",
    ],
    { env: { ...process.env, ATHENA_SCHED_BUYOUT_PG_SOCKET: socket } },
  );
  process.stdout.write(test.stdout);
  process.stderr.write(test.stderr);
  exitCode = test.status ?? 1;
  writeFileSync("output/cross-domain/native-tests.log", test.stdout + test.stderr);
} catch (error) {
  console.error(error.message);
} finally {
  const stop = started ? run(`${binaries}/pg_ctl`, ["-D", data, "-m", "fast", "-w", "stop"]) : null;
  const stopped =
    started && stop?.status === 0 && run(`${binaries}/pg_ctl`, ["-D", data, "status"]).status === 3;
  if (started && !stopped) exitCode = 1;
  writeFileSync(
    "output/cross-domain/native-lifecycle.json",
    JSON.stringify(
      {
        localOnly: true,
        socket,
        postgresVersion: run(`${binaries}/postgres`, ["--version"]).stdout.trim(),
        started,
        stopped,
        exitCode,
      },
      null,
      2,
    ) + "\n",
  );
}
process.exitCode = exitCode;
