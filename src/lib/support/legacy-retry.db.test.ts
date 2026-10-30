import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { processSupportInbound } from "./process.ts";
import type { SupportTicketStore } from "./store.ts";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;",
  );
  await db.exec(readFileSync("supabase/migrations/20261028194500_support_tickets.sql", "utf8"));
  for (let n = 0; n < 4; n++) {
    await db.query(
      "select * from open_support_ticket($1,'athena','pat@example.com','Legacy',$2,now(),'original summary')",
      [`legacy-${n}`, `<legacy-${n}@example.com>`],
    );
    await db.query(
      "update support_tickets set autoreply_sent_at=$2, notify_sent_at=$3 where resend_email_id=$1",
      [`legacy-${n}`, n & 1 ? "2026-10-28T00:00:00Z" : null, n & 2 ? "2026-10-28T00:00:00Z" : null],
    );
  }
  await db.exec(
    readFileSync("drizzle/migrations/0043_support_conversations_owner_review.sql", "utf8"),
  );
});
afterAll(async () => {
  await db?.close();
});
async function record(
  id: string,
  sender = "pat@example.com",
  brand = "athena",
  evidence: unknown = { text: "retrieved full original" },
  review: string | null = null,
) {
  return (
    await db.query<{ r: any }>(
      "select record_support_message($1,$2,$3,'Legacy',null,now(),'new summary',$4,'{}',$5,false,null,true) r",
      [id, brand, sender, evidence, review],
    )
  ).rows[0].r;
}
it.each([0, 1, 2, 3])(
  "backfilled delivery combination %i terminates retries without changing evidence or resending",
  async (n) => {
    const before = (
      await db.query("select * from support_messages where resend_email_id=$1", [`legacy-${n}`])
    ).rows;
    const counters = (await db.query("select * from support_ticket_counters order by brand")).rows;
    let deliveries = 0;
    const store = {
      open: async () => {
        const r = await record(`legacy-${n}`);
        return {
          ...r,
          messageRecordId: r.message_record_id,
          receiptMessageId: r.receipt_message_id,
          reviewReason: r.review_reason,
          ackPreview: r.ack_preview,
          legacyImport: r.legacy_import,
        };
      },
      claimDelivery: async () => {
        deliveries++;
        throw Error("must not deliver");
      },
    } as unknown as SupportTicketStore;
    for (let retry = 0; retry < 3; retry++) {
      const result = await processSupportInbound(`legacy-${n}`, {
        apiKey: "test",
        env: { ATHENA_SUPPORT_ACK_LIVE: "true" },
        store,
        fetchImpl: (async (_url, init) => {
          expect(init?.method ?? "GET").toBe("GET");
          return new Response(
            JSON.stringify({
              from: "pat@example.com",
              to: ["support@meetathena.io"],
              subject: "Legacy",
              text: "retrieved full original",
            }),
          );
        }) as typeof fetch,
      });
      expect(result).toMatchObject({
        status: "processed",
        autoreply: n & 1 ? "already" : "review",
        notify: n & 2 ? "already" : "review",
      });
    }
    const r = await record(`legacy-${n}`);
    for (const kind of ["ack", "owner"]) {
      const claimed = await db.query<{ r: any }>("select claim_support_delivery($1,$2,'{}') r", [
        r.message_record_id,
        kind,
      ]);
      expect(claimed.rows[0].r.state).toBe("review");
    }
    expect(deliveries).toBe(0);
    expect(
      (await db.query("select * from support_messages where resend_email_id=$1", [`legacy-${n}`]))
        .rows,
    ).toEqual(before);
    expect((await db.query("select * from support_ticket_counters order by brand")).rows).toEqual(
      counters,
    );
    expect((await db.query("select * from support_deliveries")).rows).toEqual([]);
  },
);
it("retains identity isolation for legacy retries", async () => {
  await expect(record("legacy-0", "other@example.com")).rejects.toThrow(
    "support identity mismatch",
  );
  await expect(record("legacy-0", "pat@example.com", "circle")).rejects.toThrow(
    "support identity mismatch",
  );
});
it("caller-controlled legacy labels cannot bypass immutable new-message evidence", async () => {
  const r = await record(
    "new-message",
    "pat@example.com",
    "athena",
    { legacy_summary: "fake", original_requires_retrieval: true },
    "legacy_requires_review",
  );
  expect(r.legacy_import).toBe(false);
  await expect(record("new-message")).rejects.toThrow("provider evidence mismatch");
});
