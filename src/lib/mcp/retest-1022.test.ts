import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boardPageFor, jobLinksMissingToken, readBoardToken, signedJobUrl } from "./board-url";
import { inferCard } from "./cards/infer";
import { renderHtml } from "./cards/html";
import { paletteViolations } from "./cards/palette";
import { completionDate, contractValueLine, iorContractValue, pickContractValue, setupContractValue, sovContractValue } from "./contract-value";
import { countOpenItems, meetingItem, openItemFeed, openItemsCard, openItemsHeader } from "./open-feed";
import { WHICH_JOB_ASK, whichJobAsk } from "./which-job";
import { morningBrief } from "./tools/morning-brief-tools";

const JOB = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-10-22";

describe("board pages and signed urls", () => {
  it("maps items, IOR, and field onto their own paths", () => {
    expect(boardPageFor("items")).toBe("items");
    expect(boardPageFor("items board")).toBe("items");
    expect(boardPageFor("IOR")).toBe("ior");
    expect(boardPageFor("items of record")).toBe("ior");
    expect(boardPageFor("field")).toBe("field");
    expect(boardPageFor("field board")).toBe("field");
    expect(boardPageFor("items")).not.toBe("ior");
  });

  it("keeps the signed token when a host appends utm params", () => {
    const href = signedJobUrl("items", JOB, "signed-token");
    const url = new URL(href);
    url.searchParams.set("utm_source", "chatgpt.com");
    expect(readBoardToken(url.searchParams)).toBe("signed-token");
    expect(jobLinksMissingToken(url.toString())).toEqual([]);
    expect(jobLinksMissingToken(`https://app.meetathena.io/r/job/${JOB}/items?utm_source=chatgpt.com`)).toEqual([
      `https://app.meetathena.io/r/job/${JOB}/items?utm_source=chatgpt.com`,
    ]);
  });

  it("finds a tokenless /r/job link in text, structured content, or a card", () => {
    const bare = `https://app.meetathena.io/r/job/${JOB}/items`;
    const signed = signedJobUrl("field", JOB, "abc");
    expect(jobLinksMissingToken({ content: [{ text: bare }], structuredContent: { card: { href: signed } } })).toEqual([bare]);
    expect(jobLinksMissingToken({ url: signed })).toEqual([]);
  });
});

describe("open item counts follow the deduped list", () => {
  const raw = [
    { id: "a4634d00-0000-4000-8000-000000000001", action: "Price the conditional exposure", needed_by: "2026-10-14", updated_at: "2026-10-20" },
    { id: "a4634d00-0000-4000-8000-000000000001b", action: "Price the conditional exposure", needed_by: "2026-10-14", updated_at: "2026-10-19" },
    { id: "b1008000-0000-4000-8000-000000000002", action: "Resolve the kickoff", needed_by: "2026-10-16", updated_at: "2026-10-20" },
    { id: "7fc62000-0000-4000-8000-000000000003", action: "Confirm the conduit", needed_by: "2026-10-20", updated_at: "2026-10-20" },
    { id: "c1", action: "No change orders pending, confirmed.", needed_by: "2026-10-29", updated_at: "2026-10-21" },
    { id: "c2", action: "No change orders pending, confirmed.", needed_by: "2026-10-29", updated_at: "2026-10-22" },
    { id: "k1", action: "All subcontractors, suppliers, and crews confirmed for the lookahead.", needed_by: "2026-10-26", updated_at: "2026-10-21" },
    { id: "k2", action: "All subs, suppliers and crews confirmed for the lookahead.", needed_by: "2026-10-26", updated_at: "2026-10-22" },
    { id: "b1", action: "Planned billing this month 10000. Realistic billing this month 8000.", needed_by: "2026-10-31", updated_at: "2026-10-21" },
    { id: "b2", action: "Accounting: planned billing this month $10,000.00; realistic billing this month $8,000.00.", needed_by: "2026-10-31", updated_at: "2026-10-22" },
    ...Array.from({ length: 40 }, (_, n) => ({
      id: `extra-${n}`,
      action: n % 2 === 0 ? `Buy gear ${n}` : `Buy gear ${n - 1}`,
      needed_by: n < 8 ? "2026-10-25" : "2026-11-20",
      updated_at: "2026-10-18",
    })),
  ];

  it("header counts equal the distinct rows, including waiting change orders", () => {
    const feed = openItemFeed(raw, TODAY);
    const header = openItemsHeader(feed.counts);
    const bullets = feed.items.map((item) => `- ${item.action}`);
    const overdue = feed.items.filter((item) => (item.needed_by ?? "") < TODAY);
    const dueIn7 = feed.items.filter((item) => {
      const due = item.needed_by ?? "";
      return due >= TODAY && due <= "2026-10-29";
    });
    expect(raw.length).toBeGreaterThan(feed.items.length);
    expect(feed.counts.open).toBe(feed.items.length);
    expect(feed.counts.open).toBe(bullets.length);
    expect(feed.counts.overdue).toBe(overdue.length);
    expect(feed.counts.due_in_7_days).toBe(dueIn7.length);
    expect(countOpenItems(feed.items, TODAY)).toEqual(feed.counts);
    expect(header).toBe(`Open items: ${feed.items.length} open, ${overdue.length} overdue, ${dueIn7.length} due in 7 days.`);
    expect(feed.items.filter((item) => /no change orders pending/i.test(item.action))).toHaveLength(1);
    expect(feed.items.filter((item) => /crews confirmed/i.test(item.action))).toHaveLength(1);
    expect(feed.items.filter((item) => /planned billing|realistic billing/i.test(item.action))).toHaveLength(1);
    const names = feed.items.map((item) => item.action).join("\n");
    expect(names).toContain("Price the conditional exposure");
    expect(names).not.toMatch(/\bA4634D?\b|\bB1008\b|\b7FC62\b/);
    const card = openItemsCard("2701 – Harbor", feed.items, feed.counts, TODAY);
    expect(card.kpis?.find((k) => k.label === "Open")?.value).toBe(String(feed.items.length));
    expect(card.kpis?.find((k) => k.label === "Overdue")?.value).toBe(String(overdue.length));
    expect(card.sections?.[0].rows.length).toBe(feed.counts.open);
    const inferred = inferCard("list_open_items", header, {
      counts: feed.counts,
      items: feed.items.map((item) => ({ action: item.action, owner: "Elena Brooks", due: item.needed_by, overdue: (item.needed_by ?? "") < TODAY })),
    });
    expect(inferred.kpis?.find((k) => k.label === "Open")?.value).toBe(String(feed.counts.open));
    expect(inferred.sections?.find((s) => s.heading === "Items")?.rows.length).toBe(feed.counts.open);
  });

  it("meeting confirmations upsert by a stable key and close the finished checks", () => {
    expect(meetingItem("No change orders pending, confirmed.")).toEqual({ key: "pm:change_orders", close: true });
    expect(meetingItem("All subs, suppliers and crews confirmed")).toEqual({ key: "pm:crews", close: true });
    expect(meetingItem("Planned billing this month $10,000. Realistic billing this month $8,000.")).toEqual({ key: "pm:billing", close: false });
  });
});

describe("which-job question matches the tool", () => {
  it.each(Object.entries(WHICH_JOB_ASK))("%s asks %s", (tool, ask) => {
    const card = inferCard(tool, "No job named. Your companies and jobs:\n- ALP: 2701 (Harbor)");
    expect(whichJobAsk(tool)).toBe(ask);
    expect(card.ask?.prompt).toBe(ask);
    expect(renderHtml(card)).toContain(ask);
  });

  it("pm_morning does not ask the open-items question", () => {
    const card = inferCard("pm_morning", "No job named. Your companies and jobs:\n- ALP: 2701 (Harbor)");
    expect(card.ask?.prompt).toBe("Which job's morning hitlist?");
    expect(card.ask?.prompt).not.toContain("list open items");
  });
});

describe("morning brief ranks ahead of email and calendar", () => {
  const tool = morningBrief as { name: string; title: string; description: string };

  it("name and description carry the Athena greeting phrases", () => {
    for (const phrase of [
      "Athena, good morning",
      "Hey Athena",
      "Good morning Athena",
      "Morning Athena",
      "Athena at the start or mid-sentence",
      "Athina",
      "Athen",
      "Atena",
      "hitlist",
      "morning briefing",
      "what's on my plate today",
      "overdue",
      "today's deadlines on my jobs",
    ]) {
      expect(tool.description, phrase).toContain(phrase);
    }
    expect(tool.description).toContain("From your inbox and calendar");
    expect(tool.description.toLowerCase()).toContain("construction morning brief");
    expect(tool.description).toContain("emails that came in overnight");
    expect(tool.description).toContain("unanswered emails that need a reply");
    expect(tool.description).toContain("today's meetings");
    expect(tool.name).toBe("morning_brief");
    expect(tool.description.split(/[.!]+/).map((part) => part.trim()).filter(Boolean)).toEqual([tool.description.replace(/\.$/, "")]);
    const instructions = readFileSync("src/lib/mcp/index.ts", "utf8");
    for (const phrase of ["Athena, good morning", "Hey Athena", "Good morning Athena", "Morning Athena", "Athena at the start or mid-sentence", "Athina", "Athen", "Atena", "From your inbox and calendar", "morning_brief", "athena_hello"]) {
      expect(instructions, phrase).toContain(phrase);
    }
    expect(instructions).toContain("call morning_brief");
    expect(instructions).toContain("athena_morning_hitlist");
  });
});

describe("contract value fallback", () => {
  it("uses job setup, then the SOV, then the IOR, and 2701 is $1,400,000.00", () => {
    expect(pickContractValue({ setup: 1400000, sov: 900, ior: 1 })).toEqual({ amount: 1400000, source: "job setup" });
    expect(pickContractValue({ setup: null, sov: 1400000, ior: 1174000 })).toEqual({ amount: 1400000, source: "SOV" });
    expect(pickContractValue({ setup: null, sov: null, ior: 1400000 })).toEqual({ amount: 1400000, source: "IOR" });
    expect(sovContractValue([{ item_no: "26.01", description: "Electrical", scheduled_value: 1400000 }], 0, null)).toBe(1400000);
    expect(setupContractValue([{ module: "contract", key: "contract_value", value: 1500000, status: "known" }])).toBe(1500000);
    expect(iorContractValue({ contract_total: null, data: { budget_profit_basis: { contract: 1400000, gross_profit: 226000 } } })).toBe(1400000);
    expect(contractValueLine(1400000, "SOV", true)).toBe("Contract value: $1,400,000.00 (SOV)");
    expect(completionDate("2026-08-06", [])).toBe("2026-08-06");
    expect(completionDate(null, [{ key: "substantial_completion", value: "2026-08-06", status: "known" }])).toBe("2026-08-06");
  });
});

describe("tool outputs do not emit a tokenless job link", () => {
  it("scans tool sources for a hardcoded /r/job url without a token", () => {
    const root = "src/lib/mcp";
    const files = [
      ...readdirSync(`${root}/tools`).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).map((name) => `${root}/tools/${name}`),
      `${root}/flows/build.ts`,
      `${root}/flows/load.ts`,
    ];
    for (const file of files) {
      const hits = readFileSync(file, "utf8").match(/https:\/\/app\.meetathena\.io\/r\/job\/[^"'`\s)]+/g) ?? [];
      for (const hit of hits) expect(hit, file).toMatch(/[?&]t=/);
    }
  });
});

describe("board link card palette", () => {
  it("stays navy, blue, and gray when nothing is overdue", () => {
    const html = renderHtml({
      state: "result",
      title: "Open items",
      sections: [{ heading: "Open", kind: "chips", rows: [{ cells: ["Open items"], href: signedJobUrl("items", JOB, "abc"), tone: "action" }] }],
    });
    expect(paletteViolations(html, false)).toEqual([]);
    expect(html).toContain("#1E3A5F");
    expect(html).toContain("#1E5FED");
  });
});
