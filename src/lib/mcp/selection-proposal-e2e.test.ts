// End to end on a local database: the member's AI sources products for a
// takeoff line, the contractor reviews prices, the customer sees the
// comparison through a link, and the chosen package is recorded. The real
// tools and the real release-proposal SQL run; only the MCP auth wrapper is
// replaced by a test client signed in as each member.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { fakeClient } from "../../../tests/mcp-roles/fake-supabase";
import { changeTermsBoardSql, choiceStageSql, gbbSql } from "../../../tests/selections/sql";
import { openProposalShare } from "../selection-proposal-share.server";
import { setPageFetch } from "../selections/product-page";

const who = vi.hoisted(() => ({ user: "", db: null as unknown }));
vi.mock("./guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./guard")>();
  return {
    ...actual,
    run: async (_tool: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) =>
      fn(
        fakeClient(who.db as PGlite, {
          sub: who.user,
          email: "member@example.com",
          role: "authenticated",
        }),
      ),
  };
});
import { selectionBoard, selectionProposal } from "./tools/selection-board-tool";

const owner = "00000000-0000-4000-8000-000000000a01";
const estimator = "00000000-0000-4000-8000-000000000a02";
const company = "00000000-0000-4000-8000-000000000a10";
const job = "00000000-0000-4000-8000-000000000a20";
let db: PGlite;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool results are read field by field in assertions
type Result = { content: { text: string }[]; structuredContent: Record<string, any> };
const handler = (t: unknown) =>
  (t as { handler: (a: unknown, c: unknown) => Promise<Result> }).handler;
const board = (args: Record<string, unknown>, user = owner) => {
  who.user = user;
  return handler(selectionBoard)({ job_number: "2810", company_id: company, ...args }, {});
};
const proposal = (args: Record<string, unknown>, user = owner) => {
  who.user = user;
  return handler(selectionProposal)({ job_number: "2810", company_id: company, ...args }, {});
};

beforeAll(async () => {
  // No seller pages on the network in tests: a missing photo or price stays missing.
  setPageFetch(async () => new Response("", { status: 404 }));
  db = await makeDb();
  who.db = db;
  await db.exec(readFileSync("supabase/migrations/20261022200000_athena_estimating.sql", "utf8"));
  await db.exec(
    readFileSync("supabase/migrations/20261022230000_athena_estimating_bid.sql", "utf8"),
  );
  await db.exec("ALTER FUNCTION public.mcp_estimate_guard(uuid) VOLATILE");
  await db.exec(`CREATE OR REPLACE FUNCTION public.mcp_is_company_leader(_company uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
    SELECT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid() AND role = 'owner') $$`);
  for (const sql of gbbSql()) await db.exec(sql);
  await db.exec(choiceStageSql());
  await db.exec(changeTermsBoardSql());
  for (const id of [owner, estimator]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'member@example.com')", [id]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [id]);
  }
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'ALP Construction',$2)", [
    company,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Owner'),($1,$3,'estimating','Estimator')",
    [company, owner, estimator],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Willow Creek Community Center — Electrical','2810',$3)",
    [job, owner, company],
  );
  const t = await db.query<{ id: string }>(
    "INSERT INTO mcp_estimate_takeoffs(job_id,company_id,version,created_by) VALUES($1,$2,1,$3) RETURNING id",
    [job, company, owner],
  );
  await db.query(
    `INSERT INTO mcp_estimate_takeoff_lines(takeoff_id,job_id,line_no,item,qty,unit,measure_type,sheet,basis,math,confidence,trade,note)
     VALUES($1,$2,3,'Type A black track heads',9,'ea','count','E1','measured','9 ea counted on E1','high','Electrical',
     'E1 13W 90CRI; A4.1 10W 80CRI conflict G03. Pricing blank; subject to estimator review.')`,
    [t.rows[0].id, job],
  );
});
afterAll(async () => db?.close());

const candidate = (n: number) => ({
  description: `Track head option ${n}`,
  manufacturer: "Example Lighting",
  model: `TH-${n}`,
  specifications: "13W · 90 CRI · black",
  included: ["Head and installation"],
  product_url: `https://lighting.example.com/th-${n}`,
  source_url: `https://distributor.example.com/th-${n}`,
  // Search results often carry spaces; the tool encodes them before checking.
  photo_url: `https://img.example.com/th ${n}.jpg`,
  found_price_cents: 5000 * n,
  found_at: "Example distributor list price",
  found_on: "2026-11-04",
});

describe.sequential("Good, Better, Best from takeoff line to recorded choice", () => {
  let version = 0;
  let selectionId = "";

  it("starts a selection from the takeoff line and hands the AI a sourcing brief", async () => {
    const r = await board(
      { action: "start", expected_version: 0, estimate_line_ref: "T-3" },
      estimator,
    );
    version = r.structuredContent.version;
    selectionId = r.structuredContent.board.selections[0].id;
    expect(r.structuredContent.board.selections[0]).toMatchObject({
      title: "Type A black track heads",
      quantity: 9,
      unit: "ea",
      estimate_line_ref: "T-3",
    });
    const text = r.content[0].text;
    expect(text).toContain("Sourcing brief for Type A black track heads");
    expect(text).toContain("conflict G03");
    expect(text).toContain("propose_option");
    // Starting the same line again does not duplicate it.
    const again = await board(
      { action: "start", expected_version: version, estimate_line_ref: "T-3" },
      estimator,
    );
    version = again.structuredContent.version;
    expect(again.structuredContent.board.selections).toHaveLength(1);
  });

  it("stores AI-found products as unreviewed leads that don't count toward a package", async () => {
    for (const [n, tier] of [
      [1, "good"],
      [2, "better"],
      [3, "best"],
    ] as const) {
      const r = await board(
        {
          action: "propose_option",
          expected_version: version,
          selection_id: selectionId,
          tier,
          candidate: candidate(n),
        },
        estimator,
      );
      version = r.structuredContent.version;
    }
    const read = await board({ action: "read" });
    expect(read.structuredContent.board.selections[0].options.best).toMatchObject({
      model: "TH-3",
      found_price_cents: 15000,
      cost_cents: null,
      price_cents: null,
      price_reviewed_on: null,
    });
    expect(read.structuredContent.packages.best.total_cents).toBeNull();
    expect((await proposal({ action: "preview" })).structuredContent.ready).toBe(false);
    await expect(
      board({
        action: "propose_option",
        expected_version: version - 1,
        selection_id: selectionId,
        tier: "good",
        candidate: candidate(9),
      }),
    ).rejects.toThrow(/changed/);
  });

  it("only counts prices the contractor confirms, and shows them cost, markup and margin", async () => {
    await expect(
      board({
        action: "review_price",
        expected_version: version,
        selection_id: selectionId,
        tier: "good",
        cost_cents: 5000,
        price_cents: 7000,
      }),
    ).rejects.toThrow(/confirm/);
    for (const [tier, cost, price] of [
      ["good", 5000, 7000],
      ["better", 10000, 14000],
      ["best", 15000, 21000],
    ] as const) {
      const r = await board({
        action: "review_price",
        expected_version: version,
        selection_id: selectionId,
        tier,
        cost_cents: cost,
        price_cents: price,
        confirmed: true,
      });
      version = r.structuredContent.version;
    }
    const r = await board({
      action: "set_proposal",
      expected_version: version,
      currency: "USD",
      proposal: {
        title: "Willow Creek track lighting options",
        base_price_cents: 4_850_000,
        base_basis: "Bid summary",
      },
      review_base_price: true,
      confirmed: true,
    });
    version = r.structuredContent.version;
    expect(r.structuredContent.blockers).toEqual([]);
    expect(r.structuredContent.packages.better).toEqual({
      total_cents: 4_913_000,
      difference_cents: 63_000,
    });
    expect(r.content[0].text).toContain(
      "Better: proposal total USD 49,130.00 · +USD 630.00 vs base",
    );
    expect(r.content[0].text).toContain("margin USD 360.00 (28.6%), markup 40.0%");
    expect(r.content[0].text).toContain("INTERNAL, not for the customer");
  });

  it("previews and shares the customer comparison with no cost or margin", async () => {
    const preview = await proposal({ action: "preview" });
    expect(preview.structuredContent.ready).toBe(true);
    const text = preview.content[0].text;
    expect(text).toContain("Better: USD 49,130.00 · +USD 630.00 vs base");
    for (const secret of ["50.00", "cost", "margin", "markup", "distributor", "found"])
      expect(text.toLowerCase().split("no costs, margin or notes").join("")).not.toContain(secret);
    await expect(proposal({ action: "share", expected_version: version })).rejects.toThrow(
      /confirm/,
    );
    await expect(
      proposal({ action: "share", expected_version: version, confirmed: true }, estimator),
    ).rejects.toThrow();
    const share = await proposal({
      action: "share",
      expected_version: version,
      confirmed: true,
      days: 14,
    });
    const url: string = share.structuredContent.url;
    expect(url).toMatch(/^https:\/\/app\.meetathena\.io\/p\/s\/[A-Za-z0-9_-]{43}$/);
    const resolver = async (hash: string) =>
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE anon");
        return (
          await tx.query<{ d: unknown }>(
            "SELECT public.mcp_selection_proposal_share_open($1) AS d",
            [hash],
          )
        ).rows[0].d;
      });
    const page = await openProposalShare(url.split("/").pop()!, "GET", resolver);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Willow Creek track lighting options");
    expect(html).toContain("$49,130.00");
    expect(html).toContain("+$630.00 upgrade");
    expect(html).toContain('src="https://img.example.com/th%202.jpg"');
    // The maker page stays on the contractor side: no product link reaches the customer.
    expect(html).not.toContain("lighting.example.com");
    // No contract value on file, so the page talks about the proposal price, not a change order.
    expect(html).not.toMatch(/change order/i);
    for (const secret of [
      "$50.00",
      "$100.00",
      "Example distributor",
      "Bid summary",
      "distributor.example.com",
    ])
      expect(html).not.toContain(secret);
    expect(page.headers.get("content-security-policy")).toContain("img-src data: https:");
    const revoked = await proposal({ action: "revoke", link: url });
    expect(revoked.content[0].text).toContain("is off");
    expect((await openProposalShare(url.split("/").pop()!, "GET", resolver)).status).toBe(410);
  });

  it("records the customer's choice and hands the estimator the estimate lines to confirm", async () => {
    const pricingBefore = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.mcp_estimate_pricing",
    );
    await expect(
      proposal({
        action: "record_choice",
        expected_version: version,
        tier: "better",
        evidence: "Customer email",
      }),
    ).rejects.toThrow(/confirm/);
    const r = await proposal({
      action: "record_choice",
      expected_version: version,
      tier: "better",
      evidence: "Customer email Nov 4",
      confirmed: true,
    });
    expect(r.structuredContent.accepted).toMatchObject({ tier: "better", total_cents: 4_913_000 });
    expect(r.structuredContent.estimate_carry.carry).toEqual([
      {
        ref: "T-3",
        unit_price: 100,
        unit: "ea",
        item: "Type A black track heads",
        product: "Example Lighting TH-2",
      },
    ]);
    expect(r.content[0].text).toContain("not done yet; needs the estimator's yes");
    expect(r.content[0].text).toContain(
      "No contract, budget, SOV, billing or accounting record was changed",
    );
    const pricingAfter = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.mcp_estimate_pricing",
    );
    expect(pricingAfter.rows[0].n).toBe(pricingBefore.rows[0].n);
    const preview = await proposal({ action: "preview" });
    expect(preview.content[0].text).toContain("Selected: Better");
    version = r.structuredContent.version;
  });

  it("asking for the sourcing brief again changes nothing, so the recorded choice stands", async () => {
    const again = await board(
      { action: "start", expected_version: version, estimate_line_ref: "T-3" },
      estimator,
    );
    expect(again.structuredContent.saved).toBe(false);
    expect(again.structuredContent.version).toBe(version);
    expect((await proposal({ action: "preview" })).content[0].text).toContain("Selected: Better");
  });

  it("a full save cannot mark a changed price reviewed", async () => {
    const read = await board({ action: "read" });
    const edited = structuredClone(read.structuredContent.board);
    edited.selections[0].options.best.price_cents = 99_000;
    edited.selections[0].options.best.price_reviewed_on = "2026-11-04";
    const r = await board({ action: "save", expected_version: version, board: edited }, estimator);
    version = r.structuredContent.version;
    expect(r.structuredContent.board.selections[0].options.best.price_reviewed_on).toBeNull();
    expect(r.structuredContent.reviews_cleared).toEqual(["Type A black track heads (Best) price"]);
    expect(r.content[0].text).toContain("Marked not reviewed again");
    expect((await proposal({ action: "preview" })).structuredContent.ready).toBe(false);
  });

  it("a new base-tier product clears the base price review, because the base includes it", async () => {
    const r = await board({
      action: "propose_option",
      expected_version: version,
      selection_id: selectionId,
      tier: "good",
      candidate: { ...candidate(4), found_price_cents: 4000 },
    });
    version = r.structuredContent.version;
    expect(r.structuredContent.board.proposal.base_reviewed_on).toBeNull();
    expect(r.structuredContent.reviews_cleared).toContain("base proposal price");
    expect(r.structuredContent.blockers).toContain("Review the base proposal price.");
  });
});
