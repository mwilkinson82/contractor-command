import { sheetReadGroups } from "./sheet-pass";
import { currentDroppedLines } from "./history";
import { reconcileDocumentScope } from "./document-scope";
import { hostWorkflowSection, measurementEvidence } from "./host-workflow";
import { ToolError, type JsonValueInput } from "@lovable.dev/mcp-js";
import { dbError, type Sb } from "../guard";
import { type Job, named } from "../jobs";
import {
  drawingRecords,
  readStoredDrawingBytes,
  sheetPageIndex,
  type DrawingRecord,
} from "../drawing-set";

import { bytesToBase64 } from "../estimating-sheet";
import { verifyLocatedShape } from "./verify";
import { cachedSource } from "./cache";
import { automaticCalibration, dimensionChecked, scaleLock } from "./calibration";
import { drawingReferences, drawingReferenceSection } from "./drawing-references";
import { highlightedPreview } from "./render";
import { renderMarkdown } from "../cards/markdown";
import { TAKEOFF_CARD_URI } from "../cards/takeoff-card";
import type { CardModel } from "../cards/model";
import { calibrate, measure, type Calibration, type Shape } from "./geometry";
import { inspectSheet, renderTile, scaleProposals, sheetSpace, type SheetInspection } from "./pdf";
import { foundationGapPrompts, parseState, settle, takeoffLineFor } from "../estimating";
import {
  engineSnapshot,
  measurementStatus,
  verifiedLines,
  type EngineSnapshot,
  type GeometryRevision,
} from "./state";

export async function engineRpc<T>(
  sb: Pick<Sb, "rpc">,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await sb.rpc(name, args);
  if (result.error) dbError(result.error);
  if (result.data == null)
    throw new ToolError("The measurement could not be confirmed. Reload before retrying.");
  return result.data as T;
}
export type StoredPage = {
  source: DrawingRecord;
  sheet: string;
  page: number;
  bytes: Uint8Array;
  inspection: SheetInspection;
  space: ReturnType<typeof sheetSpace>;
};
/** One line per stored set, so a host can pass source_id on the next call. */
export function describeStoredSets(sources: DrawingRecord[]): string {
  if (!sources.length) return "No drawing set is stored on this job.";
  return (
    "Stored sets: " +
    sources
      .map(
        (s) =>
          `${s.filename} (revision ${s.version}, ${s.sheets.length} sheet${s.sheets.length === 1 ? "" : "s"}, source_id ${s.id})`,
      )
      .join("; ") +
    "."
  );
}
/** The stored set that holds the sheet. Without a source_id, every set on the job is searched and the
 *  newest revision that contains the sheet wins, the same rule drawing_markup uses; the newest set on the
 *  job is never assumed to be the right one. */
export function resolveStoredSource(
  sources: DrawingRecord[],
  sheet: string,
  sourceId?: string,
): DrawingRecord {
  const selected = sourceId ? sources.find((s) => s.id === sourceId) : undefined;
  if (sourceId && !selected)
    throw new ToolError(
      `No stored drawing set has source_id ${sourceId} on this job. ${describeStoredSets(sources)} No older drawing was substituted.`,
    );
  if (selected) {
    if (!selected.sheets.length)
      throw new ToolError(
        "This PDF is stored but its sheet names are needed. Save its page order once in the drawing library; no re-upload is needed.",
      );
    if (sheetPageIndex(selected.sheets, sheet) == null) {
      const elsewhere = sources.filter((s) => sheetPageIndex(s.sheets, sheet) != null);
      throw new ToolError(
        `Sheet ${sheet} is not in ${selected.filename} (source_id ${selected.id}).` +
          (elsewhere.length
            ? ` It is in ${elsewhere.map((s) => `${s.filename} (source_id ${s.id})`).join(" and ")}.`
            : " No stored set on this job has it.") +
          " No older drawing was substituted.",
      );
    }
    return selected;
  }
  // Records arrive newest first, so the first set holding the sheet is its newest revision.
  const holder = sources.find((s) => sheetPageIndex(s.sheets, sheet) != null);
  if (holder) return holder;
  if (!sources.length)
    throw new ToolError(
      "Choose a drawing set stored on this job. No other source was substituted.",
    );
  if (sources.every((s) => !s.sheets.length))
    throw new ToolError(
      "This PDF is stored but its sheet names are needed. Save its page order once in the drawing library; no re-upload is needed.",
    );
  throw new ToolError(
    `Sheet ${sheet} is not in any stored set on this job. ${describeStoredSets(sources)} No older drawing was substituted.`,
  );
}
export async function loadStoredPage(
  sb: Sb,
  job: Job,
  sheet: string,
  sourceId?: string,
): Promise<StoredPage> {
  const sources = await drawingRecords(sb, job);
  const source = resolveStoredSource(sources, sheet, sourceId);
  const index = sheetPageIndex(source.sheets, sheet)!;
  // Read/hash validation is shared with direct imports; a source reference alone
  // never establishes ownership or authorizes a different bucket/job.
  const bytes = await cachedSource(
    `${job.company_id}:${job.job_id}:${source.id}:${source.content_hash}`,
    () => readStoredDrawingBytes(sb, job, source),
  );
  const inspection = await inspectSheet(bytes, index);
  return {
    source,
    sheet: source.sheets[index],
    page: index + 1,
    bytes,
    inspection,
    space: sheetSpace(source, index + 1, inspection),
  };
}
/** A review row is red only for a recorded risk: a conflict between the documents that holds the bid.
 *  A missing or unmeasured quantity is work to do, not a risk, however hard the gap. */
export function reviewFlag(i: { holdsBid: boolean; category?: string | null }): "risk" | null {
  return i.holdsBid && i.category === "conflict" ? "risk" : null;
}
/** settle() keeps no category on its items, so the flag reads it from the gap the row came from. */
export function reviewRows(
  items: {
    kind: "line" | "gap";
    ref: string;
    title: string;
    status: string;
    holdsBid: boolean;
    followUp: string | null;
    math: string | null;
  }[],
  gaps: {
    ref: string;
    category?: string | null;
    confidence?: string | null;
    evidence_basis?: string | null;
  }[],
) {
  return items
    .filter((i) => i.kind === "gap")
    .map((i) => ({
      cells: [
        `${i.ref} · ${i.title}`,
        i.status,
        i.followUp ?? i.math ?? "",
        `Reported confidence: ${gaps.find((g) => g.ref === i.ref)?.confidence ?? "low (not rated)"} · Basis: ${gaps.find((g) => g.ref === i.ref)?.evidence_basis ?? "assumed (not recorded)"}`,
      ],
      flag: reviewFlag({
        holdsBid: i.holdsBid,
        category: gaps.find((g) => g.ref === i.ref)?.category,
      }),
    }));
}
export async function viewEngine(
  sb: Sb,
  job: Job,
  state: EngineSnapshot,
  page?: StoredPage,
  extra: Record<string, unknown> = {},
) {
  const summary = measurementStatus(state);
  const evidenceReview = measurementEvidence(state);
  const droppedLines = currentDroppedLines(state.dropped_lines ?? []);
  const drawingScopeReview = page
    ? {
        source_id: page.source.id,
        source_hash: page.source.content_hash,
        page: page.page,
        ...drawingReferences(page.inspection, page.sheet, state.lines),
      }
    : null;
  const allSources = await drawingRecords(sb, job);
  const storedSheets = new Set(
    allSources.flatMap((s) => s.sheets.map((name) => name.trim().toLowerCase())),
  );
  // A line whose sheet is not in any stored set is not a drawing line the engine can locate: it is
  // shown as such instead of padding the unlocated count (general conditions, allowances, typos).
  const noSheet = (l: { line_no: number }) => {
    const sheet = state.lines
      .find((row) => row.line_no === l.line_no)
      ?.sheet?.trim()
      .toLowerCase();
    return !sheet || !storedSheets.has(sheet);
  };
  const unlocatedOnSheets = summary.lines.filter((l) => l.status === "unlocated" && !noSheet(l));
  const noStoredSheet = summary.lines.filter((l) => l.status === "unlocated" && noSheet(l));
  const lockedCalibration = page
    ? state.calibrations
        .filter((c) => c.source_id === page.source.id && c.page === page.page && c.confirmed)
        .sort((a, b) => b.version - a.version)[0]
    : null;
  const lock = page ? scaleLock(page.inspection.text, !!lockedCalibration) : null;
  const readyGroups = page
    ? sheetReadGroups(page, state, { calibration_id: lockedCalibration?.id })
    : [];
  const guided = page
    ? {
        stage: !lockedCalibration
          ? "lock_scale"
          : readyGroups.length
            ? "continue_read"
            : summary.proposed
              ? "review_proposals"
              : "confirm_region_and_read",
        next_tool_call: {
          name: lockedCalibration ? "takeoff_geometry" : "sheet_calibrate",
          arguments: {
            job_number: job.job_number,
            company_id: job.company_id,
            source_id: page.source.id,
            sheet: page.sheet,
            operation: lockedCalibration ? "propose" : "read",
            ...(lockedCalibration
              ? {
                  calibration_id: lockedCalibration.id,
                  ...(readyGroups[0] ? { line_nos: readyGroups[0].line_nos } : {}),
                }
              : {}),
          },
        },
        accepted_lines: summary.located,
        proposed_lines: summary.proposed,
        count_area_candidates: state.lines
          .filter(
            (l) =>
              /^(ea|each)$/i.test(l.unit ?? "") &&
              l.sheet?.trim().toLowerCase() === page.sheet.trim().toLowerCase() &&
              !state.passes.some(
                (p) =>
                  p.source_id === page.source.id &&
                  p.page === page.page &&
                  p.pass_summary.line_no === l.line_no &&
                  (p.pass_summary.count_area as { confirmed?: boolean } | undefined)?.confirmed ===
                    true,
              ) &&
              summary.lines.some((r) => r.line_no === l.line_no && r.status === "unlocated"),
          )
          .map((l) => ({ line_no: l.line_no, item: l.item })),
        workflow:
          "Confirm the plan region, then read all ready lines on each tile together. Scope accepts line_nos for several count lines sharing that complete region in one call. Review wall runs and footing counts against the sheet; accept only the displayed revisions you approve. Athena saves accepted quantities from geometry. Unready lines remain visible with their reason.",
      }
    : null;
  const card: CardModel = {
    state: summary.settled ? "result" : "progress",
    show_state: false,
    title: page ? `${page.sheet} · Drawing takeoff` : "Drawing takeoff",
    job: named(job),
    kpis: [
      { label: "Located and accepted", value: String(summary.located) },
      { label: "Proposals to review", value: String(summary.proposed) },
      { label: "Unlocated", value: String(unlocatedOnSheets.length) },
      { label: "Not drawable", value: String(summary.not_drawable) },
      ...(noStoredSheet.length
        ? [{ label: "No stored sheet", value: String(noStoredSheet.length) }]
        : []),
    ],
    sections: [
      ...(lock
        ? [
            {
              heading: lockedCalibration ? "Scale locked for this sheet" : "Lock the scale first",
              kind: "list" as const,
              rows: [
                {
                  cells: [
                    lockedCalibration
                      ? `${lockedCalibration.region} · saved calibration v${lockedCalibration.version} · ${dimensionChecked(lockedCalibration) ? "Dimension checked" : "Member confirmed; independent dimension check still needed"}`
                      : lock.printed_scales.length
                        ? `Printed scale: ${lock.printed_scales.join("; ")}${lock.as_noted ? " · As Noted" : ""}`
                        : "Printed scale is unclear or As Noted.",
                  ],
                },
                ...lock.choices.map((choice) => ({ cells: [choice] })),
              ],
            },
          ]
        : []),
      ...(guided && lockedCalibration
        ? [
            {
              heading: "Guided measuring",
              kind: "list" as const,
              rows: [
                { cells: [guided.workflow] },
                {
                  cells: [
                    `Proposed lines: ${summary.proposed} · Accepted lines: ${summary.located}`,
                  ],
                },
              ],
            },
          ]
        : []),
      hostWorkflowSection(),
      {
        heading: "Measured takeoff",
        kind: "table",
        columns: ["Line", "Item", "Accepted", "Proposed", "Unit", "Status"],
        rows: summary.lines.map((l) => ({
          cells: [
            `L${l.line_no}`,
            l.item,
            l.accepted == null ? "Not established" : String(l.accepted),
            l.proposed == null ? "" : String(l.proposed),
            l.unit || "",
            l.status === "unlocated" && noSheet(l)
              ? "no stored sheet (name its set, or mark it not drawable)"
              : l.status.replace("_", " "),
          ],
        })),
      },
      ...(droppedLines.length
        ? [
            {
              heading: `Dropped since takeoff v${droppedLines[0].version}`,
              kind: "list" as const,
              rows: droppedLines.map((d) => ({
                cells: [
                  `L${d.line_no} · ${d.item}`,
                  d.had_geometry
                    ? "Had measured geometry. Re-save the line to restore it, or it stays historical."
                    : "Not in the current takeoff. Re-save it if it still belongs.",
                ],
                tone: "unknown" as const,
              })),
            },
          ]
        : []),
      ...(drawingScopeReview ? [drawingReferenceSection(drawingScopeReview)] : []),
    ],
    next_move: summary.settled
      ? "Current lines are settled. Reconcile their coverage with the drawings, specifications and contract, and resolve cited questions before building the bid."
      : "Locate missing work, confirm its scale and review proposals. A quantity is confirmed only from accepted geometry or a recorded non-drawable basis.",
  };
  if (lock && !lock.locked) {
    card.ask = { prompt: lock.question! };
    card.next_move = "Choose one of the two scale options. No measurement has started.";
  } else if (guided && lockedCalibration && !summary.settled) {
    card.next_move = readyGroups.length
      ? "Continue the unread region groups from their saved checkpoints. Proposals remain for review; a completed group is not a completed project takeoff."
      : summary.proposed
        ? "Review the highlighted proposed quantities and accept the exact revisions you agree with. Unread regions and open scope stay visible."
        : `Scale locked for ${lockedCalibration.region}. Confirm the count region for the listed footing lines together, then ask your AI to continue the sheet read. Athena returns each next region and saves proposals for your review.`;
    if (guided.count_area_candidates.length)
      card.sections?.splice(1, 0, {
        heading: "Count lines awaiting one area confirmation",
        kind: "list",
        rows: guided.count_area_candidates.map((l) => ({ cells: [`L${l.line_no} · ${l.item}`] })),
      });
  }
  const locatedReview = evidenceReview.filter((line) => line.references.length);
  if (locatedReview.length)
    card.sections?.push({
      heading: "Measurement confidence and verification",
      kind: "list",
      rows: locatedReview.map((line) => ({
        cells: [
          `L${line.line_no} · ${line.item} · ${line.status} · ${line.measurement_classification}`,
          `Scale: ${line.scale_status}`,
          line.reported_confidence_range
            ? `AI-reported confidence ${Math.round(line.reported_confidence_range.low * 100)}–${Math.round(line.reported_confidence_range.high * 100)}%. This is not an accuracy probability.`
            : "No AI confidence recorded.",
          line.verification_needed,
        ],
      })),
    });
  if (lockedCalibration?.reference.dimension_checks?.length)
    card.sections?.push({
      heading: "Scale dimension checks",
      kind: "list",
      rows: [
        ...lockedCalibration.reference.dimension_checks.map((check) => ({
          cells: [
            check.label,
            `${check.distance} ${check.unit} · ${page?.sheet} · source ${lockedCalibration.source_id}`,
          ],
        })),
        {
          cells: [
            "Dimension labels were supplied with the calibration. Athena checked their numeric values, scale agreement and endpoint ink on this stored sheet; item/text identification remains subject to estimator review.",
          ],
        },
      ],
    });
  if (readyGroups.length > 1)
    card.sections?.push({
      heading: "Remaining sheet read groups",
      kind: "list",
      rows: readyGroups.map((g) => ({
        cells: [
          `Lines ${g.line_nos.join(", ")}`,
          `${g.next_cursor} of ${g.tiles_total} regions inspected`,
          "Saved region orders are preserved; each group continues from its own checkpoint.",
        ],
      })),
    });
  const scopeReconciliation = reconcileDocumentScope(state);
  card.sections?.push({
    heading: "Document-based scope reconciliation",
    kind: "list",
    rows: scopeReconciliation.length
      ? scopeReconciliation.map((r) => ({
          cells: [
            `${r.id} · ${r.title} · ${r.classification}`,
            `${r.source_type} ${r.source_ref} · ${r.citation} · ${r.source_status} · “${r.excerpt}”`,
            `Reported confidence: ${r.confidence} · Basis: ${r.evidence_basis}. ${r.reason}`,
          ],
        }))
      : [
          {
            cells: [
              "No job-document scope list has been saved yet. Drawing notes, specification paragraphs and contract requirements still need review; the fixed checklist does not establish full coverage.",
            ],
          },
        ],
  });
  if (typeof extra.report_title === "string") card.title = extra.report_title;
  if (Array.isArray(extra.report_rows))
    card.sections?.push({
      heading: typeof extra.report_title === "string" ? extra.report_title : "Estimate record",
      kind: "list",
      rows: extra.report_rows
        .filter((r) => typeof r === "string")
        .map((r) => ({ cells: [r as string] })),
    });
  if ((extra.export as { historical?: boolean } | undefined)?.historical)
    card.sections?.push({
      heading: "Dated copy",
      kind: "list",
      rows: [
        {
          cells: [
            "This is the saved historical PDF, not a new measurement.",
            (extra.export as { stale?: boolean }).stale
              ? "Geometry has changed since this copy was made."
              : "Its geometry references match the current sheet.",
          ],
        },
      ],
    });
  if (Array.isArray(extra.downloads))
    card.sections?.push({
      heading: "Private downloads (15 minutes)",
      kind: "list",
      rows: extra.downloads.map((d) => {
        const file = d as { filename: string; url: string };
        return { cells: [file.filename], href: file.url };
      }),
    });
  const { renderPdfiumPage } = await import("../pdf-renderer");
  const review = parseState({
    setup: { role: state.role, trades: state.trades ?? [] },
    takeoff: { version: state.takeoff_version, lines: state.lines },
    gaps: state.gaps ?? [],
    verdicts: state.verdicts ?? [],
  });
  const settled = settle(
    verifiedLines(review.lines, state),
    review.gaps,
    review.verdicts.map((v) => (v.item_kind === "line" ? { ...v, corrected_qty: null } : v)),
    { role: review.setup.role, trades: review.setup.trades },
  );
  // Scope the takeoff never included is a coverage gap, not an unlocated line. The fixed foundation
  // checklist names what every foundation takeoff must quantify or mark N/A; it is not a reading of the
  // drawings, so scope beyond it (piers, bollards, pole foundations) still has to come from the sheets.
  const uncovered = foundationGapPrompts(review.lines).filter(
    (g) => !takeoffLineFor(review.lines, g.title),
  );
  if (uncovered.length)
    card.sections?.push({
      heading: "Foundation checklist items with no takeoff line",
      kind: "list",
      rows: [
        ...uncovered.map((g) => ({
          cells: [g.title, "Add a takeoff line and locate it, or mark it N/A with a reason."],
          tone: "unknown" as const,
        })),
        {
          cells: [
            "This checklist is fixed. Scope the drawings show beyond it is not checked here.",
          ],
          tone: "unknown" as const,
        },
      ],
    });
  card.sections?.push({
    heading: "Estimate review",
    kind: "list",
    rows: [
      {
        cells: [
          `Open ${settled.counts.open} · Settled ${settled.counts.settled} · Dropped ${settled.counts.dropped}`,
        ],
      },
      // Red is for a recorded conflict, never for an open quantity that is only waiting to be measured.
      ...reviewRows(settled.items, review.gaps),
    ],
  });
  if (
    state.sources?.some(
      (s) => s.stale && state.geometry.some((g) => g.source_id === s.id && g.status !== "rejected"),
    )
  )
    card.sections?.push({
      heading: "Drawing revision review",
      kind: "list",
      rows: [
        {
          cells: [
            "A measured source has a newer drawing or corrected sheet index. Its previous accepted quantity remains historical; check the new sheet and approve its geometry before building a final bid.",
          ],
        },
      ],
    });
  if (Array.isArray(extra.history))
    card.sections?.push({
      heading: "Measurement history",
      kind: "list",
      rows: extra.history.map((value) => {
        const row = value as GeometryRevision & { line_no: number; item: string };
        return {
          cells: [
            `L${row.line_no} · ${row.item} · revision ${row.version}`,
            `${row.measured ?? "Not drawable"} ${row.unit ?? ""} · ${row.status}`,
            row.reason ?? "",
            row.created_at,
            `Recorded by ${row.created_by}`,
            `Source ${row.source_id ?? "non-drawable basis"}`,
          ],
        };
      }),
    });
  if (extra.include_rejected === true)
    card.sections?.push({
      heading: "Rejected geometry",
      kind: "list",
      rows: state.geometry
        .filter(
          (g) =>
            g.status === "rejected" &&
            (!page || (g.source_id === page.source.id && g.page === page.page)),
        )
        .map((g) => ({
          cells: [
            `L${state.lines.find((l) => l.id === g.line_id)?.line_no} · ${g.shape.kind}`,
            g.reason ?? "Reason not recorded",
            `Revision ${g.version}`,
          ],
        })),
    });
  const preview = page ? await renderPdfiumPage(page.bytes, page.page - 1) : null;
  const highlighted = page
    ? await highlightedPreview(page, state, extra.include_rejected === true)
    : null;
  if (extra.export && typeof (extra.export as { url?: unknown }).url === "string")
    card.sections?.push({
      heading: "Dated measured PDF",
      kind: "list",
      rows: [
        {
          cells: ["Download dated measured drawing (15-minute private link)"],
          href: (extra.export as { url: string }).url,
        },
      ],
    });
  const availableSources = (await drawingRecords(sb, job)).map((s) => ({
    id: s.id,
    filename: s.filename,
    revision: s.version,
    content_hash: s.content_hash,
    sheets: s.sheets,
    source_key: s.source_key,
  }));
  const structuredContent = {
    scale_lock: lock,
    guided_measurement: guided,
    ready_sheet_groups: readyGroups,
    snapshot_at: new Date().toISOString(),
    available_sources: availableSources,
    card,
    engine: { ...state, summary },
    measurement_review: evidenceReview,
    document_scope_reconciliation: scopeReconciliation,
    context: {
      job_id: job.job_id,
      job_number: job.job_number,
      company_id: job.company_id,
      source_id: page?.source.id,
      sheet: page?.sheet,
    },
    ...(page
      ? {
          source: {
            id: page.source.id,
            filename: page.source.filename,
            revision: page.source.version,
            content_hash: page.source.content_hash,
            sheet: page.sheet,
            page: page.page,
          },
          space: page.space,
          tiles: page.inspection.tiles,
          scale_proposals: scaleProposals(page.inspection.text),
          drawing_scope_review: drawingScopeReview,
          automatic_calibration: automaticCalibration(page.space, page.inspection),
          preview: preview ? `data:image/png;base64,${bytesToBase64(preview)}` : null,
        }
      : {}),
    ...extra,
  };
  const refs = {
    source_id: page?.source.id,
    sheet: page?.sheet,
    takeoff_version: state.takeoff_version,
    calibrations: state.calibrations.map((c) => ({
      id: c.id,
      source_id: c.source_id,
      page: c.page,
      region: c.region,
      version: c.version,
      confirmed: c.confirmed,
    })),
    geometry: state.geometry.map((g) => ({
      geometry_id: g.geometry_id,
      revision_id: g.id,
      expected_version: g.version,
      line_no: state.lines.find((l) => l.id === g.line_id)?.line_no,
      source_id: g.source_id,
      page: g.page,
      status: g.status,
      measured: g.measured,
      unit: g.unit,
    })),
    pass: extra.pass ?? null,
  };
  const factual =
    renderMarkdown(card) +
    "\n\n### Measurement references\n\n```json\n" +
    JSON.stringify(refs) +
    "\n```";
  return {
    content: [
      { type: "text" as const, text: factual },
      ...(highlighted
        ? [{ type: "image" as const, mimeType: "image/png", data: bytesToBase64(highlighted) }]
        : []),
    ],
    structuredContent: structuredContent as unknown as JsonValueInput,
    _meta: {
      "openai/outputTemplate": TAKEOFF_CARD_URI,
      ui: { resourceUri: TAKEOFF_CARD_URI },
    },
  };
}
export async function saveCalibration(
  sb: Sb,
  job: Job,
  page: StoredPage,
  input: Omit<Calibration, "feet_per_point" | "version">,
  expected: number,
) {
  const checked = calibrate(page.space, { ...input, version: expected + 1 });
  if (input.reference.dimension_checks_verified && input.reference.dimension_checks) {
    for (const check of input.reference.dimension_checks)
      await verifyLocatedShape(page, { kind: "pins", points: check.points });
  } else if (input.method !== "title_block")
    await verifyLocatedShape(page, { kind: "pins", points: input.reference.points });
  return engineRpc<Calibration>(sb, "mcp_takeoff_calibrate", {
    _job: job.job_id,
    _source: page.source.id,
    _page: page.page,
    _expected: expected,
    _record: { ...checked, width: page.space.width, height: page.space.height },
  });
}
export async function saveGeometry(
  sb: Sb,
  job: Job,
  page: StoredPage,
  state: EngineSnapshot,
  input: {
    line_no: number;
    shape: Shape;
    calibration_id?: string;
    geometry_id?: string;
    expected_version: number;
    reason?: string;
    evidence?: Record<string, unknown>;
  },
  operation: "save" | "propose" = "save",
) {
  if (!state.lines.some((l) => l.line_no === input.line_no))
    throw new ToolError("Read the current takeoff line before locating it.");
  const line = state.lines.find((l) => l.line_no === input.line_no)!;
  if (line.sheet?.trim() && line.sheet.trim().toLowerCase() !== page.sheet.trim().toLowerCase())
    throw new ToolError(
      `L${line.line_no} is assigned to ${line.sheet}, not ${page.sheet}. No geometry was saved.`,
    );
  const calibration = state.calibrations.find(
    (c) => c.id === input.calibration_id && c.source_id === page.source.id && c.page === page.page,
  );
  measure(page.space, input.shape, calibration);
  if (
    input.shape.depth &&
    !(await drawingRecords(sb, job)).some(
      (s) => s.id === input.shape.depth!.source_id && s.sheets.includes(input.shape.depth!.sheet),
    )
  )
    throw new ToolError("The depth citation must name a stored sheet on this job.");
  const previous = state.geometry.find((g) => g.geometry_id === input.geometry_id);
  if (
    previous?.shape.kind === "pins" &&
    input.shape.kind === "pins" &&
    input.shape.points.length < previous.shape.points.length &&
    !input.reason?.trim()
  )
    throw new ToolError("Record why this pin is being removed.");
  const checked = await verifyLocatedShape(page, input.shape);
  return engineRpc<GeometryRevision>(sb, "mcp_takeoff_geometry_save", {
    _job: job.job_id,
    _operation: operation,
    _expected: input.expected_version,
    _record: {
      ...input,
      evidence: { ...input.evidence, ...checked },
      source_id: page.source.id,
      page: page.page,
      takeoff_version: state.takeoff_version,
      width: page.space.width,
      height: page.space.height,
    },
  });
}
export async function decideGeometry(
  sb: Sb,
  job: Job,
  state: EngineSnapshot,
  input: { geometry_id: string; expected_version: number; reason?: string },
  operation: "accept" | "reject",
) {
  const row = state.geometry.find(
    (g) => g.geometry_id === input.geometry_id && g.version === input.expected_version,
  );
  if (!row) throw new ToolError("The geometry changed. Reload the proposal before deciding.");
  if (operation === "accept") {
    const { assertReadComplete } = await import("./scope");
    assertReadComplete(state, row);
  }
  if (operation === "reject" && !input.reason?.trim())
    throw new ToolError("Record why this geometry is being rejected.");
  const line = state.lines.find((l) => l.id === row.line_id)!;
  return engineRpc<GeometryRevision>(sb, "mcp_takeoff_geometry_save", {
    _job: job.job_id,
    _operation: operation,
    _expected: input.expected_version,
    _record: {
      geometry_id: row.geometry_id,
      line_no: line.line_no,
      takeoff_version: state.takeoff_version,
      reason: input.reason,
    },
  });
}
export async function readTile(sb: Sb, job: Job, page: StoredPage, index: number) {
  const tile = page.inspection.tiles[index];
  if (!tile) throw new ToolError("Choose a tile from this stored sheet.");
  const rendered = await renderTile(page.bytes, page.page - 1, tile);
  return {
    tile,
    png: `data:image/png;base64,${bytesToBase64(rendered.png)}`,
    content: { type: "image" as const, mimeType: "image/png", data: bytesToBase64(rendered.png) },
  };
}
export const requiredSnapshot = (sb: Sb, job: Job) =>
  engineSnapshot(sb, job.job_id, true) as Promise<EngineSnapshot>;
