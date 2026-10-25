import { describe, expect, it } from "vitest";
import { requestLogCard, requestLogUrl, type RequestLogPayload } from "./request-log";
import { renderHtml } from "./cards/html";
import { renderMarkdown } from "./cards/markdown";
import { boardSignInReturn } from "../board-sign-in";
import { paletteViolations } from "./cards/palette";

const job = "00000000-0000-4000-8000-000000000094";
const board = `https://app.meetathena.io/r/job/${job}/submittals?t=${"x".repeat(43)}`;
const payload: RequestLogPayload = {
  job_id: job,
  job_number: "2701",
  job_name: "Fictional Job",
  today: "2026-10-25",
  read_only: false,
  records: [
    {
      id: "one",
      number: "RFI-001",
      title: "RFI #12 · Bulletin #4",
      revision: 0,
      transmittal_number: 1,
      state: "sent",
      request_details: {
        condition: "Grid B/3",
        question: "Which detail applies to CO #3?",
        references: [{ kind: "drawing", citation: "A101 detail 4" }],
        recipient_name: "Pat Example",
        due_date: "2026-10-24",
      },
    },
    {
      id: "two",
      number: "RFI-002",
      title: "Response pending review",
      revision: 0,
      transmittal_number: 2,
      state: "answered",
      request_details: {
        condition: "Connection",
        question: "Confirm the connection",
        references: [{ kind: "spec", citation: "05 12 00 ¶2.3" }],
        due_date: "2026-10-22",
      },
    },
  ],
};

describe("RFI/RFC log cards reuse the persistent package records", () => {
  it("ties filters, counts and linked rows to the same saved records", () => {
    const full = requestLogCard("rfi", payload, board);
    const late = requestLogCard("rfi", payload, board, { overdue: true });
    expect(full.counts).toEqual({ total: 2, shown: 2, overdue: 1 });
    expect(late.records.map((r) => r.id)).toEqual(["one"]);
    expect(late.card.sections?.[0].rows[0].href).toBe(
      `https://app.meetathena.io/r/job/${job}/submittal/RFI-001?t=${"x".repeat(43)}`,
    );
    expect(late.card.sections?.[0].rows[0].cells).toContain("Yes");
    expect(full.card.sections?.[0].rows[1].flag).toBeNull();
  });
  it("distinguishes an empty filtered view from an empty job log", () => {
    const view = requestLogCard("rfi", payload, board, { state: "closed" });
    const text = renderMarkdown(view.card);
    expect(text).toContain("No matching RFIs. 2 on this log.");
    expect(text).not.toContain("No RFIs on this job yet");
    expect(view.counts).toEqual({ total: 2, shown: 0, overdue: 0 });
  });
  it("preserves member text, source references and the live log link in both renderers", () => {
    const view = requestLogCard("rfi", payload, board, {}, "RFI-001");
    for (const text of [renderHtml(view.card), renderMarkdown(view.card)]) {
      for (const expected of [
        "RFI #12",
        "Bulletin #4",
        "CO #3",
        "A101 detail 4",
        "Open live RFI log",
      ])
        expect(text).toContain(expected);
      expect(text).toContain(`/r/job/${job}/rfis?t=`);
      expect(text).not.toMatch(/REQUIRED VIEW|Card shown\. Do not add text/);
    }
    expect(paletteViolations(renderHtml(view.card), true)).toEqual([]);
  });
  it("retains the request's exact return address and token without accepting another origin", () => {
    const url = requestLogUrl(board, "rfc")!;
    const relative = new URL(url).pathname + new URL(url).search;
    expect(boardSignInReturn(relative)).toBe(relative);
    expect(requestLogUrl(board.replace("app.meetathena.io", "example.com"), "rfi")).toBeNull();
    expect(boardSignInReturn("//example.com/r/job/" + job + "/rfis")).toBeUndefined();
  });
  it("escapes member markup without deleting a construction reference", () => {
    const row = { ...payload.records[0], title: '<img src=x onerror="alert(1)"> RFI #12' };
    const html = renderHtml(requestLogCard("rfi", { ...payload, records: [row] }, board).card);
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("RFI #12");
  });
});
