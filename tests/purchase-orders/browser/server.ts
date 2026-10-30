// Synthetic browser rehearsal only: real existing PO SQL + integrated buyout proposal, no remote backend.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { makePurchaseOrderDb, poIds } from "../fixture";
const db = await makePurchaseOrderDb();
await db.exec(readFileSync("drizzle/migrations/0036_accounting_ap.sql", "utf8"));
await db.exec(
  "CREATE TABLE mcp_billing_documents(id uuid PRIMARY KEY,company_id uuid,job_id uuid,filename text,sha256 text);CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer);CREATE TABLE mcp_living_reports(job_id uuid,report_type text,version integer,data jsonb);",
);
await db.exec(readFileSync("drizzle/migrations/0049_supplier_buyout_workflows.sql", "utf8"));
await db.query("INSERT INTO mcp_living_reports VALUES($1,'cpm',1,$2),($1,'cpm',2,$3)", [
  poIds.job,
  { activities: [{ id: "PROC-1", name: "Distribution material delivery" }] },
  { activities: [{ id: "PROC-1", name: "Distribution material delivery" }] },
]);
const functions: Record<string, string[]> = {
  mcp_project_purchase_orders_get: ["_job"],
  mcp_project_purchase_orders_review: ["_job", "_action", "_p", "_review"],
  mcp_project_purchase_orders_record: ["_job", "_action", "_p", "_review", "_confirmed"],
  mcp_buyout_get: ["_company", "_job"],
};
async function asActor(actor: string, sql: string, params: unknown[]) {
  await db.exec("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: actor, role: "authenticated", email: "synthetic@example.invalid" }),
    ]);
    await db.exec("SET LOCAL ROLE authenticated");
    const r = await db.query(sql, params);
    await db.exec("COMMIT");
    return r.rows;
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}
async function seed(kind: string, facts: unknown) {
  const p = [
    poIds.company,
    poIds.job,
    randomUUID(),
    kind,
    0,
    facts,
    "Synthetic local demonstration",
    randomUUID(),
    randomUUID(),
  ];
  await asActor(poIds.owner, "SELECT mcp_buyout_review($1,$2,$3,$4,$5,$6,$7,$8,$9)", p);
  await asActor(poIds.owner, "SELECT mcp_buyout_record($1,$2,$3,$4,$5,$6,$7,$8,$9,true)", p);
}
await seed("package", {
  code: "ELEC-26",
  title: "Distribution equipment",
  scope: "Electrical distribution materials",
  budget_cents: 1600000,
  currency: "USD",
  status: "selected",
  candidates: [
    {
      party_id: poIds.party,
      party_version: 1,
      quote_cents: 1240000,
      scope: "Conduit and distribution materials",
      exclusions: null,
      source: "Synthetic quote Q1",
      quoted_on: "2026-10-29",
      expected_delivery_on: "2026-11-02",
    },
  ],
  selected_party_id: poIds.party,
  commitment_refs: [{ po_id: poIds.po, version: 1 }],
  expected_award_on: "2026-10-30",
  needed_by: "2026-11-02",
  submittal_ids: [],
  schedule_ref: { report_version: 1, activity_id: "PROC-1" },
  source: "Synthetic scope register",
});
await seed("readiness", {
  party_id: poIds.party,
  party_version: 1,
  source: "Synthetic supplied clause 9",
  requirements: [
    {
      key: "insurance",
      label: "Insurance evidence",
      kind: "insurance",
      applicability: "required",
      source: "Synthetic supplied clause 9",
      jurisdiction: null,
      due_on: null,
      document_id: null,
      document_sha256: null,
      effective_on: null,
      expires_on: null,
      review: "pending",
      review_note: null,
      exception_expires_on: null,
      bill_id: null,
      bill_version: null,
    },
  ],
});
let queue = Promise.resolve();
createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  if (u.pathname.startsWith("/fixture/")) {
    let raw = "";
    for await (const c of req) {
      raw += c;
      if (raw.length > 150000) {
        res.writeHead(413);
        res.end();
        return;
      }
    }
    const execute = async () => {
      try {
        const actor = String(req.headers["x-synthetic-actor"] ?? "");
        if (!Object.values(poIds).includes(actor as typeof poIds.owner))
          throw new Error("Unknown synthetic actor");
        const p = JSON.parse(raw);
        let rows;
        if (u.pathname === "/fixture/context") {
          if (p.table === "mcp_jobs")
            rows = await asActor(
              actor,
              "SELECT id,company_id,job_number,name FROM mcp_jobs WHERE id=$1",
              [p.id],
            );
          else if (p.table === "mcp_companies")
            rows = await asActor(actor, "SELECT id,name FROM mcp_companies WHERE id=$1", [p.id]);
          else throw new Error("Unsupported context");
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              data: rows[0] ?? null,
              error: rows.length ? null : { message: "Unavailable" },
            }),
          );
          return;
        }
        const keys = functions[p.name];
        if (!keys) throw new Error("Unsupported synthetic function");
        rows = await asActor(
          actor,
          `SELECT public.${p.name}(${keys.map((_, i) => "$" + (i + 1)).join(",")}) AS x`,
          keys.map((k) => p.args[k] ?? null),
        );
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: rows[0].x, error: null }));
      } catch (e) {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            data: null,
            error: { message: e instanceof Error ? e.message : String(e) },
          }),
        );
      }
    };
    queue = queue.then(execute, execute);
    await queue;
    return;
  }
  if (u.pathname === "/app.js" || u.pathname === "/app.css") {
    res.setHeader("content-type", u.pathname.endsWith(".js") ? "text/javascript" : "text/css");
    res.end(readFileSync("output/playwright/purchase-orders" + u.pathname));
    return;
  }
  const role = u.searchParams.get("role"),
    user =
      role === "pm"
        ? poIds.pm
        : role === "ap"
          ? poIds.ap
          : role === "contracts"
            ? poIds.contracts
            : role === "super"
              ? poIds.super
              : role === "outsider"
                ? poIds.outsider
                : poIds.owner;
  res.setHeader("content-type", "text/html");
  res.end(
    `<!doctype html><html><head><title>PO workspace - synthetic local rehearsal</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0}</style></head><body><div id="root"></div><script>window.PO_FIXTURE=${JSON.stringify({ user, job: u.searchParams.has("empty") ? poIds.job2 : poIds.job, anonymous: u.searchParams.has("anonymous"), buyout: u.pathname.endsWith("/buyout") || u.searchParams.has("buyout") })}</script><script type="module" src="/app.js"></script></body></html>`,
  );
}).listen(4187, "127.0.0.1", () =>
  process.stdout.write("Synthetic PO workspace: http://127.0.0.1:4187\n"),
);
