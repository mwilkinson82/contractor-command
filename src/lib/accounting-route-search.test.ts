import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  defaultParseSearch,
  defaultStringifySearch,
} from "@tanstack/react-router";
import type { ReactElement } from "react";

// Exercise the real file route and its component selection, without auth, RPCs or financial data.
vi.mock("@/components/athena/AccountingRecordPage", () => ({ AccountingRecordPage: () => null }));
vi.mock("@/components/athena/AccountingReportPage", () => ({ AccountingReportPage: () => null }));
vi.mock("@/components/athena/ReportPage", () => ({ ReportPageView: () => null }));
vi.mock("@/components/athena/PurchaseOrdersPage", () => ({ PurchaseOrdersPage: () => null }));
vi.mock("@/components/athena/ProductionReportPage", () => ({ ProductionReportPage: () => null }));
vi.mock("@/components/athena/BillingEvidencePage", () => ({ BillingEvidencePage: () => null }));
vi.mock("@/components/athena/JobHome", () => ({ JobHome: () => null }));
import { Route } from "@/routes/r.job.$jobId.$page";
import { AccountingRecordPage } from "@/components/athena/AccountingRecordPage";
import { AccountingReportPage } from "@/components/athena/AccountingReportPage";
import {
  accountingRecordUrl,
  accountingReportUrl,
  type AccountingTarget,
} from "./accounting-record-target";

const job = "00000000-0000-4000-8000-000000000001",
  record = "00000000-0000-4000-8000-000000000002",
  payable = "00000000-0000-4000-8000-000000000003";
const path = `/r/job/${job}/accounting`;
const targets: AccountingTarget[] = [
  { kind: "invoice", id: record, version: 4 },
  { kind: "credit", id: record, version: 2 },
  { kind: "payable", id: record, version: 2 },
  { kind: "receipt", id: record },
  { kind: "allocation", id: record },
  { kind: "payment", id: record, payableId: payable },
];
function routerFor(href: string) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/r/job/$jobId/$page",
    validateSearch: Route.options.validateSearch,
  });
  return createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [href] }),
  });
}
function renderSelected(search: Record<string, unknown>) {
  vi.spyOn(Route, "useParams").mockReturnValue({ jobId: job, page: "accounting" } as never);
  vi.spyOn(Route, "useSearch").mockReturnValue(search as never);
  return (Route.options.component as () => ReactElement<Record<string, unknown>>)();
}
afterEach(() => vi.restoreAllMocks());
describe("actual route search serialization and financial target selection", () => {
  it("covers the live failure shape: a bare version=4 is JSON-decoded to a number", () => {
    const parsed = defaultParseSearch(`?record_kind=invoice&record_id=${record}&version=4`);
    expect((parsed as Record<string, unknown>).version).toBe(4);
  });
  it.each(targets)(
    "opens the exact emitted $kind target through the real router",
    async (target) => {
      const url = new URL(accountingRecordUrl(job, target, { as_of: "2026-10-31" }));
      const router = routerFor(url.pathname + url.search);
      await router.load();
      const search = router.state.matches.at(-1)!.search;
      const element = renderSelected(search);
      expect(element.type).toBe(AccountingRecordPage);
      expect(element.props.target).toEqual(target);
      expect(element.props.invalid).not.toBe(true);
      expect(element.props.dates).toEqual({ as_of: "2026-10-31", from: undefined });
    },
  );
  it("preserves selected version on document navigation, Back and Forward", async () => {
    const v4 = new URL(accountingRecordUrl(job, targets[0]));
    const v5 = new URL(accountingRecordUrl(job, { ...targets[0], version: 5 }));
    const router = routerFor(v4.pathname + v4.search);
    await router.load();
    // These are native <a> links; simulate document navigation in memory history.
    router.history.push(v5.pathname + v5.search);
    router.updateLatestLocation();
    await router.load();
    expect(renderSelected(router.state.matches.at(-1)!.search).props.target).toEqual({
      ...targets[0],
      version: 5,
    });
    router.history.back();
    router.updateLatestLocation();
    await router.load();
    expect(renderSelected(router.state.matches.at(-1)!.search).props.target).toEqual(targets[0]);
    router.history.forward();
    router.updateLatestLocation();
    await router.load();
    expect(renderSelected(router.state.matches.at(-1)!.search).props.target).toEqual({
      ...targets[0],
      version: 5,
    });
  });
  it.each([
    "0",
    "-1",
    "4.5",
    "1000000000",
    "true",
    "null",
    "%7B%7D",
    "%5B4%5D",
    "bad",
    "4&version=5",
  ])("keeps invalid version=%s as an explicit target error", async (value) => {
    const router = routerFor(`${path}?record_kind=invoice&record_id=${record}&version=${value}`);
    await router.load();
    const element = renderSelected(router.state.matches.at(-1)!.search);
    expect(element.type).toBe(AccountingRecordPage);
    expect(element.props.invalid).toBe(true);
    expect(element.props.target).toBeNull();
  });
  it("supports both JSON-string and numeric router serialization without changing identity", async () => {
    for (const version of [4, "4"]) {
      const router = routerFor(
        path + defaultStringifySearch({ record_kind: "invoice", record_id: record, version }),
      );
      await router.load();
      expect(renderSelected(router.state.matches.at(-1)!.search).props.target).toEqual(targets[0]);
    }
  });
  it.each(["summary", "receivables", "costs", "statement", "evidence"] as const)(
    "preserves %s report mode and ledger pagination without treating them as record targets",
    async (mode) => {
      const url = new URL(accountingReportUrl(job, mode, { as_of: "2026-10-31" }));
      if (mode === "evidence") url.searchParams.set("ledger_page", "2");
      const router = routerFor(url.pathname + url.search);
      await router.load();
      const element = renderSelected(router.state.matches.at(-1)!.search);
      expect(element.type).toBe(AccountingReportPage);
      expect(element.props.initialReportType).toBe(mode);
      if (mode === "evidence") expect(String(element.props.initialPage)).toBe("2");
    },
  );
  it("does not let a malformed kind or identity disappear into a generic report", async () => {
    for (const q of [
      "record_kind=true&record_id=null",
      "record_kind=invoice&record_id=4",
      "record_kind=payment&record_id=" + record + "&payable_id=false",
    ]) {
      const router = routerFor(path + "?" + q);
      await router.load();
      const element = renderSelected(router.state.matches.at(-1)!.search);
      expect(element.type).toBe(AccountingRecordPage);
      expect(element.props.invalid).toBe(true);
    }
  });
});
