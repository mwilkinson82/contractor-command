import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sources } from "../../../tests/fixtures/accounting-evidence";
import { buildAccountingReport } from "@/lib/accounting-report";
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ session: null, loading: false }) }));
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
});
