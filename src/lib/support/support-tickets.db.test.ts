import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);
  await db.exec(readFileSync("supabase/migrations/20261028194500_support_tickets.sql", "utf8"));
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("reset role");
  await db.exec("truncate public.support_tickets");
  await db.exec("update public.support_ticket_counters set last_number = 0");
});

function open(
  resendId: string,
  brand: "athena" | "circle",
  from = "pat@example.com",
  subject = "Gate code",
  messageId: string | null = "<gate@example.com>",
) {
  return db.query<{
    ticket_number: string;
    brand: string;
    from_email: string;
    inserted: boolean;
    message_id: string | null;
    resend_email_id: string;
  }>(
    `select ticket_number, brand, from_email, inserted, message_id, resend_email_id
     from public.open_support_ticket($1, $2, $3, $4, $5, $6, $7)`,
    [resendId, brand, from, subject, messageId, "2026-10-28T12:00:00Z", "The gate code changed."],
  );
}

it("numbers each brand on its own sequence", async () => {
  const first = await open("em_1", "athena");
  const circle = await open(
    "em_circle",
    "circle",
    "ada@example.com",
    "Access",
    "<circle@example.com>",
  );
  const second = await open(
    "em_2",
    "athena",
    "ada@example.com",
    "Follow up",
    "<follow@example.com>",
  );
  expect(first.rows[0]).toMatchObject({
    ticket_number: "ATH-0001",
    brand: "athena",
    from_email: "pat@example.com",
    inserted: true,
  });
  expect(circle.rows[0]?.ticket_number).toBe("CIR-0001");
  expect(second.rows[0]?.ticket_number).toBe("ATH-0002");
  const counters = await db.query<{ brand: string; last_number: number }>(
    "select brand, last_number from public.support_ticket_counters order by brand",
  );
  expect(counters.rows).toEqual([
    { brand: "athena", last_number: 2 },
    { brand: "circle", last_number: 1 },
  ]);
});

it("is idempotent on resend email id and message id", async () => {
  const created = await open("em_1", "athena");
  const sameEmail = await open("em_1", "athena");
  const sameMessage = await open(
    "em_2",
    "athena",
    "other@example.com",
    "Again",
    "<GATE@example.com>",
  );
  expect(sameEmail.rows[0]).toMatchObject({ ticket_number: "ATH-0001", inserted: false });
  expect(sameMessage.rows[0]).toMatchObject({ ticket_number: "ATH-0001", inserted: false });
  expect(created.rows[0]?.inserted).toBe(true);
  const count = await db.query<{ n: number }>(
    "select count(*)::int as n from public.support_tickets",
  );
  expect(count.rows[0]?.n).toBe(1);
  const next = await open("em_3", "athena", "new@example.com", "New", null);
  expect(next.rows[0]?.ticket_number).toBe("ATH-0002");
});

it("keeps going past four digits and blocks anon", async () => {
  await db.exec(
    "update public.support_ticket_counters set last_number = 9999 where brand = 'athena'",
  );
  const wide = await open("em_wide", "athena", "pat@example.com", "Wide", "<wide@example.com>");
  expect(wide.rows[0]?.ticket_number).toBe("ATH-10000");

  await db.exec("set role service_role");
  const asService = await open(
    "em_service",
    "circle",
    "ada@example.com",
    "Service",
    "<svc@example.com>",
  );
  expect(asService.rows[0]?.ticket_number).toBe("CIR-0001");
  await db.exec("reset role");

  await db.exec("set role anon");
  await expect(
    open("em_anon", "athena", "pat@example.com", "Nope", "<anon@example.com>"),
  ).rejects.toThrow(/permission denied/i);
  await db.exec("reset role");
  await db.exec("set role authenticated");
  await expect(db.query("select * from public.support_tickets")).rejects.toThrow(
    /permission denied/i,
  );
});
