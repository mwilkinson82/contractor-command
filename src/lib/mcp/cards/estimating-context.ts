import type { CardModel } from "./model";
import type { DocReview, Setup, StoredGap } from "../estimating";
import type { documentInventory } from "../estimate-document-inventory";

/** Complete server-built context cards; no text inference or eight-line truncation. */
export function estimatingContextCard(sc: Record<string, unknown>): CardModel | null {
  const kind = sc.estimate_view_kind;
  if (!["intake", "documents", "gaps"].includes(String(kind))) return null;
  const card: CardModel = {
    state: "result",
    show_state: false,
    title:
      kind === "intake"
        ? "Estimating intake"
        : kind === "documents"
          ? "Document review"
          : "Estimate gap analysis",
    job: typeof sc.job === "string" ? sc.job : "",
    sections: [],
  };
  if (kind === "intake") {
    const inventory = sc.document_inventory as ReturnType<typeof documentInventory> | undefined;
    const setup = sc.setup as Setup | undefined;
    const questions = sc.questions as string[] | undefined;
    if (sc.drawing_receipt)
      card.sections!.push({
        heading: "Storage result",
        kind: "list",
        rows: [{ cells: [String(sc.drawing_receipt)] }],
      });
    if (sc.reuse_warning) card.ask = { prompt: String(sc.reuse_warning) };
    if (sc.model_selection)
      card.sections!.push({
        heading: "Before we start",
        kind: "list",
        rows: [{ cells: [String(sc.model_selection)] }],
      });
    if (questions?.length)
      card.sections!.push({
        heading: "Intake questions",
        kind: "list",
        rows: questions.map((q) => ({ cells: [q] })),
      });
    if (setup)
      card.sections!.push({
        heading: "Agreed estimating scope",
        kind: "list",
        rows: [
          {
            cells: [
              `Role: ${setup.role === "gc" ? "General contractor" : setup.role === "self_performer" ? "Self-performer" : "Not answered"}`,
              `Trades: ${setup.trades.join(", ") || "not stated"}`,
            ],
          },
          {
            cells: [
              `Profile: ${sc.profile === "as_drawn" ? "As drawn (net slab areas)" : sc.profile === "estimator" ? "Estimator (gross slab areas)" : "Not answered"}`,
              `Form faces: ${sc.forms_faces ?? "not answered"}`,
            ],
          },
          { cells: [`In scope: ${setup.in_scope.join("; ") || "not stated"}`] },
          { cells: [`Excluded: ${setup.out_scope.join("; ") || "not stated"}`] },
          { cells: [`Assumptions: ${setup.assumptions.join("; ") || "none stated"}`] },
          {
            cells: [
              `Bid due: ${setup.bid_due ?? "not stated"}`,
              `Delivery: ${setup.delivery_method ?? "not stated"}`,
            ],
          },
        ],
      });
    if (Array.isArray(sc.coordination) && sc.coordination.length)
      card.sections!.push({
        heading: "Coordination questions",
        kind: "list",
        rows: sc.coordination.map((q) => ({ cells: [String(q)] })),
      });
    if (setup?.sub_bids.length)
      card.sections!.push({
        heading: "Sub bids named",
        kind: "list",
        rows: setup.sub_bids.map((b) => ({ cells: [b.sub, b.trade, `${b.lines.length} lines`] })),
      });
    if (inventory) {
      card.kpis = [
        { label: "Registered drawing sets", value: String(inventory.drawings.length) },
        { label: "Saved spec reviews", value: String(inventory.reviewed_spec_sections.length) },
        { label: "Saved contract clauses", value: String(inventory.contract_clauses.length) },
      ];
      card.sections!.push({
        heading: "Stored drawings",
        kind: "list",
        rows: inventory.drawings.map((s) => ({
          cells: [
            `${s.name} · revision ${s.revision}`,
            s.sheets.join(", ") || "Sheet index needed",
            `Source ID: ${s.source_id}`,
          ],
          raw: true,
        })),
      });
      card.sections!.push({
        heading: "Specifications and contract evidence",
        kind: "list",
        rows: [
          ...[...inventory.specifications, ...inventory.contracts].map((d) => ({
            cells: [d.name, d.path ? "Stored file" : "Listed; file storage not confirmed"],
          })),
          ...inventory.reviewed_spec_sections.map((s) => ({
            cells: [`Spec ${s.section} · ${s.title}`, "Saved section review"],
          })),
          ...inventory.contract_clauses.map((c) => ({
            cells: [
              `Contract §${c.section}`,
              c.source ?? "Saved clause text; complete file not confirmed",
            ],
          })),
          ...(!inventory.specifications.length && !inventory.reviewed_spec_sections.length
            ? [{ cells: ["No specification document or section review is on file."] }]
            : []),
          ...(!inventory.contracts.length && !inventory.contract_clauses.length
            ? [
                {
                  cells: [
                    "No saved contract text was found; a contract file elsewhere is not ruled out.",
                  ],
                },
              ]
            : []),
        ],
      });
      card.next_move = inventory.scale_next_step;
    }
  } else if (kind === "documents") {
    const review = sc.document_review as DocReview;
    card.sections!.push({
      heading: "Drawing sheets",
      kind: "list",
      rows: review.sheets.map((s) => ({
        cells: [
          s.sheet,
          s.title,
          s.scale ?? "Scale not stated",
          s.revision ?? "Revision not stated",
          ...(s.notes ?? []),
          ...(s.schedules ?? []),
        ],
      })),
    });
    card.sections!.push({
      heading: "Specification sections",
      kind: "list",
      rows: review.specs.map((s) => ({
        cells: [s.section, s.title, s.part1 ?? "", s.part2 ?? "", s.part3 ?? ""],
      })),
    });
    card.sections!.push({
      heading: "Spec requires / drawing shows",
      kind: "list",
      rows: review.pairs.map((p) => ({
        cells: [
          p.spec_section,
          p.requirement,
          `${p.sheet} ${p.detail ?? ""}`,
          p.drawing_shows ?? "Not shown",
        ],
      })),
    });
    card.sections!.push({
      heading: "Cited document scope",
      kind: "list",
      rows: (review.scope_requirements ?? []).map((r) => ({
        cells: [
          r.id,
          r.title,
          `${r.source_type} ${r.source_ref} · ${r.citation}`,
          r.excerpt,
          `Reported confidence: ${r.confidence} · Basis: ${r.evidence_basis}`,
          r.line_nos.length ? `Takeoff lines: ${r.line_nos.join(", ")}` : "No takeoff line mapped",
        ],
      })),
    });
    card.next_move =
      "Lock each plan region's scale, then reconcile cited scope against the measured takeoff.";
  } else {
    const gaps = sc.gaps as StoredGap[];
    card.kpis = [{ label: "Findings", value: String(gaps.length) }];
    card.sections!.push({
      heading: "Cited findings",
      kind: "list",
      rows: gaps.map((g) => ({
        cells: [
          `${g.ref} · ${g.title}`,
          `${g.sheet} ${g.detail ?? ""} · Spec ${g.spec_section}`,
          g.reasoning,
          `Reported confidence: ${g.confidence ?? "low (not rated)"} · Basis: ${g.evidence_basis ?? "assumed (not recorded)"}`,
        ],
        flag: g.category === "conflict" && g.holds_bid ? "risk" : null,
      })),
    });
    const outOfScope = sc.out_of_scope as
      { item: string; sheet: string; callout: string }[] | undefined;
    if (outOfScope?.length)
      card.sections!.push({
        heading: "Out of scope",
        kind: "list",
        rows: outOfScope.map((r) => ({ cells: [r.item, r.sheet, r.callout] })),
      });
    card.next_move =
      "Review cited findings and missing information before pricing; confidence is not an accuracy score.";
  }
  return card;
}
