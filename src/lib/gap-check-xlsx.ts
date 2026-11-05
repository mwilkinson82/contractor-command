// The gap check as an Excel workbook: one row per gap, an Answer dropdown, a "still holds the bid"
// formula, totals, the gap check verdict, and the proposal qualifications on their own sheet.
import { buildXlsx, type XlsxCell, type XlsxSheet } from "./xlsx-writer";
import {
  COVERED_LABEL,
  columnOf,
  defaultQuestion,
  type Column,
  type GapCheckItem,
} from "./mcp/gap-check";

export const EXCEL_ANSWERS: Record<Exclude<Column, "to_answer">, string> = {
  carrying: "Carrying it",
  covered: "Covered elsewhere",
  understood: "Understood, qualified",
  rfi: "RFI before bid",
};

export function gapCheckSheets(input: {
  jobNumber: string;
  jobName: string | null;
  items: GapCheckItem[];
}): XlsxSheet[] {
  const live = input.items.filter((i) => columnOf(i) !== "dropped");
  const head: XlsxCell[] = [
    "Gap",
    "What Athena found",
    "Holds the bid",
    "Exposure low",
    "Exposure high",
    "Answer",
    "Carrying $",
    "Covered by, or note",
    "Proposal qualification",
    "RFI question",
    "Still holds the bid",
    "Question",
    "Sources",
  ].map((v) => ({ v, s: "head" as const }));
  const rows: XlsxCell[][] = [head];
  live.forEach((g, i) => {
    const r = i + 2;
    const col = columnOf(g);
    const a = g.answer;
    const covered =
      a?.answer === "covered"
        ? `${COVERED_LABEL[a.covered_by ?? "other"]}${a.note ? `: ${a.note}` : ""}`
        : (a?.note ?? (col === "covered" ? (g.verdict?.owner ?? "") : ""));
    rows.push([
      g.ref,
      { v: g.title, s: "wrap" },
      g.holds_bid ? { v: "Yes", s: "flag" } : "No",
      g.exposure_low == null ? null : { v: g.exposure_low, s: "money" },
      g.exposure_high == null ? null : { v: g.exposure_high, s: "money" },
      col === "to_answer" || col === "dropped" ? null : EXCEL_ANSWERS[col],
      a?.answer === "carrying" ? { v: a.amount ?? 0, s: "money" } : null,
      { v: covered, s: "wrap" },
      { v: a?.qualification ?? "", s: "wrap" },
      { v: a?.question ?? "", s: "wrap" },
      { f: `IF(AND(C${r}="Yes",OR(F${r}="",F${r}="${EXCEL_ANSWERS.rfi}")),"Yes","No")` },
      { v: g.question ?? defaultQuestion(g), s: "wrap" },
      { v: g.citations.join("; ") || `${g.sheet} · ${g.spec_section}`, s: "wrap" },
    ]);
  });
  const last = live.length + 1;
  const n = Math.max(last, 2);
  rows.push([]);
  rows.push([
    { v: "Totals", s: "total" },
    { v: `${live.length} gaps`, s: "total" },
    { f: `COUNTIF(C2:C${n},"Yes")`, s: "total" },
    { f: `SUMIF(F2:F${n},"",D2:D${n})`, s: "totalMoney" },
    { f: `SUMIF(F2:F${n},"",E2:E${n})`, s: "totalMoney" },
    { f: `COUNTA(F2:F${n})&" of ${live.length} answered"`, s: "total" },
    { f: `SUM(G2:G${n})`, s: "totalMoney" },
    { v: "", s: "total" },
    { v: "", s: "total" },
    { v: "", s: "total" },
    { f: `COUNTIF(K2:K${n},"Yes")`, s: "total" },
  ]);
  rows.push([
    { v: "Gap check", s: "total" },
    {
      f: `IF(AND(COUNTBLANK(F2:F${n})=0,COUNTIF(K2:K${n},"Yes")=0),"Met","Not met")`,
      s: "total",
    },
  ]);
  rows.push([
    null,
    {
      v: "Exposure totals count only unanswered gaps. Pick an answer from the dropdown in column F.",
      s: "wrap",
    },
  ]);
  const quals: XlsxCell[][] = [
    ["Gap", "Qualification for the proposal"].map((v) => ({ v, s: "head" as const })),
    ...live
      .filter((g) => g.answer?.answer === "understood")
      .map((g): XlsxCell[] => [g.ref, { v: g.answer?.qualification ?? g.answer?.note ?? "", s: "wrap" }]),
  ];
  if (quals.length === 1) quals.push([null, "No qualifications yet."]);
  return [
    {
      name: "Gap check",
      rows,
      widths: [8, 42, 12, 14, 14, 22, 14, 34, 34, 34, 16, 44, 40],
      freezeHeader: true,
      lists: live.length ? [{ range: `F2:F${last}`, source: "Lists!$A$1:$A$4" }] : [],
    },
    { name: "Proposal qualifications", rows: quals, widths: [8, 90], freezeHeader: true },
    {
      name: "Lists",
      hidden: true,
      rows: Object.values(EXCEL_ANSWERS).map((v) => [v]),
    },
  ];
}

export function gapCheckXlsx(input: Parameters<typeof gapCheckSheets>[0]): Uint8Array {
  return buildXlsx(gapCheckSheets(input));
}

export const gapCheckFileName = (jobNumber: string, jobName: string | null) =>
  `${[jobNumber, jobName].filter(Boolean).join(" ")} - Gap check.xlsx`.replace(/[\\/:*?"<>|]+/g, " ");
