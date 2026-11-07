import { it, expect } from "vitest";
import { changeLogCard, type ChangeLogPayload } from "./change-orders";
import { renderHtml } from "./cards/html";
import { renderMarkdown } from "./cards/markdown";
import { paletteViolations } from "./cards/palette";
it("keeps the change log separate, links each record and preserves exact construction references", () => {
  const p: ChangeLogPayload = {
    job_id: "00000000-0000-4000-8000-000000000094",
    job_number: "2701",
    job_name: "Fictional Job",
    today: "2026-10-25",
    read_only: false,
    records: [
      {
        id: "record",
        number: "PCO-001",
        title: "CO #3 · Bulletin #4",
        revision: 0,
        transmittal_number: 1,
        change_order_details: {
          state: "priced",
          record_version: 2,
          origin: "contractor",
          condition: "A101 changed",
          scope: "RFI #12 revises the connection",
          references: [{ kind: "drawing", citation: "A101 detail 4" }],
          lines: [
            {
              category: "material",
              description: "Connection plates",
              source: "Quote #282",
              quantity: 1,
              unit_rate_cents: 10000,
              amount_cents: 10000,
            },
          ],
          total_cents: 10000,
        },
      },
    ],
  };
  const board = `https://app.meetathena.io/r/job/${p.job_id}/submittals?t=${"x".repeat(43)}`;
  const full = changeLogCard(p, board, {}, "PCO-001");
  expect(full.log_url).toContain("/cos?t=");
  expect(full.records[0].record_url).toContain("/submittal/PCO-001?t=");
  for (const text of [renderHtml(full.card), renderMarkdown(full.card)])
    for (const term of [
      "CO #3",
      "Bulletin #4",
      "RFI #12",
      "Quote #282",
      "$100.00",
      "Open live change-order log",
    ])
      expect(text).toContain(term);
  expect(
    paletteViolations(renderHtml(full.card).match(/<style>([\s\S]*?)<\/style>/)![1], false),
  ).toEqual([]);
  const empty = changeLogCard(p, board, { state: "executed" });
  expect(renderMarkdown(empty.card)).toContain("No matching change orders. 1 on this log.");
  expect(empty.counts.shown).toBe(0);
});
it("a change order from the customer's pick shows its per-unit rate and says it matches the signed version", () => {
  const p: ChangeLogPayload = {
    job_id: "00000000-0000-4000-8000-000000000095",
    job_number: "2810",
    job_name: "Fictional Job",
    today: "2026-11-07",
    read_only: false,
    records: [
      {
        id: "pick",
        number: "PCO-001",
        title: "Better package: Track lighting",
        revision: 0,
        transmittal_number: 1,
        change_order_details: {
          state: "approved",
          record_version: 1,
          co_number: "CO-001",
          origin: "owner",
          condition: "The customer chose Better on the customer page.",
          scope: "Change from Good to Better.",
          references: [],
          lines: [
            {
              category: "material",
              description: "White heads",
              quantity: 18,
              unit: "ea",
              source: "Signed package choice",
              amount_cents: 136620,
            },
            {
              category: "material",
              description: "Odd heads",
              quantity: 7,
              unit: "ea",
              source: "Signed package choice",
              amount_cents: 1000,
            },
            {
              category: "other",
              description: "Added labor",
              source: "Signed package choice",
              amount_cents: 5000,
            },
          ],
          total_cents: 142620,
          schedule_days: 0,
          customer_choice: {
            tier: "better",
            at: "2026-11-07T00:24:04Z",
            reference: "Customer page decision x",
          },
        },
      },
    ],
  };
  const md = renderMarkdown(changeLogCard(p, null, {}, "CO-001").card);
  expect(md).toContain("$75.90");
  expect(md).toContain("Lump sum");
  expect(md).not.toContain("Rate needed");
  expect(md).toContain("Built from the exact version the customer signed");
});
it("reads a client-approved change order as on the contract, with no raw ids or the client's email", () => {
  const decision = {
    by: "Marshall Wilkinson <marshall@example.com>",
    at: "2026-11-07T00:24:04Z",
    reference: "Customer page decision 92f3e897-491f-4339-baec-cc9aaeeaa07a",
    channel: "customer_page",
    fingerprint: "585c1ca9efee5fa36c6054cd4183735580aab5c10a09a0a1526c762d38d1e779",
    email_code_verified: true,
  };
  const p: ChangeLogPayload = {
    job_id: "00000000-0000-4000-8000-000000000096",
    job_number: "2810",
    job_name: "Fictional Job",
    today: "2026-11-07",
    read_only: false,
    records: [
      {
        id: "pick",
        number: "PCO-001",
        title: "Better package: Track lighting",
        revision: 0,
        transmittal_number: 2,
        change_order_details: {
          state: "executed",
          record_version: 2,
          co_number: "CO-001",
          origin: "owner",
          condition: "The customer chose Better on the customer page.",
          scope: "Change from Good to Better.",
          references: [
            {
              kind: "condition",
              citation: `${decision.reference} (Better, fingerprint ${decision.fingerprint})`,
            },
          ],
          lines: [
            {
              category: "material",
              description: "White heads",
              quantity: 18,
              unit: "ea",
              unit_rate_cents: 7590,
              source: `Signed package choice, customer page decision 92f3e897-491f-4339-baec-cc9aaeeaa07a`,
              amount_cents: 136620,
            },
          ],
          total_cents: 136620,
          schedule_days: 0,
          decision,
          execution: {
            ...decision,
            sov_item: "26.001",
            authority: "client_signed_approval",
            contract_before_cents: 48000000,
            contract_after_cents: 48136620,
          },
        },
      },
    ],
  };
  const view = changeLogCard(p, null, {}, "CO-001");
  for (const text of [renderHtml(view.card), renderMarkdown(view.card)]) {
    expect(text).toContain("On the contract");
    expect(text).toContain(
      "Added to the contract by the client's approval: $480,000.00 → $481,366.20",
    );
    expect(text).toContain(
      "CO-001 is on the contract by the client's approval: $480,000.00 → $481,366.20. Nothing else to do.",
    );
    expect(text).toContain(
      "Approved by Marshall Wilkinson on the client page with an emailed code, signed with their typed name",
    );
    expect(text).toContain("Signed package choice, customer page decision");
    expect(text).toContain("The client's signed approval on their client page");
    for (const raw of [
      "92f3e897",
      "585c1ca9",
      "marshall@example.com",
      "separate confirmed action",
      "executed",
    ])
      expect(text).not.toContain(raw);
  }
});
it("says an approved change order still joins the contract when it is executed", () => {
  const p: ChangeLogPayload = {
    job_id: "00000000-0000-4000-8000-000000000097",
    job_number: "2701",
    job_name: "Fictional Job",
    today: "2026-11-07",
    read_only: false,
    records: [
      {
        id: "member",
        number: "PCO-002",
        title: "Owner directive",
        revision: 0,
        transmittal_number: 3,
        change_order_details: {
          state: "approved",
          record_version: 3,
          co_number: "CO-002",
          origin: "owner",
          condition: "Owner directive 4.",
          scope: "Add two outlets.",
          references: [{ kind: "contract", citation: "Directive 4" }],
          lines: [],
          total_cents: 50000,
          decision: {
            by: "Rosa Delgado <rosa@example.com>",
            at: "2026-11-06T12:00:00Z",
            reference: "Directive 4 signed",
          },
        },
      },
    ],
  };
  const md = renderMarkdown(changeLogCard(p, null, {}, "CO-002").card);
  expect(md).toContain("Approved, not on the contract yet");
  expect(md).toContain("Approved by Rosa Delgado · Directive 4 signed");
  expect(md).toContain("Approved. It joins the contract when it is executed.");
  expect(md).toContain(
    "CO-002 is approved. It joins the contract when you execute it with its supporting reference.",
  );
  expect(md).not.toContain("rosa@example.com");
});
