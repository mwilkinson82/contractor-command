import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const binaries =
  "/tmp/athena-accounting-pg17/node_modules/@embedded-postgres/darwin-arm64/native/bin";
const socket = mkdtempSync("/tmp/athena-payment-correction-pg-");
const data = `${socket}/data`;
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
    `-h '' -k ${socket} -p 65438`,
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
      "src/lib/mcp/payment-correction.test.ts",
      "--reporter=json",
      "--outputFile=artifacts/payment-correction/native-tests.json",
    ],
    { env: { ...process.env, ATHENA_CORRECTION_PG_SOCKET: socket } },
  );
  process.stdout.write(test.stdout);
  process.stderr.write(test.stderr);
  exitCode = test.status ?? 1;
  writeFileSync("artifacts/payment-correction/native-tests.log", test.stdout + test.stderr);
} catch (error) {
  console.error(error.message);
} finally {
  const stop = started ? run(`${binaries}/pg_ctl`, ["-D", data, "-m", "fast", "-w", "stop"]) : null;
  const stopped =
    started && stop?.status === 0 && run(`${binaries}/pg_ctl`, ["-D", data, "status"]).status === 3;
  if (started && !stopped) exitCode = 1;
  writeFileSync(
    "artifacts/payment-correction/native-lifecycle.json",
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
