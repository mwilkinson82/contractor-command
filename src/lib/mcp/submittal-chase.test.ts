import { describe, expect, it } from "vitest";
import { renderHtml } from "./cards/html";
import { paletteViolations } from "./cards/palette";
import { BLUE, NAVY } from "./cards/palette";
import { attachAthenaCard } from "./cards/attach";
import { chaseBriefRows, chaseDraft, chaseHeaderMatches, chaseIsDue, nextChaseDate, presentChaseCard, type ChaseRow } from "./submittal-chase";

const TODAY = "2026-10-22";

function chase(over: Partial<ChaseRow> = {}): ChaseRow {
  return {
    submittal_id: "11111111-1111-4111-8111-111111111111",
    number: "001",
    revision: 0,
    title: "SAMPLE Switchgear product data",
    spec_section: "26 24 16",
    overdue: true,
    missing: "shop drawing",
    chase_role: "supplier",
    chase_name: "GearCo",
    chase_email: "sample-chase@example.com",
    chase_count: 0,
    next_chase_at: null,
    ...over,
  };
}

describe("submittal chase", () => {
  it("is due when never chased and overdue, and again when the follow-up date arrives", () => {
    expect(chaseIsDue(chase(), TODAY)).toBe(true);
    expect(chaseIsDue(chase({ chase_count: 1, next_chase_at: "2026-10-29", overdue: true }), TODAY)).toBe(false);
    expect(chaseIsDue(chase({ chase_count: 1, next_chase_at: "2026-10-22", overdue: true }), TODAY)).toBe(true);
    expect(nextChaseDate(TODAY)).toBe("2026-10-29");
  });

  it("drafts one email and does not send it", () => {
    const presented = presentChaseCard({
      jobNumber: "2701",
      jobName: "Harbor Point",
      chases: [chase(), chase({ submittal_id: "22222222-2222-4222-8222-222222222222", number: "002", overdue: false, missing: "warranty", chase_count: 0 })],
      today: TODAY,
    });
    expect(chaseHeaderMatches(presented.card)).toBe(true);
    expect(presented.draft?.to).toBe("sample-chase@example.com");
    expect(presented.draft?.subject).toContain("2701");
    expect(presented.text).toMatch(/Yes or no/);
    expect(presented.card.next_move).toMatch(/Nothing is sent/);
    const html = renderHtml(presented.card);
    expect(html).toContain(NAVY);
    expect(html).toContain(BLUE);
    expect(BLUE).toBe("#1E5FED");
    expect(paletteViolations(html, true)).toEqual([]);
    const quiet = renderHtml(presentChaseCard({
      jobNumber: "2701",
      jobName: "Harbor",
      chases: [chase({ overdue: false, missing: "warranty" })],
      today: TODAY,
    }).card);
    expect(paletteViolations(quiet, false)).toEqual([]);
    const sealed = attachAthenaCard("submittal_chase", { content: [{ type: "text", text: presented.text }], structuredContent: { card: presented.card } }) as { content: { text?: string }[] };
    expect(sealed.content[0].text).toContain("#1E5FED");
    expect(chaseDraft("2701", chase()).body).not.toMatch(/\battached\b/i);
  });

  it("does not produce a sendable draft with missing contact or spec", () => {
    for (const gap of [{ chase_name: null }, { chase_email: null }, { spec_section: "Needed" }]) {
      const presented = presentChaseCard({ jobNumber: "2701", jobName: "Harbor Point", chases: [chase(gap)], today: TODAY });
      expect(presented.draft).toBeNull();
      expect(presented.text).not.toContain("there,");
      expect(presented.card.next_move).toContain("Who is the named contact");
    }
  });

  it("puts due chases on the morning brief, red only when overdue", () => {
    const rows = chaseBriefRows([
      chase({ job_number: "2701", overdue: true }),
      chase({ job_number: "2701", number: "002", overdue: false, missing: "warranty", submittal_id: "22222222-2222-4222-8222-222222222222" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.flag === "overdue")).toHaveLength(1);
  });
});
