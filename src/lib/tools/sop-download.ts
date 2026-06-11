// SOP download helpers — shared between the SOP Document Builder and
// the Vault packet card. Loads jsPDF on demand and falls back to a
// Markdown file if the PDF generator throws at runtime.

import type jsPDF from "jspdf";
import type { SopDocument } from "./sop-draft";

export function safeSopFileName(d: SopDocument): string {
  return (
    d.title
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "sop"
  );
}

export function sopToMarkdown(d: SopDocument): string {
  const lines: string[] = [];
  lines.push(`# ${d.title}`);
  lines.push("");
  lines.push(`**Department:** ${d.department}  `);
  lines.push(`**Owner:** ${d.owner}  `);
  lines.push(`**Revision cadence:** ${d.revisionCadence}`);
  lines.push("");
  lines.push(`## Purpose`);
  lines.push(d.purpose);
  lines.push("");
  lines.push(`## Scope`);
  lines.push(d.scope);
  lines.push("");
  lines.push(`## Trigger`);
  lines.push(d.trigger);
  lines.push("");
  lines.push(`## Inputs`);
  d.inputs.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push(`## Procedure`);
  d.steps.forEach((s) => {
    lines.push(`${s.number}. ${s.action}`);
    if (s.detail) lines.push(`   - ${s.detail}`);
  });
  lines.push("");
  lines.push(`## Outputs`);
  d.outputs.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push(`## Definition of Done`);
  lines.push(d.definitionOfDone);
  lines.push("");
  lines.push(`## KPIs`);
  d.kpis.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push(`## Exceptions`);
  d.exceptions.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  return lines.join("\n");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSopMarkdown(d: SopDocument): void {
  const blob = new Blob([sopToMarkdown(d)], { type: "text/markdown;charset=utf-8" });
  triggerDownload(blob, `${safeSopFileName(d)}.md`);
}

export type DownloadSopResult =
  | { ok: true; format: "pdf" | "md" }
  | { ok: false; format: "md"; warning: string }
  | { ok: false; format: null; error: string };

/**
 * Try to download the SOP as a PDF. If the PDF generator fails for any
 * reason (jsPDF import problem, renderer throw, blocked download), we
 * automatically fall back to a Markdown file so the user always gets a
 * tangible artifact.
 */
export async function downloadSopAsPdf(d: SopDocument): Promise<DownloadSopResult> {
  try {
    const mod = await import("jspdf");
    const Ctor =
      (mod as { jsPDF?: typeof jsPDF; default?: typeof jsPDF }).jsPDF ??
      (mod as { default?: typeof jsPDF }).default;
    if (!Ctor) throw new Error("jsPDF failed to load");
    const pdf = new Ctor({ unit: "pt", format: "letter" });
    renderSopToPdf(pdf, d);
    pdf.save(`${safeSopFileName(d)}.pdf`);
    return { ok: true, format: "pdf" };
  } catch (e) {
    console.error("[sop] PDF download failed", e);
    try {
      downloadSopMarkdown(d);
      return {
        ok: false,
        format: "md",
        warning: "PDF generator failed — downloaded a Markdown copy instead.",
      };
    } catch (e2) {
      console.error("[sop] Markdown fallback failed", e2);
      return {
        ok: false,
        format: null,
        error: e instanceof Error ? e.message : "Download failed.",
      };
    }
  }
}

/**
 * Try to parse a vault-packet `inputs.sopDocument` JSON string back into
 * a SopDocument. Returns null when the field is missing or malformed.
 */
export function parseSopFromPacketInputs(
  inputs: Record<string, unknown> | undefined,
): SopDocument | null {
  const raw = inputs?.sopDocument;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as SopDocument;
  } catch {
    return null;
  }
}

/* ====================================================================
 * Editorial PDF renderer — kept identical to the builder's renderer.
 * ==================================================================== */

const INK: [number, number, number] = [26, 25, 24];
const INK_MUTED: [number, number, number] = [110, 105, 95];
const INK_FAINT: [number, number, number] = [159, 153, 141];
const SIGNAL: [number, number, number] = [228, 87, 61];
const CREAM: [number, number, number] = [244, 243, 239];
const PAPER_DEEP: [number, number, number] = [236, 235, 229];
const CARD: [number, number, number] = [252, 251, 249];
const BORDER: [number, number, number] = [209, 207, 199];
const DIVIDER: [number, number, number] = [226, 222, 214];

export function renderSopToPdf(pdf: jsPDF, d: SopDocument): void {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  const footerReserve = 36;
  const contentBottom = pageH - footerReserve;
  let y = margin;

  const safe = (text: string) =>
    text
      .replace(/[→⟶➜]/g, "->")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/\u00a0/g, " ");

  const ensure = (need: number) => {
    if (y + need > contentBottom) {
      pdf.addPage();
      y = margin;
    }
  };

  const wrapLines = (
    text: string,
    width: number,
    size: number,
    family: "times" | "helvetica",
    style: "normal" | "bold" | "italic" = "normal",
  ) => {
    pdf.setCharSpace(0);
    pdf.setFont(family, style);
    pdf.setFontSize(size);
    return pdf.splitTextToSize(safe(text), width) as string[];
  };

  const resetTextState = () => {
    pdf.setCharSpace(0);
    pdf.setLineWidth(0);
  };

  const drawLines = (
    lines: string[],
    x: number,
    startY: number,
    size: number,
    family: "times" | "helvetica",
    style: "normal" | "bold" | "italic",
    color: [number, number, number],
    lineHeight = 1.4,
  ) => {
    resetTextState();
    pdf.setFont(family, style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lh = size * lineHeight;
    lines.forEach((line, i) => {
      resetTextState();
      pdf.text(line, x, startY + i * lh + size);
    });
    return lines.length * lh;
  };

  const drawCard = (
    x: number,
    cardY: number,
    w: number,
    h: number,
    fill: [number, number, number] = CARD,
    border: [number, number, number] = BORDER,
    radius = 6,
  ) => {
    pdf.setFillColor(...fill);
    pdf.setDrawColor(...border);
    pdf.setLineWidth(0.6);
    pdf.roundedRect(x, cardY, w, h, radius, radius, "FD");
    pdf.setLineWidth(0);
  };

  const drawLabel = (text: string, x: number, baselineY: number, color = INK_FAINT) => {
    resetTextState();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(...color);
    pdf.text(safe(text).toUpperCase(), x, baselineY);
  };

  // Hero
  pdf.setFillColor(...SIGNAL);
  pdf.rect(0, 0, pageW, 3, "F");
  const heroH = 132;
  pdf.setFillColor(...CREAM);
  pdf.rect(0, 3, pageW, heroH, "F");
  pdf.setDrawColor(...DIVIDER);
  pdf.setLineWidth(0.5);
  pdf.line(0, 3 + heroH, pageW, 3 + heroH);

  y = margin;
  drawLabel("Standard Operating Procedure", margin, y + 8, SIGNAL);
  y += 20;

  const titleLines = wrapLines(d.title, contentW, 24, "times", "normal");
  const titleH = drawLines(titleLines, margin, y - 24 * 0.2, 24, "times", "normal", INK, 1.15);
  y += titleH;

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...INK_MUTED);
  pdf.text(
    safe(`${d.department}  ·  Owner: ${d.owner}  ·  v1  ·  Generated ${today}`),
    margin,
    y + 6,
  );

  y = 3 + heroH + 22;

  // Summary
  const summaryItems: Array<[string, string]> = [
    ["Purpose", d.purpose],
    ["Scope", d.scope],
    ["Trigger", d.trigger],
  ];
  const summaryPadX = 18;
  const summaryPadY = 16;
  const summaryInnerW = contentW - summaryPadX * 2;

  let summaryH = summaryPadY;
  for (const [, value] of summaryItems) {
    summaryH += 11;
    const vLines = wrapLines(value, summaryInnerW, 10.5, "helvetica", "normal");
    summaryH += vLines.length * 10.5 * 1.5 + 12;
  }
  summaryH += summaryPadY - 12;

  ensure(summaryH + 20);
  drawCard(margin, y, contentW, summaryH, PAPER_DEEP, BORDER, 8);
  let sy = y + summaryPadY;
  for (const [label, value] of summaryItems) {
    drawLabel(label, margin + summaryPadX, sy);
    sy += 11;
    const vLines = wrapLines(value, summaryInnerW, 10.5, "helvetica", "normal");
    drawLines(vLines, margin + summaryPadX, sy - 10.5, 10.5, "helvetica", "normal", INK, 1.5);
    sy += vLines.length * 10.5 * 1.5 + 12;
  }
  y += summaryH + 20;

  // Inputs / Outputs
  const twoColGap = 14;
  const colW = (contentW - twoColGap) / 2;
  const colPadX = 14;
  const colPadY = 14;
  const colInnerW = colW - colPadX * 2;

  const bulletHeight = (items: string[]) => {
    let h = colPadY + 11 + 8;
    for (const it of items) {
      const lines = wrapLines(`•  ${it}`, colInnerW - 6, 10, "helvetica", "normal");
      h += lines.length * 10 * 1.45 + 4;
    }
    return h + colPadY - 4;
  };

  const inputsH = bulletHeight(d.inputs);
  const outputsH = bulletHeight(d.outputs);
  const ioH = Math.max(inputsH, outputsH);
  ensure(ioH + 18);

  const drawBulletCard = (xPos: number, label: string, items: string[], cardH: number) => {
    drawCard(xPos, y, colW, cardH, CARD, BORDER, 8);
    let cy = y + colPadY;
    drawLabel(label, xPos + colPadX, cy);
    cy += 14;
    for (const it of items) {
      const lines = wrapLines(`•  ${it}`, colInnerW - 6, 10, "helvetica", "normal");
      drawLines(lines, xPos + colPadX, cy - 10, 10, "helvetica", "normal", INK, 1.45);
      cy += lines.length * 10 * 1.45 + 4;
    }
  };
  drawBulletCard(margin, "Inputs", d.inputs, ioH);
  drawBulletCard(margin + colW + twoColGap, "Outputs", d.outputs, ioH);
  y += ioH + 22;

  // Procedure
  ensure(28);
  pdf.setFont("times", "normal");
  pdf.setFontSize(16);
  pdf.setTextColor(...INK);
  pdf.text(safe("Procedure"), margin, y + 14);
  y += 22;

  const stepPadX = 14;
  const stepPadY = 14;
  const badgeSize = 28;
  const stepGap = 10;
  const stepTextX = margin + stepPadX + badgeSize + 12;
  const stepTextW = contentW - stepPadX * 2 - badgeSize - 12;

  for (const s of d.steps) {
    const actionLines = wrapLines(s.action, stepTextW, 11, "helvetica", "bold");
    let stepH = stepPadY + actionLines.length * 11 * 1.3;
    let detailLines: string[] = [];
    if (s.detail?.trim()) {
      detailLines = wrapLines(s.detail.trim(), stepTextW, 9.5, "helvetica", "normal");
      stepH += 4 + detailLines.length * 9.5 * 1.5;
    }
    stepH += stepPadY;
    stepH = Math.max(stepH, badgeSize + stepPadY * 2);

    ensure(stepH + stepGap);
    drawCard(margin, y, contentW, stepH, CARD, BORDER, 8);
    pdf.setFillColor(...SIGNAL);
    pdf.rect(margin, y, 3, stepH, "F");
    pdf.setFillColor(...INK);
    pdf.roundedRect(margin + stepPadX, y + stepPadY, badgeSize, badgeSize, 5, 5, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(252, 251, 249);
    pdf.text(
      String(s.number),
      margin + stepPadX + badgeSize / 2,
      y + stepPadY + badgeSize / 2 + 4,
      { align: "center" },
    );

    let ty = y + stepPadY;
    drawLines(actionLines, stepTextX, ty - 11 + 2, 11, "helvetica", "bold", INK, 1.3);
    ty += actionLines.length * 11 * 1.3;
    if (detailLines.length) {
      ty += 4;
      drawLines(detailLines, stepTextX, ty - 9.5 + 2, 9.5, "helvetica", "normal", INK_MUTED, 1.5);
    }
    y += stepH + stepGap;
  }

  y += 8;

  // Control band
  const ctrlGap = 12;
  const ctrlColW = (contentW - ctrlGap * 2) / 3;
  const ctrlPadX = 12;
  const ctrlPadY = 14;
  const ctrlInnerW = ctrlColW - ctrlPadX * 2;

  type Block =
    | {
        kind: "para";
        size: number;
        family: "times" | "helvetica";
        style: "normal" | "bold";
        color: [number, number, number];
        lines: string[];
        lineHeight: number;
        gap: number;
      }
    | { kind: "kpi"; metric: string[]; target: string[] };

  const ddBlocks: Block[] = [
    {
      kind: "para",
      size: 10,
      family: "helvetica",
      style: "normal",
      color: INK,
      lines: wrapLines(d.definitionOfDone, ctrlInnerW, 10, "helvetica", "normal"),
      lineHeight: 1.5,
      gap: 0,
    },
  ];

  const kpiBlocks: Block[] = d.kpis.map((it) => {
    const cleaned = safe(it);
    const m = cleaned.match(/^(.*?)(?:\s*(?:->|:)\s*)(.+)$/);
    if (m) {
      return {
        kind: "kpi" as const,
        metric: wrapLines(m[1].trim(), ctrlInnerW, 9.5, "helvetica", "normal"),
        target: wrapLines(m[2].trim(), ctrlInnerW, 11, "helvetica", "bold"),
      };
    }
    return {
      kind: "para" as const,
      size: 10,
      family: "helvetica" as const,
      style: "normal" as const,
      color: INK,
      lines: wrapLines(`•  ${cleaned}`, ctrlInnerW, 10, "helvetica", "normal"),
      lineHeight: 1.45,
      gap: 4,
    };
  });

  const excBlocks: Block[] = d.exceptions.map((it) => ({
    kind: "para" as const,
    size: 9.5,
    family: "helvetica" as const,
    style: "normal" as const,
    color: INK,
    lines: wrapLines(`•  ${it}`, ctrlInnerW, 9.5, "helvetica", "normal"),
    lineHeight: 1.5,
    gap: 6,
  }));

  const measureBlocks = (blocks: Block[]) => {
    let h = ctrlPadY + 14;
    for (const b of blocks) {
      if (b.kind === "para") {
        h += b.lines.length * b.size * b.lineHeight + b.gap;
      } else {
        h += b.metric.length * 9.5 * 1.4 + 2;
        h += b.target.length * 11 * 1.2 + 8;
      }
    }
    return h + ctrlPadY - 4;
  };

  const ctrlH = Math.max(
    measureBlocks(ddBlocks),
    measureBlocks(kpiBlocks),
    measureBlocks(excBlocks),
  );

  ensure(ctrlH + 18);

  const drawCtrlPanel = (xPos: number, label: string, blocks: Block[]) => {
    drawCard(xPos, y, ctrlColW, ctrlH, CARD, BORDER, 8);
    let cy = y + ctrlPadY;
    drawLabel(label, xPos + ctrlPadX, cy);
    cy += 14;
    for (const b of blocks) {
      if (b.kind === "para") {
        drawLines(
          b.lines,
          xPos + ctrlPadX,
          cy - b.size,
          b.size,
          b.family,
          b.style,
          b.color,
          b.lineHeight,
        );
        cy += b.lines.length * b.size * b.lineHeight + b.gap;
      } else {
        drawLines(b.metric, xPos + ctrlPadX, cy - 9.5, 9.5, "helvetica", "normal", INK_MUTED, 1.4);
        cy += b.metric.length * 9.5 * 1.4 + 2;
        drawLines(b.target, xPos + ctrlPadX, cy - 11, 11, "helvetica", "bold", INK, 1.2);
        cy += b.target.length * 11 * 1.2 + 8;
      }
    }
  };

  drawCtrlPanel(margin, "Definition of done", ddBlocks);
  drawCtrlPanel(margin + ctrlColW + ctrlGap, "KPIs", kpiBlocks);
  drawCtrlPanel(margin + (ctrlColW + ctrlGap) * 2, "Exceptions / escalation", excBlocks);
  y += ctrlH + 16;

  // Revision
  ensure(28);
  pdf.setDrawColor(...DIVIDER);
  pdf.setLineWidth(0.5);
  pdf.line(margin, y, margin + contentW, y);
  y += 12;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...INK_MUTED);
  pdf.text(safe(`Revision cadence: ${d.revisionCadence}`), margin, y + 4);

  // Footer
  const pageCount = pdf.getNumberOfPages();
  const cadenceRaw = (d.revisionCadence || "").trim();
  const cadenceClean = cadenceRaw.replace(/^review\s+/i, "");
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.setCharSpace(0);
    pdf.setDrawColor(...DIVIDER);
    pdf.setLineWidth(0.4);
    pdf.line(margin, pageH - 26, pageW - margin, pageH - 26);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(...INK_FAINT);

    const rightText = safe(`Page ${i} of ${pageCount}  ·  v1  ·  Review ${cadenceClean}`);
    const rightW = pdf.getTextWidth(rightText);
    const gap = 16;
    const leftMax = Math.max(40, contentW - rightW - gap);

    const titleFull = safe(`AOS  ·  ${d.title}`);
    let titleOut = titleFull;
    if (pdf.getTextWidth(titleOut) > leftMax) {
      let lo = 0;
      let hi = titleOut.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        const candidate = titleOut.slice(0, mid).trimEnd() + "…";
        if (pdf.getTextWidth(candidate) <= leftMax) lo = mid;
        else hi = mid - 1;
      }
      titleOut = titleOut.slice(0, lo).trimEnd() + "…";
    }

    pdf.text(titleOut, margin, pageH - 14);
    pdf.text(rightText, pageW - margin, pageH - 14, { align: "right" });
  }
}
