// The change order record page reads as a change order: money, time, who approved and how, and the contract after.
import { describe, expect, it } from "vitest";
import {
  changeOrderDecided,
  clientApproved,
  renderChangeOrderRecord,
} from "./change-order-record-page";
import { renderSubmittalRecordBody, type SubmittalRecordPayload } from "./submittal-record-page";
import type { ChangeDetails } from "./mcp/change-orders";

const JOB = "11111111-1111-4111-8111-111111111111";
const DECISION = "22222222-2222-4222-8222-222222222222";

const executed = (): ChangeDetails =>
  ({
    state: "executed",
    record_version: 2,
    co_number: "CO-001",
    origin: "owner",
    condition: "Client picked the Better package on their client page.",
    scope: "Change track lighting to the Better package fixtures.",
    references: [
      { citation: "Sheet E-201 lighting plan" },
      { citation: `Customer page decision ${DECISION}` },
    ],
    lines: [
      {
        category: "material",
        description: "Track heads, Better",
        quantity: 6,
        unit: "ea",
        unit_rate_cents: 29150,
        source: "Selection",
        amount_cents: 174900,
      },
      {
        category: "markup",
        description: "Overhead and profit",
        rate_basis_points: 1717,
        source: "Contract",
        amount_cents: 30030,
      },
    ],
    total_cents: 204930,
    schedule_days: 0,
    decision: {
      by: "Pat Client <pat@example.com>",
      at: "2026-11-06T22:14:00Z",
      reference: `Customer page decision ${DECISION}`,
      channel: "customer_page",
      fingerprint: "abc123fingerprint",
      email_code_verified: true,
    },
    execution: {
      by: "Pat Client <pat@example.com>",
      at: "2026-11-06T22:14:00Z",
      reference: `Customer page decision ${DECISION}`,
      sov_item: "div.026",
      channel: "customer_page",
      authority: "client_signed_approval",
      contract_before_cents: 48000000,
      contract_after_cents: 48204930,
    },
  }) as unknown as ChangeDetails;

describe("change order record page", () => {
  it("shows amount, time, approval and the new contract value, with the proof folded away", () => {
    const html = renderChangeOrderRecord({
      jobId: JOB,
      jobNumber: "2810",
      jobName: "Lakeside Remodel",
      number: "PCO-001",
      title: "Better package: Change Track Lighting Upgrade",
      details: executed(),
      history: [],
      zones: { job: "America/Manaus" },
      timeline: "<section>TL</section>",
    });
    expect(html).toContain("CO-001 · Better package: Change Track Lighting Upgrade");
    expect(html).toContain("+$2,049.30");
    expect(html).toContain("0 days");
    expect(html).toContain("No added time");
    expect(html).toContain("By the client · emailed code");
    expect(html).toContain("$482,049.30");
    expect(html).toContain("Was $480,000.00");
    expect(html).toContain("On the contract");
    expect(html).toContain("$480,000.00 → $482,049.30");
    expect(html).toContain("<summary>Approval proof</summary>");
    expect(html).toContain(`href="/r/job/${JOB}/cos"`);
    expect(html).toContain(`href="/r/job/${JOB}/home"`);
    // Drawing references show; the decision reference sits only under the proof.
    const what = html.slice(html.indexOf("What changed"), html.indexOf("Pricing"));
    expect(what).toContain("Sheet E-201 lighting plan");
    expect(what).not.toContain(DECISION);
    const proof = html.slice(html.indexOf("Approval proof"));
    expect(proof).toContain(DECISION);
    expect(proof).toContain("abc123fingerprint");
    // Pricing is a plain table with rates, and no submittal wording anywhere.
    expect(html).toContain("<th>Qty</th>");
    expect(html).toContain("6 ea");
    for (const gone of [
      "Upload a package piece",
      "Ball in court",
      "Package send receipt",
      "Transmittal",
    ]) {
      expect(html).not.toContain(gone);
    }
  });

  it("says plainly when a change order is not approved or not priced yet", () => {
    const d = {
      ...executed(),
      state: "draft",
      decision: null,
      execution: null,
      lines: [],
      total_cents: null,
      schedule_days: null,
    } as ChangeDetails;
    const html = renderChangeOrderRecord({
      number: "PCO-002",
      title: "Extra outlet",
      details: d,
      zones: {},
      timeline: "",
    });
    expect(html).toContain("Draft, not sent");
    expect(html).toContain("Not priced");
    expect(html).toContain("Joins once approved");
    expect(html).not.toContain("Approval proof");
    expect(clientApproved(d)).toBe(false);
    expect(changeOrderDecided(d)).toBe(false);
    expect(clientApproved(executed())).toBe(true);
    expect(changeOrderDecided(executed())).toBe(true);
  });

  it("is what the submittal record page renders for a change order", () => {
    const payload = {
      page: "submittal",
      job_id: JOB,
      job_number: "2810",
      job_name: "Lakeside Remodel",
      number: "PCO-001",
      time_zone: "America/Manaus",
      current: {
        number: "PCO-001",
        title: "Better package: Change Track Lighting Upgrade",
        package_purpose: "change_order",
        change_order_details: executed(),
        change_order_history: [],
      },
      events: [],
    } as unknown as SubmittalRecordPayload;
    const html = renderSubmittalRecordBody(payload);
    expect(html).toContain('data-change-order="PCO-001"');
    expect(html).toContain("New contract value");
    expect(html).not.toContain("Ball in court");
  });
});
