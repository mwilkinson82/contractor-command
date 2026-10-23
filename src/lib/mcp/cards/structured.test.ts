import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import rows2701 from "../__fixtures__/job-2701-clauses.json";
import type { ClauseRow } from "../contract-clauses";
import { buildSov, money, sovLineRows } from "../sov";
import { attachAthenaCard } from "./attach";
import { renderHtml } from "./html";
import { renderMarkdown } from "./markdown";
import { alertMarkupViolations, paletteViolations } from "./palette";
import { clauseWording, contractTermsCard, sovCard } from "./structured";
import { cardWidgetHtml } from "./widget";
import type { CardModel } from "./model";

const clauses = rows2701 as ClauseRow[];
const contract = () =>
  contractTermsCard({
    job: "2701 · Harbor Point",
    clauses,
    valueDisplay: "Contract value: $1,400,000.00 (SOV)",
    completion: "2027-06-30",
    missing: ["Missing: notice of schedule disagreement (open item asks to confirm it)"],
    flags: [{ flag: "has_lds", value: "ON" }],
    askSummary: true,
    boardLinks: [],
  });

function widget(card: CardModel): string {
  const node = { dataset: {}, innerHTML: "" };
  runInNewContext(cardWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1], {
    window: { openai: { toolOutput: { card } } },
    document: { getElementById: () => node },
  });
  return node.innerHTML;
}

describe("contract terms card from clause rows", () => {
  it("preserves contract blanks, identifiers, whitespace and unpaired markers", () => {
    const wording = "  **Give  notice** within ____ days.\nReference A__B; ****; unpaired **";
    expect(clauseWording(wording)).toBe(
      "  Give  notice within ____ days.\nReference A__B; ****; unpaired **",
    );
  });

  it("shows requested summary rows in both renderers and the markdown fallback", () => {
    const card = contractTermsCard({
      job: "2701 fictional",
      clauses,
      valueDisplay: null,
      completion: null,
      missing: [],
      flags: [],
      askSummary: false,
      summary: ["Fictional saved summary: payment follows owner receipt."],
      boardLinks: [],
    });
    for (const rendered of [renderHtml(card), renderMarkdown(card), widget(card)]) {
      expect(rendered).toContain("Fictional saved summary: payment follows owner receipt.");
      expect(rendered).toContain("Summary — the clause text above governs");
      expect(rendered).not.toContain("Do you want me to summarize");
    }
  });
  it("gives every clause its own framed card with the exact wording", () => {
    const card = contract();
    const framed = card.sections!.filter((s) => s.framed);
    expect(framed).toHaveLength(clauses.length);
    expect(card.kpis).toContainEqual({ label: "Clauses", value: String(clauses.length) });
    for (const [i, c] of clauses.entries()) {
      expect(framed[i].heading).toBe(`§${c.section}${c.heading ? ` ${c.heading}` : ""}`);
      const quote = framed[i].rows.find((r) => r.tone === "quote")!;
      expect(quote.cells[0]).toBe(clauseWording(c.verbatim_text));
      expect(quote.cells[0]).not.toContain("**");
    }
    expect(card.ask?.prompt).toBe(
      "Do you want me to summarize this legal text so you know what it means in plain English?",
    );
  });

  it("marks only the delay, liquidated damages and claim clauses red", () => {
    const card = contract();
    const red = card.sections!.filter((s) => s.flag).map((s) => s.heading);
    expect(red).toEqual(["§6.2 Delay Notice", "§6.3 Liquidated Damages", "§7.3 Claim Notice"]);
    expect(card.kpis).toContainEqual({ label: "Risk clauses", value: "3", flag: "risk" });
    expect(card.alerts ?? []).toEqual([]);
  });

  it("stays on palette in the HTML, the markdown and ChatGPT's widget", () => {
    const card = contract();
    const html = renderHtml(card);
    expect(html.match(/<section class="framed/g)).toHaveLength(clauses.length);
    expect(html.match(/data-alert="(delay|risk)"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(paletteViolations(html, true)).toEqual([]);
    expect(alertMarkupViolations(html)).toEqual([]);
    expect(html).not.toContain("**");
    const md = renderMarkdown(card);
    expect(md).toContain("### 🔴 §6.2 Delay Notice");
    expect(md).toContain("> 6.2 Delay Notice. Subcontractor shall give written notice");
    const painted = widget(card);
    expect(painted.match(/<section class="framed/g)).toHaveLength(clauses.length);
    expect(painted).toContain('class="tone-quote"');
    expect(alertMarkupViolations(painted)).toEqual([]);
  });

  it("is the card attachAthenaCard draws for contract_terms", () => {
    const card = contract();
    const out = attachAthenaCard("contract_terms", {
      content: [{ type: "text", text: "2701 – CONTRACT CLAUSES" }],
      structuredContent: { card },
    }) as unknown as {
      structuredContent: { card: CardModel; html: string };
    };
    expect(out.structuredContent.card).toEqual(card);
    expect(out.structuredContent.html).toBe(renderHtml(card));
  });
});

describe("SOV card from line rows", () => {
  it.each(["lines", "divisions"] as const)(
    "includes the fee before the total in %s across both renderers",
    (view) => {
      const priced = buildSov(
        [{ item_no: "26.01", description: "Fictional electrical work", scheduled_value: 900 }],
        10,
        null,
      );
      const card = sovCard({
        job: "2701 fictional",
        rows: sovLineRows(priced),
        divisions: priced.summary.divisions.map((d) => ({
          division: d.division,
          title: d.title,
          scheduled_value_display: money(d.scheduled_value),
          pct_of_contract: d.pct_of_contract,
        })),
        fee: { display: money(priced.summary.fee), pct: priced.summary.fee_pct },
        totalDisplay: money(priced.summary.contract_total),
        basis: null,
        audience: "internal",
        view,
      });
      const fee = card.sections![0].rows.at(-2)!;
      expect(fee.cells).toContain("Contractor's fee");
      expect(fee.cells).toContain("$100.00");
      expect(fee.cells).toContain("10.00%");
      for (const rendered of [renderHtml(card), renderMarkdown(card), widget(card)]) {
        expect(rendered).toContain("$900.00");
        expect(rendered).toContain("$100.00");
        expect(rendered).toContain("$1,000.00");
      }
    },
  );
  const sov = buildSov(
    [
      ["26.01", "Mobilization, bonds and general conditions", 70000],
      ["26.02", "Submittals and engineering", 20000],
      ["26.03", "Service entrance and switchgear", 210000],
      ["26.04", "Emergency generator and transfer switches", 180000],
      ["26.05", "Panelboards, transformers and feeders", 185000],
      ["26.06", "Branch circuit rough-in and devices", 255000],
      ["26.07", "Lighting fixtures and controls", 205000],
      ["26.08", "Site lighting, testing and closeout", 70000],
      ["27.01", "Low-voltage pathways", 90000],
      ["28.01", "Fire alarm system", 115000],
    ].map(([item_no, description, scheduled_value]) => ({
      item_no: item_no as string,
      description: description as string,
      scheduled_value: scheduled_value as number,
    })),
    0,
    null,
  );
  const card = (view: "lines" | "divisions") =>
    sovCard({
      job: "2701 · Harbor Point",
      rows: sovLineRows(sov),
      divisions: sov.summary.divisions.map((d) => ({
        division: d.division,
        title: d.title,
        scheduled_value_display: money(d.scheduled_value),
        pct_of_contract: d.pct_of_contract,
      })),
      fee: null,
      totalDisplay: money(sov.summary.contract_total),
      basis: "Exhibit B",
      audience: "internal",
      view,
    });

  it("lists all ten lines, then the total that ties to the contract sum", () => {
    const table = card("lines").sections![0];
    expect(table.columns).toEqual([
      "Line",
      "Cost code",
      "Division",
      "Description",
      "Scheduled value",
      "% of total",
    ]);
    expect(table.rows).toHaveLength(11);
    expect(table.rows.at(-1)!.cells).toEqual([
      "Total",
      "",
      "",
      "Contract sum",
      "$1,400,000.00",
      "100.00%",
    ]);
    const html = renderHtml(card("lines"));
    for (const r of sovLineRows(sov)) {
      expect(html).toContain(r.description);
      expect(html).toContain(r.scheduled_value_display);
    }
    expect(paletteViolations(html, false)).toEqual([]);
    // Blank cells stay blank (no "Item" placeholder); money and percents never break mid-number.
    expect(html).not.toContain(">Item<");
    expect(html).toContain('<td class="num" data-label="Scheduled value">$1,400,000.00</td>');
    expect(renderMarkdown(card("lines"))).toContain(
      "| Total |  |  | Contract sum | $1,400,000.00 | 100.00% |",
    );
    const painted = widget(card("lines"));
    expect(painted).toContain("Fire alarm system");
    expect(painted).not.toContain(">Item<");
    expect(painted).toContain('<td class="num" data-label="Scheduled value">$1,400,000.00</td>');
  });

  it("shows the division roll-up for the divisions view", () => {
    const table = card("divisions").sections![0];
    expect(table.rows.map((r) => r.cells[0])).toEqual([
      "26 Electrical",
      "27 Communications",
      "28 Electronic Safety and Security",
      "Total",
    ]);
  });
});
