import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({
  session: null as unknown,
  record: {} as Record<string, unknown>,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ session: state.session, loading: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) =>
    options.queryKey[0] === "accounting-record"
      ? state.record
      : { data: { job_number: "SYN-1", name: "Synthetic project" } },
}));
vi.mock("@/components/athena/BoardSignIn", () => ({
  BoardSignIn: ({ returnTo }: { returnTo: string }) =>
    createElement("p", { "data-return-to": returnTo }, "Sign in"),
}));
import {
  AccountingRecordPage,
  AccountingRecordView,
} from "@/components/athena/AccountingRecordPage";
import { accountingTargetFromSearch } from "./accounting-record-target";
import { type RecordDetail } from "./accounting-record-read";
const job = "00000000-0000-4000-8000-000000000001",
  invoice = "00000000-0000-4000-8000-000000000002";
const detail: RecordDetail = {
  title: "SYN-I01 · v4",
  subtitle: "Historical version; current is v5",
  facts: [["Net due", "USD 500.00"]],
  history: [{ label: "Version 4", facts: [["Revision reason", "Quantity corrected"]] }],
  related: [],
  originals: [{ id: "original", filename: "<untrusted>.pdf" }],
  originalsNote: "",
};
beforeEach(() => {
  state.session = { user: { id: "synthetic" } };
  state.record = { data: detail, isFetching: false, error: null };
});
it("renders exact selected version, amounts, original evidence and history without financial action forms", () => {
  const html = renderToStaticMarkup(createElement(AccountingRecordView, { detail }));
  expect(html).toContain("USD 500.00");
  expect(html).toContain("Version 4");
  expect(html).toContain("&lt;untrusted&gt;.pdf");
  expect(html).not.toMatch(/<form|Approve|Allocate|Send payment|Post bill/);
});
it("preserves exact target/version and report cutoff in the actual sign-in return", () => {
  state.session = null;
  const html = renderToStaticMarkup(
    createElement(AccountingRecordPage, {
      jobId: job,
      target: { kind: "invoice", id: invoice, version: 4 },
      dates: { as_of: "2026-10-31" },
    }),
  );
  expect(html).toContain("record_kind=invoice");
  expect(html).toContain("version=4");
  expect(html).toContain("as_of=2026-10-31");
  expect(html).not.toContain("USD 500.00");
});
it("hides cached financial detail after access/read failure", () => {
  state.record = { data: detail, error: new Error("denied"), isFetching: false };
  const html = renderToStaticMarkup(
    createElement(AccountingRecordPage, {
      jobId: job,
      target: { kind: "invoice", id: invoice, version: 4 },
    }),
  );
  expect(html).toContain("Record unavailable");
  expect(html).not.toContain("USD 500.00");
  expect(html).not.toContain("SYN-I01");
});
it("retains an invalid target as an explicit error instead of rendering a report or another record", () => {
  expect(() => accountingTargetFromSearch({ record_kind: "invoice", record_id: "bad" })).toThrow();
  const html = renderToStaticMarkup(
    createElement(AccountingRecordPage, { jobId: job, target: null, invalid: true }),
  );
  expect(html).toContain("incomplete or invalid");
  expect(html).not.toContain("USD 500.00");
});
