import { describe, expect, it } from "vitest";
import { decisionFacts, laborRows, profileFacts, shopTile, toolFacts, workAnswers, NOT_SAVED } from "@/lib/company-board-model";
import { companyBoardPath, companyBoardUrl } from "@/lib/company-board";
import { setupSteps } from "@/lib/account-profile";

const ID = "8a6f4d2e-1b3c-4d5e-8f90-123456789abc";

describe("company board", () => {
  it("lives at /r/company/<id> on the Athena app", () => {
    expect(companyBoardPath(ID)).toBe(`/r/company/${ID}`);
    expect(companyBoardUrl(ID)).toBe(`https://app.meetathena.io/r/company/${ID}`);
    expect(() => companyBoardPath("not-a-company")).toThrow();
  });

  it("shows all 8 kinds-of-work answers in order, open ones as not saved", () => {
    const { answers, answered, total } = workAnswers({
      markets: ["private_commercial", "public_low_bid"],
      pricing: ["lump_sum"],
      shop: "both",
      wage_rules: ["pla", "prevailing_wage"],
      unit_price: "yes",
      skipped: ["regions"],
    });
    expect(total).toBe(8);
    expect(answered).toBe(6);
    expect(answers.map((a) => a.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(answers[0].value).toEqual(["Private commercial", "Low-bid public work"]);
    expect(answers[2]).toMatchObject({ value: "Skipped", state: "skipped" });
    expect(answers[3].value).toBe("Union and open shop");
    expect(answers[4].value).toBe("PLA, Prevailing wage, Union rates, Open-shop wages");
    expect(answers[7]).toMatchObject({ value: NOT_SAVED, state: "open" });
  });

  it("splits labor rules into a union row and an open-shop row", () => {
    const { rows, askedOnEachJob } = laborRows({ shop: "both", wage_rules: ["pla", "prevailing_wage"] });
    expect(rows).toEqual([
      { work: "Union jobs", rules: "PLA, Prevailing wage, Union rates" },
      { work: "Open shop jobs", rules: "Prevailing wage, Open-shop wages" },
    ]);
    expect(askedOnEachJob).toMatch(/^Is it union or open shop/);
    expect(laborRows({ shop: "open_shop", wage_rules: [] }).rows).toEqual([{ work: "Open shop jobs", rules: "Open-shop wages" }]);
    expect(laborRows({}).rows).toEqual([]);
    expect(shopTile({ shop: "both" })).toBe("Union + open");
  });

  it("reads authority, tools and profile without inventing values", () => {
    expect(decisionFacts({ buyout: ["owner"], change_orders: ["owner", "pm"], claims: [] })).toEqual([
      { label: "Buyout", value: "Owner" },
      { label: "Change orders", value: "Owner, PM" },
    ]);
    expect(toolFacts({ accounting: "QuickBooks", project_management: "Procore", blank: " " })).toEqual([
      { label: "Accounting", value: "QuickBooks" },
      { label: "Project management", value: "Procore" },
    ]);
    const facts = profileFacts({ id: ID, company_role: "Electrical sub", time_zone: "America/New_York" });
    expect(facts.find((f) => f.label === "What you do")?.value).toBe("Electrical sub");
    expect(facts.find((f) => f.label === "Trades")?.value).toBe(NOT_SAVED);
    expect(facts.find((f) => f.label === "Company time zone")?.value).toContain("America/New_York");
  });

  it("points the account checklist's profile step at the company board", () => {
    const step = setupSteps({ profile: null, members: 1, pending: 0, payments: null, companyId: ID }).find((s) => s.id === "profile")!;
    expect(step.href).toBe(`/r/company/${ID}`);
    expect(step.action).toBe("Open company board");
    expect(setupSteps({ profile: null, members: 1, pending: 0, payments: null }).find((s) => s.id === "profile")!.href).toBe("#company");
  });
});

describe("company board in chat", () => {
  it("opens from report_page_link page company with a real link", async () => {
    const { COMPANY_BOARD_PAGES, companyBoardCard } = await import("@/lib/mcp/tools/report-page-tools");
    expect(COMPANY_BOARD_PAGES).toEqual(expect.arrayContaining(["company", "company board", "company profile"]));
    const card = companyBoardCard(companyBoardUrl(ID));
    expect(card.title).toBe("Company board");
    expect(card.sections?.[0]?.rows[0]).toMatchObject({ cells: ["Open your company board"], href: `https://app.meetathena.io/r/company/${ID}` });
  });

  it("routes 'view company profile' to the company board in the server instructions", async () => {
    const { COMPANY_BOARD_ROUTE_RULE } = await import("@/lib/mcp/board-url");
    expect(COMPANY_BOARD_ROUTE_RULE).toContain('"view company profile"');
    expect(COMPANY_BOARD_ROUTE_RULE).toContain('page "company"');
  });
});
