import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAVY } from "./cards/palette";
import { BULK_CLOSE_RULE, OWNER_CHAT_RULE, REOPEN_RULE, RESOLVE_ITEM_DESCRIPTION } from "./host-conduct";
import { buildMorningBrief, INBOX_SECTION, presentBrief } from "./morning-brief";
import { job2701BriefJob } from "./morning-brief-2701";
import { resolveItem } from "./tools/workflow-tools";

const instructions = readFileSync(new URL("./index.ts", import.meta.url), "utf8").split("instructions:")[1].split("auth:")[0];

describe("host guidance for owner chat, bulk close, and reopen", () => {
  it("declines an owner or client chat and offers a read-only share or a client report", () => {
    expect(OWNER_CHAT_RULE).toMatch(/decline/i);
    expect(OWNER_CHAT_RULE).toContain("Open ChatGPT to chat with Athena");
    expect(OWNER_CHAT_RULE).toContain("do not say the owner already has an Owner account");
    expect(OWNER_CHAT_RULE).toContain("read-only share link");
    expect(OWNER_CHAT_RULE).toContain("client report");
    expect(instructions).toContain("OWNER_CHAT_RULE");
    expect(OWNER_CHAT_RULE.startsWith("If the member asks")).toBe(true);
    expect(OWNER_CHAT_RULE).not.toMatch(/[.!?]\s+/);
    expect(OWNER_CHAT_RULE).not.toMatch(/(?:^|[.!?]\s+)Do not offer an Open ChatGPT/);
    expect(OWNER_CHAT_RULE).not.toMatch(/(?:^|[.!?]\s+)Offer a read-only share link/);
  });

  it("tells the host to list a bulk close and wait for an explicit yes, one item at a time", () => {
    expect(BULK_CLOSE_RULE).toBe(
      "For any bulk close, list the items, ask which are actually done, and close only after an explicit yes, one confirmed item at a time.",
    );
    expect(instructions).toContain("BULK_CLOSE_RULE");
    expect(RESOLVE_ITEM_DESCRIPTION).toContain("for any bulk close lists the items, asks which are actually done");
    expect(RESOLVE_ITEM_DESCRIPTION).toContain("closes only after an explicit yes, one confirmed item at a time");
    expect(resolveItem.description).toBe(RESOLVE_ITEM_DESCRIPTION);
  });

  it("tells the host to confirm before reopening, one closed item per call", () => {
    expect(REOPEN_RULE).toContain("kind reopen");
    expect(REOPEN_RULE).toContain("one closed item per call");
    expect(REOPEN_RULE).toContain("Confirm with the user first");
    expect(instructions).toContain("REOPEN_RULE");
    expect(RESOLVE_ITEM_DESCRIPTION).toContain("reopens one closed item after you confirm with the user first");
  });

  it("still returns the styled morning brief card", () => {
    expect(instructions).toContain("Do not answer those in plain text");
    expect(instructions).toContain("When a tool result says the card is shown, that card is the whole reply");
    const built = buildMorningBrief({
      jobs: [job2701BriefJob("pm")],
      hasCompany: true,
      now: new Date("2026-10-26T15:00:00Z"),
      settings: { enabled: true, send_local: "06:30", time_zone: "America/Chicago" },
    });
    expect(built.card.kpis?.map((kpi) => kpi.label)).toEqual(["Jobs", "Due today", "Open", "Overdue"]);
    expect(built.card.sections?.some((section) => section.heading === INBOX_SECTION)).toBe(true);
    const shown = presentBrief(built.card);
    const html = (shown.structuredContent as { html?: string }).html ?? "";
    expect(html).toContain(`header{background:${NAVY}`);
    expect(html.match(/class="kpi(?: |")/g)).toHaveLength(4);
    expect(html).toContain(`<h2>${INBOX_SECTION}</h2>`);
    const text = shown.content?.find((block) => block.type === "text")?.text ?? "";
    expect(text).toContain("REQUIRED VIEW: render this HTML card as-is.");
    expect(text).toContain("<!doctype html>");
    expect(text).toContain(INBOX_SECTION);
    expect(text).toContain(`header{background:${NAVY}`);
  });
});
