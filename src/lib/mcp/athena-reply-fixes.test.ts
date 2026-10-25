import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attachAthenaCard } from "./cards/attach";
import { inferCard } from "./cards/infer";
import { renderHtml } from "./cards/html";
import { DATA_DATE_FUTURE_ERROR, iorSectionsText, resolveDataDate } from "./living";
import { phoneLookaheadText } from "./phone-reply";
import { companyProjectSoftware } from "./scope-defaults";
import { activityIdName } from "./styled-views";

const livingTools = readFileSync(new URL("./tools/living-tools.ts", import.meta.url), "utf8");
const workflow = readFileSync(new URL("./tools/workflow-tools.ts", import.meta.url), "utf8");

describe("lookahead activity ids", () => {
  it("prints split activities with the id and the name", () => {
    expect(activityIdName({ id: "A1110a", name: "Underground conduit rough-in" })).toBe(
      "A1110a – Underground conduit rough-in",
    );
    expect(activityIdName({ id: "A1120b", name: "FA/LV underground pathways" })).toBe(
      "A1120b – FA/LV underground pathways",
    );
    const text = phoneLookaheadText({
      as_of: "2026-10-21",
      activities: [
        { id: "A1110a", name: "Underground conduit rough-in", start: "2026-10-26", finish: "2026-10-30" },
        { id: "A1110b", name: "Underground conduit rough-in", start: "2026-10-27", finish: "2026-10-31" },
        { id: "A1120a", name: "FA/LV underground pathways", start: "2026-10-27", finish: "2026-11-02" },
        { id: "A1120b", name: "FA/LV underground pathways", start: "2026-10-28", finish: "2026-11-03" },
      ],
      items: [],
    });
    expect(text).toContain("- A1110a – Underground conduit rough-in, Oct 26 to Oct 30");
    expect(text).toContain("- A1110b – Underground conduit rough-in, Oct 27 to Oct 31");
    expect(text).toContain("- A1120a – FA/LV underground pathways");
    expect(text).toContain("- A1120b – FA/LV underground pathways");
    const get = workflow.slice(workflow.indexOf("export const lookaheadGet"), workflow.indexOf("export const lookaheadList"));
    expect(get).toContain("activityIdName(a)");
    expect(get).not.toContain("a.name || a.description || a.id");
  });
});

describe("living report data date", () => {
  const evening = new Date("2026-10-25T03:30:00Z");

  it("defaults a missing data date to today in Manaus and refuses a later date", () => {
    expect(resolveDataDate(undefined, evening)).toEqual({ ok: true, dataDate: "2026-10-24" });
    expect(resolveDataDate(null, evening)).toEqual({ ok: true, dataDate: "2026-10-24" });
    expect(resolveDataDate("2026-10-24", evening)).toEqual({ ok: true, dataDate: "2026-10-24" });
    expect(resolveDataDate("2026-10-23", evening)).toEqual({ ok: true, dataDate: "2026-10-23" });
    expect(resolveDataDate("2026-10-25", evening)).toEqual({ ok: false, error: DATA_DATE_FUTURE_ERROR });
    expect(DATA_DATE_FUTURE_ERROR.endsWith("Nothing was saved.")).toBe(true);
    expect(DATA_DATE_FUTURE_ERROR).not.toMatch(/lovable/i);
    const save = livingTools.slice(livingTools.indexOf("export const livingReportSave"));
    expect(save.indexOf("resolveDataDate")).toBeLessThan(save.indexOf("noteDateConflicts"));
    expect(save).toContain("_data_date: dated.dataDate");
    expect(save).not.toContain("_data_date: args.data_date ?? null");
  });
});

describe("company profile project software", () => {
  it("answers the setup question from the company profile when that software is saved", () => {
    expect(companyProjectSoftware({ project_software: "Buildertrend" })).toBe("Buildertrend");
    expect(companyProjectSoftware({ pm: "Overwatch" })).toBe("Overwatch");
    expect(companyProjectSoftware({})).toBeNull();
    const nq = workflow.slice(workflow.indexOf("export const nextQuestion"), workflow.indexOf("// ---------- answer ----------"));
    expect(nq.indexOf("companyProjectSoftware")).toBeLessThan(nq.indexOf("JOB_SOFTWARE_ASK"));
    expect(nq).toContain('from("mcp_companies").select("tool_stack")');
  });
});

describe("IOR section text", () => {
  it("prints the saved sections without dropping the version line or the change log", () => {
    const lines = iorSectionsText({
      title: "Job 2701 IOR — risk allocation",
      audience: "internal",
      source_cpm_version: 3,
      kpis: { gp_pct: "12.5%", contract: 1400000 },
      risk_allocations: [{ id: "IOR-01", description: "Switchgear delay holds the gear", amount: 10000 }],
      top_three_actions: [{ id: "IOR-02", action: "Price the ceiling conflict", owner: "Elena Brooks" }],
      risks: [{ id: "IOR-03", description: "Storm line conflict", exposure: 25000, status: "risk" }],
    });
    const text = lines.join("\n");
    expect(text).toContain("Job 2701 IOR — risk allocation");
    expect(text).toContain("Job health");
    expect(text).toContain("Gp Pct: 12.5%");
    expect(text).toContain("Risk Allocations");
    expect(text).toContain("Switchgear delay holds the gear");
    expect(text).toContain("Top Three Actions");
    expect(text).toContain("Price the ceiling conflict");
    expect(text).toContain("Storm line conflict");
    expect(text).not.toContain("IOR-01");
    expect(text).not.toContain("Audience");
    expect(text).not.toMatch(/lovable/i);
    const get = livingTools.slice(livingTools.indexOf("export const livingReportGet"), livingTools.indexOf("export const livingReportSave"));
    expect(get).toContain("iorSectionsText");
    expect(get).toContain('type === "ior" && job.scope === "full" ? IOR_VIEW_SPEC');
    expect(get).toContain("Change log (latest 5):");
  });
});

describe("onboarding profile read", () => {
  const profile = [
    "Company profile:",
    "Company: Fictional Electric",
    "Company time zone: America/Manaus",
    "Agent name: Athena",
    "Role: prime | Work types: commercial | Trades: electrical",
    "Tool stack: project software: Procore",
    "Decision rights: change orders: owner",
    "Default applicability: none",
    "Members: Sam (owner)",
    "SOV logo: none on file (Fictional Electric prints in bold)",
    "SOV footer: Fictional Electric",
    "Athena v0.8.23",
  ].join("\n");

  it("prints the heading once and the profile once, and leaves the card HTML as it was", () => {
    const card = inferCard("onboarding", profile);
    const html = renderHtml(card);
    const out = attachAthenaCard("onboarding", { content: [{ type: "text", text: profile }] }) as {
      content: { text: string }[];
      structuredContent: { html: string; card: { title: string; show_state?: boolean } };
    };
    expect(out.structuredContent.html).toBe(html);
    expect(out.structuredContent.card.title).toBe("What I have so far");
    expect(out.structuredContent.card.show_state).toBeUndefined();
    expect(html).toContain("<h1>What I have so far</h1>");
    expect(html).toContain(">What I have so far</p>");
    const prose = out.content[0].text.split("<!doctype")[0];
    expect(prose).toContain("## 🔵 What I have so far");
    expect(prose).not.toContain("**What I have so far**");
    expect(prose.match(/What I have so far/g)).toEqual(["What I have so far"]);
    expect(prose.match(/Company: Fictional Electric/g)).toEqual(["Company: Fictional Electric"]);
    expect(prose.match(/Members: Sam \(owner\)/g)).toEqual(["Members: Sam (owner)"]);
    expect(prose.match(/Athena v0\.8\.23/g)).toEqual(["Athena v0.8.23"]);
    expect(prose).not.toMatch(/lovable/i);
  });
});
