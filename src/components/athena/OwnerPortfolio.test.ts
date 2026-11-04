import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { JobMoneyRead } from "@/lib/owner-portfolio";

const JOB_A = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";
const JOB_C = "33333333-3333-4333-8333-333333333333";
const state = vi.hoisted(() => ({
  data: undefined as unknown,
  opts: [] as { refetchInterval?: number | false; refetchIntervalInBackground?: boolean }[],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { refetchInterval?: number | false; refetchIntervalInBackground?: boolean }) => {
    state.opts.push(opts);
    return { data: state.data, isLoading: false, error: null };
  },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

import { OwnerPortfolio } from "./OwnerPortfolio";
import { PORTFOLIO_MONEY_REFRESH_MS } from "@/lib/owner-portfolio-read";

const read = (contract: number | null, billed: number | null): JobMoneyRead => ({
  ok: true,
  money: {
    originalCents: contract,
    changeCents: 0,
    contractCents: contract,
    billedCents: billed,
    receivedCents: billed,
    retainageCents: 0,
    unpaidCents: 0,
    costCents: 10_000_00,
    budgetCents: contract ? contract * 0.8 : null,
    oldestUnpaidDate: null,
  },
});

describe("owner portfolio page", () => {
  it("shows totals, job cards linked to each job board, missing IORs and estimating jobs", () => {
    state.data = {
      [JOB_A]: read(250_000_00, 100_000_00),
      [JOB_B]: read(150_000_00, 30_000_00),
      [JOB_C]: read(null, 0),
    };
    const html = renderToStaticMarkup(
      createElement(OwnerPortfolio, {
        visible: true,
        payload: {
          page: "portfolio",
          company: "Synthetic Electric",
          money: true,
          jobs: [
            {
              job_id: JOB_A,
              job_number: "3101",
              name: "Harbor school",
              pm: "Morgan",
              completion_date: "2026-12-11",
              cpm: { version: 1, data_date: "2026-11-01" },
              ior: { version: 2, data: {} },
            },
            {
              job_id: JOB_B,
              job_number: "3102",
              name: "Fire station",
              pm: "Riley",
              completion_date: "2027-05-28",
              cpm: { version: 1, data_date: "2026-11-01" },
              ior: null,
            },
            {
              job_id: JOB_C,
              job_number: "3103",
              name: "Data hall bid",
              pm: null,
              completion_date: null,
              cpm: null,
              ior: null,
            },
          ],
        },
      }),
    );
    expect(html).toContain("Synthetic Electric · Portfolio");
    expect(html).toContain("2 active jobs");
    expect(html).toContain("$400K");
    expect(html).toContain("IOR saved on 1 of 2 jobs");
    expect(html).toContain("IOR missing on 1 job");
    expect(html).toContain(`href="/r/job/${JOB_B}/home"`);
    expect(html).toContain("Estimating");
    expect(html).toContain("3103 Data hall bid");
    expect(html).toMatch(/Running into \d{4}/);
    expect(state.opts[0].refetchInterval).toBe(PORTFOLIO_MONEY_REFRESH_MS);
    expect(state.opts[0].refetchIntervalInBackground).toBe(false);
  });

  it("makes no money reads while the tab is hidden", () => {
    state.opts = [];
    state.data = {};
    renderToStaticMarkup(
      createElement(OwnerPortfolio, { visible: false, payload: { page: "portfolio", jobs: [] } }),
    );
    expect(state.opts[0].refetchInterval).toBe(false);
  });
});
