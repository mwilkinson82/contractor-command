import { describe, expect, it } from "vitest";
import { phoneLookaheadText, phoneOpenItemsText } from "./phone-reply";

// Fictional records, pinned to the reported window. The real card builders do
// not supply a next_move, so this fixture deliberately leaves it absent.
function lookahead() {
  return {
    as_of: "2026-10-22",
    card: {
      title: "Lookahead", job: "2701 – Fictional job", state: "ready",
      kpis: [
        { label: "Saved items", value: "6" },
        { label: "Open saved items", value: "4" },
        { label: "Overdue on job", value: "3" },
      ],
    },
    items: [
      { action: "Schedule logic: None. Rough-in finishes 2026-11-04; inspection follows 2026-11-05.", status: "resolved", owner: "Example PM", due: "2026-10-13" },
      { action: "Submittals: None block work in this window. S-001 is in preparation by Example Engineer and due 2026-11-19 (§5.1).", status: "resolved", owner: "Example PM", due: "2026-10-13" },
      { action: "Deliveries: PVC confirmed. Ground rods are not confirmed; ask supplier@example.com.", status: "open", owner: "Example Buyer", due: "2026-10-28" },
      { action: "Inspections: Fire-alarm inspection not requested.", status: "open", owner: "Example Foreman", due: "2026-11-02" },
      { action: "Inspections: Underground inspection not requested.", status: "open", owner: "Example Foreman", due: "2026-11-04" },
      { action: "RFIs: Routing conflict needs an answer. RFI not yet sent.", status: "open", owner: "Example Engineer", due: "2026-11-04", type: "risk" },
    ],
    overdue_items: [
      { action: "2701 – Resolve: E14 Owner/engineer/architect submittal and RFI turnaround times are identified.", owner: "Example PM", due: "2026-10-14" },
      { action: "2701 – Resolve: F16 A kickoff meeting has been held with the superintendent.", owner: "Example Superintendent", due: "2026-10-16" },
      { action: "2701 – Price conditional 30-day extended project-supervision exposure from redesign; track $140,000.00 gross billing displaced March to April.", owner: "Example Estimator", due: "2026-10-21" },
    ],
    activities: [{ name: "Example rough-in", start: "2026-10-26", finish: "2026-11-04" }],
  };
}

describe("phone reply follow-ups", () => {
  it("renders six saved rows and three overdue with readable titles and a next move without an injected card field", () => {
    const sc = lookahead();
    const original = structuredClone(sc);
    const body = phoneLookaheadText(sc)!;
    expect(body).toContain("**6 saved items · 4 open · 🔴 3 overdue on the job**");
    expect(body).toContain("- **Turnaround times.** To confirm: Owner/engineer/architect submittal and RFI turnaround times are identified. Example PM, due Oct 14.");
    expect(body).toContain("- **Superintendent kickoff.** To confirm: A kickoff meeting has been held with the superintendent.");
    expect(body).toContain("- **Project supervision exposure.** Price conditional 30-day extended project-supervision exposure from redesign; track $140,000.00 gross billing displaced March to April.");
    expect(body).not.toMatch(/2701 – (Resolve|Price)|Resolve: [EF]\d+/);
    expect(body.trim().endsWith("**Athena's next move:** Review “Turnaround times” with Example PM (due Oct 14).")).toBe(true);
    expect(body.split("\n").filter((line) => line.startsWith("- **"))).toHaveLength(9);
    expect(sc).toEqual(original);
  });

  it("keeps the full resolved notes in separate bullets after the schedule", () => {
    const body = phoneLookaheadText(lookahead())!;
    const resolved = body.slice(body.indexOf("### Resolved"), body.indexOf("**Athena's next move:"));
    expect(resolved).toContain("- **Schedule logic.** None. Rough-in finishes 2026-11-04; inspection follows 2026-11-05. Example PM, due Oct 13.");
    expect(resolved).toContain("- **Submittals.** None block work in this window. S-001 is in preparation by Example Engineer and due 2026-11-19 (§5.1). Example PM, due Oct 13.");
    expect(resolved).not.toContain("🔴");
    expect(body).not.toContain("Resolved: Schedule logic:");
    const headings = ["### 🔴 Overdue", "### Due within 7 days", "### Coming up", "### 🔴 Delay / risk notices", "### Schedule in this window", "### Resolved", "**Athena's next move:"];
    const positions = headings.map((heading) => body.indexOf(heading));
    expect(positions.every((position, i) => position >= 0 && (!i || position > positions[i - 1]))).toBe(true);
    const ordinary = body.slice(body.indexOf("### Due within 7 days"), body.indexOf("### 🔴 Delay / risk notices"));
    expect(ordinary).not.toContain("🔴");
    expect(ordinary).toContain("Ground rods are not confirmed; ask supplier@example.com.");
    expect(body).not.toMatch(/<html|<!doctype|^\s*\||REQUIRED|Card shown/im);
  });

  it.each(["card", "reply"])("preserves an explicit %s next action", (source) => {
    const sc = lookahead();
    const body = phoneLookaheadText(source === "card"
      ? { ...sc, card: { ...sc.card, next_move: "Review the inspection request with Example PM." } }
      : { ...sc, next_action: "Review the inspection request with Example PM." });
    expect(body?.endsWith("**Athena's next move:** Review the inspection request with Example PM.")).toBe(true);
  });

  it("retains legitimate activity codes and other job prefixes", () => {
    const sc = lookahead();
    sc.overdue_items = [{ action: "E14 circuit requires inspection.", owner: "Example PM", due: "2026-10-14" }, { action: "9999 – Resolve: E14 Check this other job.", owner: "Example PM", due: "2026-10-14" }];
    const body = phoneLookaheadText(sc)!;
    expect(body).toContain("**E14 circuit requires inspection.**");
    expect(body).toContain("**9999 – Resolve: E14 Check this other job.**");
  });

  it("keeps all 17 open rows and the pinned 3 overdue / 5 due counts without a next_move", () => {
    const items = Array.from({ length: 17 }, (_, i) => ({
      action: `Example task ${i + 1}`, owner: "Example PM",
      due: i < 3 ? "2026-10-21" : i < 8 ? "2026-10-23" : "2026-11-02",
    }));
    const sc = { as_of: "2026-10-22", card: { title: "Open items", job: "2701 · Fictional job", next_move: null }, items, counts: { open: 17, overdue: 3, due_in_7_days: 5 } };
    const original = structuredClone(sc);
    const body = phoneOpenItemsText(sc)!;
    expect(body).toContain("**17 open · 🔴 3 overdue · 5 due within 7 days**");
    expect(body.split("\n").filter((line) => line.startsWith("- **"))).toHaveLength(17);
    for (let i = 1; i <= 17; i++) expect(body).toContain(`**Example task ${i}.** Example PM, due `);
    expect(body.slice(body.indexOf("### Due within 7 days"))).not.toContain("🔴");
    expect(body.endsWith("**Athena's next move:** Review “Example task 1” with Example PM (due Oct 21).")).toBe(true);
    expect(sc).toEqual(original);
  });

  it("does not invent an owner or due date for an incomplete row", () => {
    const body = phoneOpenItemsText({ card: { title: "Open items" }, items: [{ action: "Check inspection readiness" }] })!;
    expect(body).toContain("Needed, due date needed.");
    expect(body.endsWith("**Athena's next move:** Assign an owner to review “Check inspection readiness”.")).toBe(true);
  });

  it("uses the board as the next action when every row is resolved", () => {
    const body = phoneOpenItemsText({ card: { title: "Open items" }, counts: { open: 0 }, items: [{ action: "Inspection reviewed", status: "resolved" }] })!;
    expect(body).toContain("### Resolved");
    expect(body.endsWith("**Athena's next move:** Review the job board for the next action.")).toBe(true);
  });
});
