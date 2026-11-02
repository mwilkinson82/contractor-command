import { jsPDF } from "jspdf";
import { appMoney } from "./model";
import type { SavedApplication } from "./workflow";
/** Reproducible from the exact saved snapshot. This is Athena's own report, not a proprietary form. */
export function applicationPdf(
  job: { number: string; name: string },
  saved: SavedApplication,
): Uint8Array {
  const d = new jsPDF({ unit: "pt", format: "letter" });
  d.setCreationDate(new Date(saved.recorded_at));
  d.setFileId(saved.application_id.replaceAll("-", ""));
  d.setProperties({
    title: `Athena payment application ${saved.body.number} version ${saved.version}`,
    author: "Athena",
  });
  const a = saved.body,
    c = saved.calculation;
  let y = 42;
  const clean = (s: string) => s.replace(/[^\x20-\x7E\n]/g, " ");
  function line(s: string, size = 10, bold = false) {
    d.setFont("helvetica", bold ? "bold" : "normal");
    d.setFontSize(size);
    d.setTextColor(30, 58, 95);
    const parts = d.splitTextToSize(clean(s), 520) as string[];
    for (const p of parts) {
      if (y > 735) {
        d.addPage();
        y = 42;
      }
      d.text(p, 40, y);
      y += size + 5;
    }
  }
  line("ATHENA", 14, true);
  line("Payment application", 22, true);
  line(`${a.number} | ${a.state.toUpperCase()} | Saved version ${saved.version}`, 12, true);
  line(`Project ${job.number} - ${job.name}`);
  line(`Period: ${a.period_start} through ${a.period_end} | Prior cutoff: ${a.prior_cutoff}`);
  line("USD | Athena application and continuation schedule. Not an official proprietary form.");
  if (!c.complete)
    line("INCOMPLETE - Needed inputs below. This draft is not issued billing.", 11, true);
  for (const [label, value] of [
    ["Contract", c.contract_cents],
    ["Completed work and stored materials", c.gross_cents],
    ["Retainage held", c.retained_cents],
    ["Earned less retainage", c.earned_net_cents],
    ["Previous actual certificates", c.prior_certified_net_cents],
    ["Current requested payment", c.payment_due_cents],
    ["Unperformed contract remainder", c.unearned_cents],
    ["Balance including retainage", c.balance_including_retainage_cents],
  ] as const)
    line(`${label}: ${appMoney(value)}`, 11, label === "Current requested payment");
  line(`Prior basis: ${a.prior_basis || "Needed"}`);
  line(`Retainage terms: ${a.retainage_basis || "Needed"}`);
  line(`Source: ${a.source}`);
  if (a.certification)
    line(
      `Actual certificate: ${appMoney(a.certification.amount_cents)}, ${a.certification.date}. ${a.certification.source}`,
    );
  for (const issue of c.issues) line(`Needed: ${issue}`);
  for (const r of c.rows) {
    const paragraphs: [string, number, boolean][] = [
      [`${r.item} - ${r.description}`, 12, true],
      [
        `Scheduled ${appMoney(r.scheduled_cents)} | Prior installed ${appMoney(r.prior_work_cents)} | Prior stored ${appMoney(r.prior_stored_cents)} | Prior retained ${appMoney(r.prior_retained_cents)}`,
        10,
        false,
      ],
      [
        `Cumulative installed ${appMoney(r.work_cents)} | Work this period ${appMoney(r.this_period_work_cents)} | Currently stored ${appMoney(r.stored_cents)} | Transferred from prior storage ${appMoney(r.stored_to_work_cents)}`,
        10,
        false,
      ],
      [
        `Completed/stored ${appMoney(r.gross_cents)} | Retained ${appMoney(r.retained_cents)} | Unearned ${appMoney(r.balance_cents)}`,
        10,
        false,
      ],
      [
        `Retainage: work ${r.work_retainage_bps === null ? "Needed" : r.work_retainage_bps / 100 + "%"}; stored ${r.stored_retainage_bps === null ? "Needed" : r.stored_retainage_bps / 100 + "%"}. Cumulative approved release ${appMoney(r.release_cents)}.`,
        10,
        false,
      ],
      ...(r.stored_basis
        ? [[`Stored source: ${r.stored_basis}`, 10, false] as [string, number, boolean]]
        : []),
      ...(r.release_basis
        ? [[`Release basis: ${r.release_basis}`, 10, false] as [string, number, boolean]]
        : []),
    ];
    const height = paragraphs.reduce((n, [text, size, bold]) => {
      d.setFont("helvetica", bold ? "bold" : "normal");
      d.setFontSize(size);
      return n + (d.splitTextToSize(clean(text), 520) as string[]).length * (size + 5);
    }, 12);
    if (height < 620 && y + height > 735) {
      d.addPage();
      y = 42;
      line("ATHENA - Payment application continuation", 14, true);
      line(`${a.number} | version ${saved.version} | ${job.number}`);
    }
    y += 12;
    for (const [text, size, bold] of paragraphs) line(text, size, bold);
  }
  y += 12;
  line("Billing reconciliation", 12, true);
  for (const e of a.evidence)
    line(
      `${c.evidence?.find((b) => b.id === e.id)?.number ?? (e.treatment === "prior_billing" ? "Prior billing" : "Separate evidence")} - version ${e.version}: ${e.reason}`,
    );
  line(`SOV provenance fingerprint: ${a.snapshot.fingerprint}`);
  line(`Saved: ${saved.recorded_at}`);
  if (a.reason) line(`Revision: ${a.reason}`);
  line("No bank transfer or external certification is performed by this report.");
  const count = d.getNumberOfPages();
  for (let i = 1; i <= count; i++) {
    d.setPage(i);
    d.setFontSize(8);
    d.setTextColor(107, 114, 128);
    d.text(`Athena | ${clean(a.number)} | v${saved.version} | ${i} / ${count}`, 40, 770);
  }
  return new Uint8Array(d.output("arraybuffer"));
}
