import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { renderReportBody } from "../report-pages";
import { openItemFeed } from "./open-feed";

const job = "289ca2cd-b585-419a-8c09-3501d1be48c3";
const rows = ["AJ", "Justin", "Preston", "Dan", "Miguel"].map((owner, i) => ({
  id: `item-${i}`,
  action: "2708 – add",
  check_key: `manual:record-${i}`,
  owner,
  due: i === 0 ? "2026-11-09" : "2026-11-13",
  next_action: `Await supplier response ${i}. Source: message ${i}; thread ${i}.`,
}));

describe("distinct saved follow-ups", () => {
  it("keeps separately identified manual records and consistent counts while retaining meeting deduplication", () => {
    const feed = openItemFeed([...rows, rows[0],
      { id: "meeting-1", action: "No change orders pending, confirmed.", check_key: "pm:change_orders" },
      { id: "meeting-2", action: "No change orders pending, confirmed.", check_key: "pm:change_orders" },
    ], "2026-10-27");
    expect(feed.items.map((item) => item.id)).toEqual(expect.arrayContaining(rows.map((row) => row.id)));
    expect(feed.counts).toEqual({ open: 6, overdue: 0, due_in_7_days: 0 });
    expect(feed.items.filter((item) => item.check_key === "pm:change_orders")).toHaveLength(1);
  });

  it("shows each saved next action and source reference on the board without interpreting it", () => {
    const html = renderReportBody({ page: "items", job_number: "2708", items: rows });
    for (const row of rows) {
      expect(html).toContain(`id="item-${row.id}"`);
      expect(html).toContain(row.owner);
      expect(html).toContain(row.next_action);
    }
    expect(html.match(/>Follow-up<\/div>/g)).toHaveLength(5);
    expect(html).not.toContain("Overdue");
    const escaped = renderReportBody({ page: "items", items: [{ ...rows[0], next_action: "<script>alert(1)</script>" }] });
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
    const descriptive = renderReportBody({ page: "items", items: [{ ...rows[0], action: "Obtain equipment information" }] });
    expect(descriptive).toContain("Obtain equipment information");
    expect(descriptive).toContain(rows[0].next_action);
  });

  it("returns detail only to full-scope page callers and retains internal-item filtering", async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
        CREATE TABLE public.mcp_open_items (
          id uuid, job_id uuid, action text, owner text, accountable text,
          due_date date, needed_by date, item_type text, kind text, severity text,
          category text, check_key text, status text, internal_only boolean, next_action text
        );
        CREATE FUNCTION public.mcp_job_scope(uuid) RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.scope', true) $$;
        SELECT set_config('test.scope', 'full', false);`);
      await db.exec(readFileSync("supabase/migrations/20261027141002_athena_open_item_followup_detail.sql", "utf8"));
      await db.query(`INSERT INTO public.mcp_open_items (id, job_id, action, owner, check_key, status, internal_only, next_action)
        VALUES ('11111111-1111-4111-8111-111111111111', $1, 'add', 'Supplier', 'manual:a', 'open', false, 'Saved provider receipt and thread'),
               ('22222222-2222-4222-8222-222222222222', $1, 'Internal', 'PM', 'manual:b', 'open', true, 'Private detail')`, [job]);
      const full = await db.query<{ items: { next_action: string | null }[] }>("SELECT public.mcp_report_open_items($1, false) AS items", [job]);
      const limited = await db.query<{ items: { next_action: string | null }[] }>("SELECT public.mcp_report_open_items($1, true) AS items", [job]);
      expect(full.rows[0].items).toHaveLength(2);
      expect(full.rows[0].items.map((item) => item.next_action)).toEqual(expect.arrayContaining(["Saved provider receipt and thread", "Private detail"]));
      expect(limited.rows[0].items).toHaveLength(1);
      expect(limited.rows[0].items[0].next_action).toBeNull();
      // Some existing page payloads call the helper with false even for a
      // superintendent; actual job scope must still prevent detail leakage.
      await db.exec("SELECT set_config('test.scope', 'super', false)");
      const nested = await db.query<{ items: { next_action: string | null }[] }>("SELECT public.mcp_report_open_items($1, false) AS items", [job]);
      expect(nested.rows[0].items.every((item) => item.next_action === null)).toBe(true);
    } finally { await db.close(); }
  });
});
