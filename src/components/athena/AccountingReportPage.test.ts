import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sources } from "../../../tests/fixtures/accounting-evidence";
import { buildAccountingReport } from "@/lib/accounting-report";
const auth = vi.hoisted(() => ({ signedIn: false }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    session: auth.signedIn ? { user: { id: "synthetic-member" } } : null,
    loading: false,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({}) }));
vi.mock("./BoardSignIn", () => ({
  BoardSignIn: ({ returnTo }: { returnTo: string }) =>
    React.createElement("p", null, `Sign in ${returnTo}`),
}));
import { AccountingReportPage, AccountingReportView } from "./AccountingReportPage";
describe("private accounting report", () => {
  it("has a functional table, dated basis, source drill-down and explicit coverage", () => {
    const report = buildAccountingReport(sources(), { asOf: "2026-10-28" });
    const html = renderToStaticMarkup(React.createElement(AccountingReportView, { report }));
    for (const text of [
      "Recorded amounts",
      "$100.00",
      "USD",
      "2026-10-28",
      "not a complete P&amp;L",
      "labor/material/equipment",
      "Read source evidence",
      "Download accountant CSV",
      "Synthetic concrete",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("Unposted correction");
  });
  it("requires sign-in for financial data", () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountingReportPage, { jobId: "private-job" }),
    );
    expect(html).toContain("Sign in /r/job/private-job/accounting");
    expect(html).not.toContain("Recorded amounts");
  });
  it("keeps the requested date basis in native GET navigation for refresh and bookmarks", () => {
    auth.signedIn = true;
    try {
      const html = renderToStaticMarkup(
        React.createElement(AccountingReportPage, {
          jobId: "synthetic-job",
          initialFrom: "2026-10-10",
          initialAsOf: "2026-10-28",
        }),
      );
      expect(html).toContain('action="/r/job/synthetic-job/accounting"');
      expect(html).toContain('method="get"');
      expect(html).toContain('name="as_of"');
      expect(html).toContain('value="2026-10-10"');
      expect(html).toContain('value="2026-10-28"');
    } finally {
      auth.signedIn = false;
    }
  });
});
