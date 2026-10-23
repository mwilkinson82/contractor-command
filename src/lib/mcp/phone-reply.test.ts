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
    expect(body).toContain("Can you confirm: Owner/engineer/architect submittal and RFI turnaround times are identified? Example PM, due Oct 14.");
    expect(body).toContain("- **Kickoff meeting.** Can you confirm: A kickoff meeting has been held with the superintendent?");
    expect(body).toContain("Price conditional 30-day extended project-supervision exposure from redesign; track $140,000.00 gross billing displaced March to April.");
    expect(body).not.toMatch(/2701 – (Resolve|Price)|Resolve: [EF]\d+/);
    expect(body.trim().endsWith("**Athena's next move:** Clear Owner/engineer/architect submittal and RFI… with Example PM, overdue since Oct 14.")).toBe(true);
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

  it.each(["card", "reply"])("does not let an explicit %s next action override an overdue row", (source) => {
    const sc = lookahead();
    const body = phoneLookaheadText(source === "card"
      ? { ...sc, card: { ...sc.card, next_move: "Review the inspection request with Example PM." } }
      : { ...sc, next_action: "Review the inspection request with Example PM." });
    expect(body?.endsWith("**Athena's next move:** Clear Owner/engineer/architect submittal and RFI… with Example PM, overdue since Oct 14.")).toBe(true);
  });

  it("retains legitimate activity codes and other job prefixes", () => {
    const sc = lookahead();
    sc.overdue_items = [{ action: "E14 circuit requires inspection.", owner: "Example PM", due: "2026-10-14" }, { action: "9999 – Resolve: E14 Check this other job.", owner: "Example PM", due: "2026-10-14" }];
    const body = phoneLookaheadText(sc)!;
    expect(body).toContain("**E14 circuit requires inspection.**");
    expect(body).toContain("**9999 – Resolve.** E14 Check this other job.");
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
    expect(body.endsWith("**Athena's next move:** Clear Example task 1 with Example PM, overdue since Oct 21.")).toBe(true);
    expect(sc).toEqual(original);
  });

  it("does not invent an owner or due date for an incomplete row", () => {
    const body = phoneOpenItemsText({ card: { title: "Open items" }, items: [{ action: "Check inspection readiness" }] })!;
    expect(body).toContain("**Check inspection readiness.** Due date needed.");
    expect(body).not.toContain("Needed,");
    expect(body).not.toContain("Athena's next move:");
  });

  it("omits the next action when every row is resolved", () => {
    const body = phoneOpenItemsText({ card: { title: "Open items" }, counts: { open: 0 }, items: [{ action: "Inspection reviewed", status: "resolved" }] })!;
    expect(body).toContain("### Resolved");
    expect(body).not.toContain("Athena's next move:");
  });

  it.each([phoneLookaheadText, phoneOpenItemsText])("prints one date prompt per undated row without a generic Needed placeholder", (render) => {
    const sc = {
      card: { title: "Example", job: "2701 – Fictional job" },
      items: [
        { action: "Order fixtures", owner: null, due: null },
        { action: "Verify circuit", owner: "Needed", due: null },
        { action: "Book inspection", owner: "Example PM", due: null },
      ],
    };
    const original = structuredClone(sc);
    const body = render(sc)!;
    const bullets = body.split("\n").filter((line) => line.startsWith("- **"));
    expect(bullets).toEqual([
      "- **Order fixtures.** Due date needed.",
      "- **Verify circuit.** Due date needed.",
      "- **Book inspection.** Example PM. Due date needed.",
    ]);
    expect(body).not.toContain("Needed,");
    expect(body).not.toContain("with Needed");
    expect(body).not.toContain("current status?");
    expect(body).not.toContain("🔴");
    expect(sc).toEqual(original);
  });

  it("treats a card-only owner placeholder as missing instead of printing it", () => {
    const body = phoneOpenItemsText({ card: { title: "Open items", sections: [{ heading: "Items", rows: [{ cells: ["Check inspection", "Needed", "Needed"] }] }] } })!;
    expect(body).toContain("- **Check inspection.** Due date needed.");
    expect(body).not.toContain("Athena's next move:");
  });

  it.each(["pending", "awaiting", "waiting"])("presents a %s item as a question without resolving it", (status) => {
    const sc = { card: { title: "Open items" }, items: [{ action: "Inspection booking", status, owner: "Example PM", due: "2026-11-04" }] };
    const original = structuredClone(sc);
    const body = phoneOpenItemsText(sc)!;
    expect(body).toContain("- **Inspection booking.** What is the current status? Example PM, due Nov 4.");
    expect(body).not.toContain("### Resolved");
    expect(sc).toEqual(original);
  });

  it("keeps a negative source note intact and asks for its status", () => {
    const body = phoneOpenItemsText({ card: { title: "Open items" }, items: [{ action: "Deliveries: Ground rods are not confirmed; ask supplier@example.com.", owner: "Example Buyer" }] })!;
    expect(body).toContain("- **Deliveries.** Ground rods are not confirmed; ask supplier@example.com. What is the current status? Example Buyer. Due date needed.");
  });

  it("asks for unresolved checklist confirmation without claiming the check happened", () => {
    const body = phoneOpenItemsText({ card: { title: "Open items" }, items: [{ action: "Resolve: F99 Review completed with Example PM.", status: "open" }] })!;
    expect(body).toContain("- **Review completed with Example PM.** Can you confirm: Review completed with Example PM? Due date needed.");
    expect(body).not.toContain("To confirm:");
    expect(body).not.toContain("?.");
  });

  it("does not turn resolved confirmations or explicit existing questions into new questions", () => {
    const body = phoneOpenItemsText({ card: { title: "Open items" }, items: [
      { action: "Resolve: F16 A kickoff meeting has been held with the superintendent.", status: "resolved" },
      { action: "Inspection pending. Has it been booked?", status: "open" },
      { action: "Are crews confirmed?", status: "open" },
    ] })!;
    expect(body).toContain("- **Kickoff meeting.** A kickoff meeting has been held with the superintendent. Due date needed.");
    expect(body).toContain("- **Inspection pending.** Has it been booked? Due date needed.");
    expect(body).toContain("- **Are crews confirmed?** Due date needed.");
    expect(body).not.toContain("current status?");
    expect(body).not.toContain("Can you confirm:");
    expect(body).not.toContain("?.");
  });

  describe.each([phoneLookaheadText, phoneOpenItemsText])("footer eligibility for %s", (render) => {
    it.each([
      [],
      [{ action: "Inspection reviewed", status: "resolved", due: "2026-10-01", flag: "risk" }],
      [{ action: "Book inspection", due: "2026-10-24" }],
      [{ action: "Order fixtures", due: "2026-11-10" }],
    ])("omits the footer without an overdue or delay/risk row: %j", (...items) => {
      const sc = {
        as_of: "2026-10-22", card: { title: "Example", next_move: "Review Coming up." },
        next_action: "Review the job board.", items,
      };
      const original = structuredClone(sc);
      const body = render(sc)!;
      expect(body).not.toContain("Athena's next move:");
      expect(body).not.toContain("Review the job board");
      expect(sc).toEqual(original);
    });

    it("selects overdue first and then delay/risk, excluding ordinary upcoming work", () => {
      const items = [
        { action: "Ordinary upcoming item", owner: "Example Buyer", due: "2026-10-23" },
        { action: "Delay notice", owner: "Example PM", due: "2026-11-04", flag: "delay" },
        { action: "Drawing conflict", owner: "Example Engineer", due: "2026-11-05", type: "risk" },
        { action: "Turnaround times", owner: "Example PM", due: "2026-10-14" },
      ];
      const sc = { as_of: "2026-10-22", card: { title: "Example" }, items };
      expect(render(sc)?.endsWith("**Athena's next move:** Clear Turnaround times with Example PM, overdue since Oct 14.")).toBe(true);
      const noOverdue = render({ ...sc, items: items.slice(0, 3) })!;
      expect(noOverdue.endsWith("**Athena's next move:** Clear Delay notice with Example PM, due Nov 4.")).toBe(true);
      expect(noOverdue.split("**Athena's next move:**")[1]).not.toContain("overdue since");
      expect(render({ ...sc, items: [items[0], items[2]] })?.endsWith("**Athena's next move:** Clear Drawing conflict with Example Engineer, due Nov 5.")).toBe(true);
    });

    it("does not fabricate an owner or date on a qualifying row", () => {
      const body = render({ card: { title: "Example" }, items: [{ action: "Unpriced risk", flag: "risk", owner: "Needed" }] })!;
      expect(body.endsWith("**Athena's next move:** Clear Unpriced risk.")).toBe(true);
      expect(body.match(/Due date needed/g)).toHaveLength(1);
      expect(body).not.toContain("with Needed");
      expect(body).not.toContain("overdue since");
    });
  });

  it("does not revive resolved job-overdue records for a lookahead footer", () => {
    const body = phoneLookaheadText({ card: { title: "Example" }, items: [], overdue_items: [{ action: "Old risk", status: "closed", flag: "risk", overdue: true }] })!;
    expect(body).not.toContain("Athena's next move:");
    expect(body).not.toContain("Old risk");
  });

  it.each([
    "Resolve: G21 All equipment procurement and delivery milestones have been coordinated with the electrical superintendent and the mechanical foreman before installation starts.",
    "Resolve: F99 The temporary power inspection has been booked with the authority having jurisdiction before the next work window.",
    "Review the waterproofing warranty requirements with the enclosure subcontractor before approving any alternate membrane assembly; preserve the conditional $25,000.00 allowance (§8.2).",
  ])("shortens an unseen long note without losing its full requirement: %s", (action) => {
    const body = phoneOpenItemsText({ card: { title: "Example" }, items: [{ action, owner: "Example PM" }] })!;
    const title = body.match(/^- \*\*(.+?)\*\*/m)![1].replace(/\.$/, "");
    expect(title.length).toBeLessThanOrEqual(48);
    expect(title.split(/\s+/).length).toBeLessThanOrEqual(6);
    expect(title).not.toBe("Confirmation");
    expect(body).toContain(action.replace(/^Resolve: [A-Z]\d+ /, "").replace(/\.$/, ""));
    expect(body.match(/Due date needed/g)).toHaveLength(1);
  });
});
