import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { access } from "node:fs/promises";

await access(".output/server/wrangler.json");
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const grouped = process.platform !== "win32";
const child = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "preview", "--", "--port", String(port)],
  {
    detached: grouped,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" },
  },
);
let output = "";
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (chunk) => {
    output = (output + chunk.toString()).slice(-65536);
  });
const origin = `http://127.0.0.1:${port}`;
async function stop() {
  if (!child.pid) return;
  try {
    if (grouped) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    /* already exited */
  }
}
try {
  const until = Date.now() + 120000;
  let ready = false;
  while (Date.now() < until) {
    if (child.exitCode !== null)
      throw new Error(`Preview exited before startup: ${child.exitCode}`);
    try {
      ready = (await fetch(`${origin}/version`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {
      /* startup */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Workers preview did not start");
  const job = "00000000-0000-4000-8000-000000000801";
  for (const page of ["home", "accounting", "billing-records", "purchase-orders"]) {
    const response = await fetch(`${origin}/r/job/${job}/${page}`, {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200, `${page} SSR failed`);
    const html = await response.text();
    assert.match(
      html,
      page === "home"
        ? /Loading project/
        : page === "billing-records"
          ? /Loading billing records/
          : page === "purchase-orders"
            ? /Checking access|Loading purchase orders/
            : /Checking access/,
    );
    assert.doesNotMatch(html, /This page didn.t load|unhandled.*HTTPError/);
  }
  const denied = await fetch(`${origin}/mcp`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "synthetic-preview", version: "1" },
      },
    }),
  });
  assert.equal(denied.status, 401, "MCP must still require a bearer token");
  console.log(
    "Workers preview: home, accounting, billing and purchase orders SSR 200; unauthenticated MCP 401.",
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await stop();
}
