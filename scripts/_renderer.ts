const INK: [number, number, number] = [26, 25, 24];
const INK_MUTED: [number, number, number] = [110, 105, 95];
const INK_FAINT: [number, number, number] = [159, 153, 141];
const SIGNAL: [number, number, number] = [228, 87, 61];
const CREAM: [number, number, number] = [244, 243, 239];
const PAPER_DEEP: [number, number, number] = [236, 235, 229];
const CARD: [number, number, number] = [252, 251, 249];
const BORDER: [number, number, number] = [209, 207, 199];
const DIVIDER: [number, number, number] = [226, 222, 214];

function renderSopToPdf(pdf: jsPDF, d: SopDocument): void {
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

  // Wrap text → array of lines, computing height. Uses a temporary font
  // state (caller is expected to reset font before drawing).
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
    pdf.setCharSpace(0);
    pdf.setFont(family, style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lh = size * lineHeight;
    lines.forEach((line, i) => {
      pdf.setCharSpace(0);
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
  };

  // ─── small-caps label (no charSpace — triggers a kerning leak in jsPDF's
  // bold helvetica that corrupts subsequent text() calls).
  const drawLabel = (text: string, x: number, baselineY: number, color = INK_FAINT) => {
    pdf.setCharSpace(0);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(...color);
    pdf.text(safe(text).toUpperCase(), x, baselineY);
  };

  // ============================ 1. HERO ============================
  // signal-orange rule at top
  pdf.setFillColor(...SIGNAL);
  pdf.rect(0, 0, pageW, 3, "F");

  // hero band (cream tint full-bleed top)
  const heroH = 132;
  pdf.setFillColor(...CREAM);
  pdf.rect(0, 3, pageW, heroH, "F");
  pdf.setDrawColor(...DIVIDER);
  pdf.setLineWidth(0.5);
  pdf.line(0, 3 + heroH, pageW, 3 + heroH);

  y = margin;
  drawLabel("Standard Operating Procedure", margin, y + 8, SIGNAL);
  y += 20;

  // Title — Times for Instrument-Serif feel
  const titleLines = wrapLines(d.title, contentW, 24, "times", "normal");
  const titleH = drawLines(titleLines, margin, y - 24 * 0.2, 24, "times", "normal", INK, 1.15);
  y += titleH;

  // Metadata row
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

  // jump past hero band
  y = 3 + heroH + 22;

  // ============================ 2. SUMMARY PANEL ============================
  const summaryItems: Array<[string, string]> = [
    ["Purpose", d.purpose],
    ["Scope", d.scope],
    ["Trigger", d.trigger],
  ];
  const summaryPadX = 18;
  const summaryPadY = 16;
  const summaryInnerW = contentW - summaryPadX * 2;

  // measure
  let summaryH = summaryPadY;
  for (const [, value] of summaryItems) {
    summaryH += 11; // label
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

  // ============================ 3. INPUTS / OUTPUTS (2-col) ============================
  const twoColGap = 14;
  const colW = (contentW - twoColGap) / 2;
  const colPadX = 14;
  const colPadY = 14;
  const colInnerW = colW - colPadX * 2;

  const bulletHeight = (items: string[]) => {
    let h = colPadY + 11 + 8; // label + gap
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

  // ============================ 4. PROCEDURE ============================
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
    // minimum height so badge has room
    stepH = Math.max(stepH, badgeSize + stepPadY * 2);

    ensure(stepH + stepGap);
    // card
    drawCard(margin, y, contentW, stepH, CARD, BORDER, 8);
    // signal-orange left rail
    pdf.setFillColor(...SIGNAL);
    pdf.rect(margin, y, 3, stepH, "F");
    // ink badge
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

  // ============================ 5. CONTROL BAND (3-col) ============================
  // Definition of Done · KPIs · Exceptions
  const ctrlGap = 12;
  const ctrlColW = (contentW - ctrlGap * 2) / 3;
  const ctrlPadX = 12;
  const ctrlPadY = 14;
  const ctrlInnerW = ctrlColW - ctrlPadX * 2;

  // Pre-render each panel's content lines to compute heights
  type Block =
    | { kind: "para"; size: number; family: "times" | "helvetica"; style: "normal" | "bold"; color: [number, number, number]; lines: string[]; lineHeight: number; gap: number }
    | { kind: "kpi"; metric: string[]; target: string[] };

  const ddBlocks: Block[] = [{
    kind: "para",
    size: 10,
    family: "helvetica",
    style: "normal",
    color: INK,
    lines: wrapLines(d.definitionOfDone, ctrlInnerW, 10, "helvetica", "normal"),
    lineHeight: 1.5,
    gap: 0,
  }];

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
    let h = ctrlPadY + 14; // label + gap
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
        drawLines(b.lines, xPos + ctrlPadX, cy - b.size, b.size, b.family, b.style, b.color, b.lineHeight);
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

  // ============================ 6. REVISION ============================
  ensure(28);
  pdf.setDrawColor(...DIVIDER);
  pdf.setLineWidth(0.5);
  pdf.line(margin, y, margin + contentW, y);
  y += 12;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...INK_MUTED);
  pdf.text(safe(`Revision cadence: ${d.revisionCadence}`), margin, y + 4);

  // ============================ FOOTER (every page) ============================
  const pageCount = pdf.getNumberOfPages();
  // Right side is always full text — clip title to fit remaining width.
  const titleSrc = `AOS  ·  ${d.title}`;
  const titleClipped =
    titleSrc.length > 38 ? titleSrc.slice(0, 36) + "…" : titleSrc;
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.setCharSpace(0);
    // hairline rule
    pdf.setDrawColor(...DIVIDER);
    pdf.setLineWidth(0.4);
    pdf.line(margin, pageH - 26, pageW - margin, pageH - 26);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(...INK_FAINT);
    pdf.text(safe(titleClipped), margin, pageH - 14);
    pdf.text(
      safe(`Page ${i} of ${pageCount}  ·  v1  ·  Review ${d.revisionCadence}`),
      pageW - margin,
      pageH - 14,
      { align: "right" },
    );
  }
}
export { renderSopToPdf };
