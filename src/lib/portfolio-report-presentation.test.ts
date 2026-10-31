import { describe, expect, it } from "vitest";
import {
  pageAllowed,
  renderReportBody,
  type PortfolioJob,
  type PortfolioPayload,
} from "./report-pages";

const job = (overrides: Partial<PortfolioJob> = {}): PortfolioJob => ({
  job_id: "11111111-1111-4111-8111-111111111111",
  job_number: "SYN-01",
  name: "Synthetic portfolio job",
  ...overrides,
});
const render = (jobs: PortfolioJob[], money = true) =>
  renderReportBody({ page: "portfolio", jobs, money });
const tile = (html: string, label: string) =>
  html.slice(html.indexOf(`>${label}</div>`) + label.length + 7).match(/^<div[^>]*>([^<]*)/)?.[1];

describe("portfolio saved-evidence presentation", () => {
  it.each([undefined, null])("distinguishes a missing schedule (%s) from health", (cpm) => {
    const html = render([job({ cpm })]);
    expect(html).toContain("No saved schedule");
    expect(html).toContain("Schedule not saved");
    expect(html).not.toMatch(/On track|Needs attention/);
  });

  it.each([undefined, null])(
    "does not infer baseline health from a schedule without TIA (%s)",
    (tia) => {
      const html = render([job({ cpm: { version: 4, tia } })]);
      expect(html).toContain("No saved TIA");
      expect(html).toContain("Schedule v4");
      expect(html).not.toMatch(/On track|Needs attention/);
    },
  );

  it.each([
    {},
    { prior_completion: "2026-11-26" },
    { updated_completion: "2026-12-17" },
    { prior_completion: "", updated_completion: "2026-12-17" },
    { prior_completion: "2026-02-30", updated_completion: "2026-12-17" },
    { prior_completion: "2026-11-26", updated_completion: "2026-13-01" },
    { prior_completion: "2026-11-26", updated_completion: "not-a-date" },
    { prior_completion: "2026-11-26", updated_completion: "2026-12" },
    { prior_completion: "2026-11-26", updated_completion: "2026-12-17Tbad" },
    { prior_completion: "2026-11-26", updated_completion: 20261217 },
    { prior_completion: null, updated_completion: "2026-12-17" },
  ])("excludes incomplete or malformed TIA dates: %j", (tia) => {
    const html = render([
      job({ cpm: { version: 1, tia: tia as NonNullable<PortfolioJob["cpm"]>["tia"] } }),
    ]);
    expect(html).toContain("TIA dates unavailable");
    expect(tile(html, "Jobs with later TIA completion")).toBe("0");
    expect(html).not.toMatch(/On track|Needs attention|NaN|Delay:/);
  });

  it.each([
    ["2026-12-17", "Later TIA completion", "1"],
    ["2026-11-26", "No TIA completion change", "0"],
    ["2026-11-20", "Earlier TIA completion", "0"],
  ])("labels valid movement to %s by its actual basis", (updated, label, count) => {
    const html = render([
      job({
        cpm: { version: 1, tia: { prior_completion: "2026-11-26", updated_completion: updated } },
      }),
    ]);
    expect(html).toContain(label);
    expect(tile(html, "Jobs with later TIA completion")).toBe(count);
    expect(html.includes("Needs attention")).toBe(count === "1");
    expect(html).toContain("does not establish baseline health");
    expect(html).toContain("Jobs without valid TIA dates are excluded");
    expect(html).not.toContain("On track");
  });

  it("honors leap dates and the saved holiday calendar for positive TIA movement", () => {
    const html = render([
      job({
        cpm: {
          version: 1,
          tia: {
            prior_completion: "2024-02-29",
            updated_completion: "2024-03-01",
            holidays: ["2024-03-01"],
          },
        },
      }),
    ]);
    expect(html).toContain("Later TIA completion");
    expect(html).toContain("Delay: +0 WD (1 CD)");
  });

  it.each([undefined, null, "", "2026-02-30", "2026-12", "2026-12-17Tbad", 20261217])(
    "does not present an unavailable completion date (%s) as a real date",
    (completion_date) => {
      const html = render([job({ completion_date: completion_date as string })]);
      expect(html).toContain("Completion Needed");
      if (completion_date) expect(html).not.toContain(String(completion_date));
    },
  );

  it("preserves a valid completion date without using it to infer TIA movement", () => {
    const html = render([job({ completion_date: "2024-02-29" })]);
    expect(html).toContain("Completion 2024-02-29");
    expect(html).toContain("No saved schedule");
  });

  it("keeps mixed evidence scoped to each job and preserves the source", () => {
    const jobs = [
      job({ name: "Missing schedule" }),
      job({ name: "Zero contract", cpm: { version: 1, contract_total: 0 } }),
      job({
        name: "Invalid TIA",
        cpm: {
          version: 1,
          tia: { prior_completion: "2026-02-30", updated_completion: "2026-12-17" },
        },
      }),
      job({
        name: "Later completion",
        cpm: {
          version: 1,
          contract_total: 4500,
          tia: { prior_completion: "2026-11-26", updated_completion: "2026-12-17" },
        },
      }),
    ];
    const before = JSON.stringify(jobs);
    const html = render(jobs);
    const attention = html.slice(html.indexOf("Needs attention")).split("</section>")[0];
    expect(tile(html, "Jobs with later TIA completion")).toBe("1");
    expect(tile(html, "Contract value")).toBe("Unknown");
    expect(html).toContain("Contract $0.00");
    expect(attention).toContain("Later completion");
    expect(attention).not.toMatch(/Missing schedule|Zero contract|Invalid TIA/);
    expect(JSON.stringify(jobs)).toBe(before);
  });

  it.each([undefined, null, NaN, Infinity, "4500"])(
    "marks partial contract coverage unknown (%s)",
    (contract_total) => {
      const html = render([
        job({ cpm: { version: 1, contract_total: 4500 } }),
        job({ cpm: { version: 1, contract_total: contract_total as number } }),
      ]);
      expect(tile(html, "Contract value")).toBe("Unknown");
      expect(html).toContain("Contract Unknown");
      expect(html).toContain("Contract $4,500.00");
    },
  );

  it.each(
    [[], [job()], [job({ cpm: null })], [job({ cpm: { version: 1 } })]].map((jobs) => ({ jobs })),
  )("marks absent contract coverage unknown: %j", ({ jobs }) => {
    const html = render(jobs);
    expect(tile(html, "Contract value")).toBe("Unknown");
    expect(html).not.toContain("$0.00");
  });

  it.each([
    [0, 0, "$0.00"],
    [0, 4500, "$4,500.00"],
    [4500, 5500, "$10,000.00"],
  ])("preserves complete contract values including genuine zero: %s + %s", (a, b, total) => {
    const html = render([
      job({ cpm: { version: 1, contract_total: a } }),
      job({ cpm: { version: 1, contract_total: b } }),
    ]);
    expect(tile(html, "Contract value")).toBe(total);
    expect(html).not.toContain("Unknown");
  });

  it.each([false, undefined])("shows no financial output when money is %s", (money) => {
    const payload: PortfolioPayload = {
      page: "portfolio",
      money,
      jobs: [job({ cpm: { version: 1, contract_total: 4500 } }), job()],
    };
    const before = JSON.stringify(payload);
    const html = renderReportBody(payload);
    expect(html).not.toMatch(/Contract|\$|4,500|4500/);
    expect(JSON.stringify(payload)).toBe(before);
  });

  it.each(["full", "contract", "super", null, undefined] as const)(
    "preserves leadership-only portfolio access for scope %s",
    (scope) => {
      expect(pageAllowed("portfolio", scope, false)).toBe(false);
      expect(pageAllowed("portfolio", scope, true)).toBe(true);
    },
  );
});
