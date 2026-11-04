import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requestLogCard, type RequestLogPayload } from "@/lib/mcp/request-log";
import { AthenaPage, CardModelPage } from "./AthenaPage";

const job = "22222222-2222-4222-8222-222222222222";
const board = `https://app.meetathena.io/r/job/${job}/submittals?t=board`;
const payload: RequestLogPayload = {
  job_id: job,
  job_number: "2810",
  job_name: "Willow Creek Community Center — Electrical",
  today: "2026-11-04",
  read_only: false,
  records: [
    {
      id: "r1",
      number: "RFI-001",
      title: "Type A / A1 Track Lighting — Fixture Specifications",
      revision: 0,
      state: "sent",
      transmittal_number: 1,
      request_details: {
        due_date: "2026-11-01",
        recipient_name: "Architect",
        references: [{ citation: "26097E.pdf, E1 — Lighting Fixture Schedule" }],
      } as unknown as RequestLogPayload["records"][number]["request_details"],
    },
  ],
};

function page(card: ReturnType<typeof requestLogCard>["card"]) {
  return renderToStaticMarkup(
    React.createElement(
      AthenaPage,
      { jobId: job, token: "board", account: "pm@example.com" },
      React.createElement(CardModelPage, { card, skip: ["Live log"] }),
    ),
  );
}

describe("Athena web page shell", () => {
  it("lays the RFI log out as a full page table with phone labels, not the chat card", () => {
    const html = page(requestLogCard("rfi", payload, board).card);
    expect(html).toContain('class="ath-page"');
    expect(html).toContain('class="ath-page-table"');
    expect(html).toContain('data-label="Ball in court"');
    expect(html).toContain(`/r/job/${job}/home?t=board`);
    expect(html).toContain("Browser account: pm@example.com");
    expect(html).toContain(">RFI-001 · Revision 0 · Transmittal 1</a>");
    // Overdue rows keep the one alert color as a flag, and the self link to this page is dropped.
    expect(html).toContain('data-alert="overdue"');
    expect(html).not.toContain("Open live RFI log");
    expect(html).not.toContain('class="card"');
  });

  it("shows an empty log as a message, not a row of dashes", () => {
    const html = page(requestLogCard("rfi", { ...payload, records: [] }, board).card);
    expect(html).toContain('<p class="ath-page-empty">No RFIs on this job yet.</p>');
    expect(html).not.toContain("<table");
  });

  it("uses the full desktop width, a tablet table scroll and stacked phone rows", () => {
    const css = readFileSync(join(__dirname, "athena-page.css"), "utf8");
    expect(css).toContain("max-width: 1440px");
    expect(css).toMatch(/@media \(max-width: 1024px\)[\s\S]*min-width: 860px/);
    expect(css).toMatch(/@media \(max-width: 820px\)[\s\S]*content: attr\(data-label\)/);
    expect(css).not.toMatch(/#1e5fed/i);
  });
});
