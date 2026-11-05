import { jsPDF } from "jspdf";
import { appMoney } from "./model";
import type { SavedApplication } from "./workflow";
import { drawPoweredByAthena } from "../client-brand";

type Brand = { companyName?: string; logo?: Uint8Array; logoFormat?: "PNG" | "JPEG" };
/** Original payment application and schedule; not an AIA licensed form. */
export function applicationPdf(job: { number: string; name: string }, saved: SavedApplication, brand: Brand = {}): Uint8Array {
  const d = new jsPDF({ unit: "pt", format: "letter", compress: false });
  const a = saved.body, c = saved.calculation;
  d.setCreationDate(new Date(saved.recorded_at));
  d.setFileId(saved.application_id.replaceAll("-", ""));
  d.setProperties({ title: `Payment application ${a.number} version ${saved.version}`, author: brand.companyName || "Payment application" });
  const clean = (s: string) => {
    // jsPDF's built-in Helvetica uses WinAnsi, which includes the common
    // typographic punctuation below in addition to Latin-1. Normalize
    // decomposed accents before checking so names render without data loss.
    s = s.replace(/\r\n?/g, "\n").normalize("NFC");
    if (/[^\x20-\x7E\xA0-\xFF\n\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]/.test(s))
      throw new Error("This PDF cannot yet display some characters in the supplied name or description. No document was generated.");
    return s;
  };
  const text = (s: string, x: number, y: number, size = 9, bold = false, options?: { align: "right" | "left" }) => {
    d.setFont("helvetica", bold ? "bold" : "normal"); d.setFontSize(size); d.setTextColor(25, 35, 48);
    d.text(clean(s), x, y, options);
  };
  const clip = (s: string, width: number, size: number, bold = false) => {
    d.setFont("helvetica", bold ? "bold" : "normal"); d.setFontSize(size);
    return d.splitTextToSize(clean(s || " "), width) as string[];
  };
  const rule = (x1:number,y1:number,x2:number,y2:number) => { d.setDrawColor(155,165,175); d.setLineWidth(.45); d.line(x1,y1,x2,y2); };
  const value = (v: number | null | undefined) => appMoney(v ?? null);
  let logoWidth = 0;
  if (brand.logo && brand.logoFormat) {
    try {
      const image = d.getImageProperties(brand.logo);
      const scale = Math.min(75 / image.width, 38 / image.height);
      d.addImage(brand.logo, brand.logoFormat, 40, 54 - image.height * scale / 2, image.width * scale, image.height * scale, undefined, "FAST");
      logoWidth = image.width * scale;
    } catch { /* use company-name fallback */ }
  }
  const overflow: [string,string][] = [];
  const company = brand.companyName || "Contractor: not provided";
  const companyX = logoWidth > 0 ? 40 + logoWidth + 10 : 40;
  // The right-hand application reference can extend left to 327pt.
  // Keep the brand within 315pt, and center its text in the logo's 38pt band.
  const companyLines = clip(company, Math.min(220, 315 - companyX), 11, true);
  if(companyLines.length > 2) overflow.push(["Contractor", company]);
  const visibleCompanyLines = companyLines.slice(0,2);
  const companyY = logoWidth > 0 ? 54 + 11 * 0.35 - (visibleCompanyLines.length - 1) * 13 / 2 : 45;
  visibleCompanyLines.forEach((t,i)=>text(t,companyX,companyY+i*13,11,true));
  text("PAYMENT APPLICATION", 572, 45, 16, true, {align:"right"});
  const appHeading = `${a.number}  |  Version ${saved.version}  |  ${a.state.toUpperCase()}`;
  const appLines = clip(appHeading, 245, 8, true);
  if(appLines.length > 2) overflow.push(["Application", appHeading]);
  appLines.slice(0,2).forEach((t,i)=>text(t,572,58+i*10,8,true,{align:"right"}));
  rule(40,80,572,80);
  const field = (label:string, val:string, x:number,y:number,w:number) => {
    text(label.toUpperCase(),x,y,7,true); const all=clip(val || "Not provided", w, 9);
    if(all.length>2) overflow.push([label,val]);
    all.slice(0,2).forEach((line,i)=>text(line,x,y+14+i*11,9));
  };
  field("Project", `${job.number} - ${job.name}`,40,99,245);
  field("Application period", `${a.period_start} to ${a.period_end}`,315,99,257);
  field("Owner", "Not provided",40,140,245);
  field("General contractor / recipient", "Not provided",315,140,257);
  field("Architect / reviewer", "Not provided",40,181,245);
  field("Prior certificate cutoff", a.prior_cutoff,315,181,257);
  rule(40,214,572,214);
  text("CONTRACT AND PAYMENT SUMMARY",40,232,10,true);
  const rawOriginal = a.snapshot.provenance.contract_fact?.value;
  const original = typeof rawOriginal === "number" && Number.isFinite(rawOriginal) && Math.abs(rawOriginal * 100 - Math.round(rawOriginal * 100)) < 0.000001 && Number.isSafeInteger(Math.round(rawOriginal * 100)) ? Math.round(rawOriginal * 100) : null;
  const netChange = original === null ? null : c.contract_cents - original;
  const summary: [string,number|null][] = [
    ["Original contract",original], ["Net approved contract changes",netChange], ["Contract sum to date",c.contract_cents],
    ["Completed work and stored materials",c.gross_cents], ["Less retainage held",c.retained_cents],
    ["Earned less retainage",c.earned_net_cents], ["Less previous actual certificates",c.prior_certified_net_cents],
    ["CURRENT PAYMENT REQUEST",c.payment_due_cents], ["Balance including retainage",c.balance_including_retainage_cents],
  ];
  summary.forEach(([label,v],i)=>{ const yy=248+i*23; if(i===7){d.setFillColor(239,243,247);d.rect(40,yy-12,532,21,"F");} text(label,47,yy,9,i===7); text(value(v),565,yy,9,i===7,{align:"right"}); rule(40,yy+7,572,yy+7); });
  if (!c.complete) text("INCOMPLETE - review needed inputs before issuing.",40,475,9,true);
  text("CONTRACTOR REVIEW",40,503,9,true); text("CERTIFICATE / REVIEWER",315,503,9,true);
  text("Signature",40,542,8); rule(90,539,265,539); text("Date",40,568,8); rule(90,565,265,565);
  text("Certified amount",315,530,8); rule(402,527,572,527); text("Signature",315,555,8); rule(402,552,572,552); text("Date",315,580,8); rule(402,577,572,577);
  text("Signatures and certification are blank unless completed by the responsible parties.",40,607,8);
  text("Original application and continuation schedule; not an AIA contract document.",40,625,8);
  d.addPage("letter","landscape");
  const xs = [24,53,208,278,347,416,485,554,592,662,730,768];
  const widths = xs.slice(1).map((x,i)=>x-xs[i]);
  const headers = ["ITEM","DESCRIPTION","SCHEDULED","PRIOR WORK","THIS PERIOD","STORED NOW","WORK + STORED","%","BALANCE","RETAINAGE"," "];
  const scheduleHeading = `${job.number} | ${a.number} | ${a.period_end} | v${saved.version}`;
  const scheduleHeadingLines = clip(scheduleHeading, 380, 8, true);
  if(scheduleHeadingLines.length > 1) overflow.push(["Schedule reference", scheduleHeading]);
  let y=0;
  function head() {
    text("CONTINUATION SCHEDULE",24,30,14,true); text(scheduleHeadingLines[0],768,30,8,true,{align:"right"});
    text(clip(company,400,9,true)[0],24,46,9,true);
    y=58; d.setFillColor(232,237,242); d.rect(24,y,744,26,"F");
    headers.slice(0,-1).forEach((h,i)=>{const lines=clip(h,widths[i]-6,7,true); lines.forEach((t,j)=>text(t,xs[i]+3,y+10+j*9,7,true));});
    y+=26; rule(24,y,768,y);
  }
  head();
  type Row = (typeof c.rows)[number];
  const priorRows: Row[] = [];
  const total = (rows: Row[], key: "scheduled_cents" | "prior_work_cents" | "this_period_work_cents" | "stored_cents" | "gross_cents" | "balance_cents" | "retained_cents") =>
    rows.some(r => r[key] === null) ? null : rows.reduce((n,r)=>n+(r[key] ?? 0),0);
  function subtotal(label: string) {
    text(label,xs[1]+3,y+15,7,true);
    const keys = ["scheduled_cents","prior_work_cents","this_period_work_cents","stored_cents","gross_cents",null,"balance_cents","retained_cents"] as const;
    keys.forEach((key,j)=>{ if(key) text(value(total(priorRows,key)),xs[j+3]-4,y+15,7,true,{align:"right"}); });
    y+=23; rule(24,y,768,y);
  }
  for (const row of c.rows) {
    const cells=[row.item,row.description,value(row.scheduled_cents),value(row.prior_work_cents),value(row.this_period_work_cents),value(row.stored_cents),value(row.gross_cents),row.gross_cents===null?"Needed":row.scheduled_cents===0?"N/A":`${(row.gross_cents/row.scheduled_cents*100).toFixed(1)}%`,value(row.balance_cents),value(row.retained_cents)];
    const lines=cells.map((v,i)=>clip(v,widths[i]-7,8,i===0));
    const count=Math.max(...lines.map(ls=>ls.length));
    let start=0;
    while(start<count){
      let available=Math.floor((520-y-8)/10);
      if(available<1){ subtotal("CARRIED FORWARD"); d.addPage("letter","landscape"); head(); subtotal("BROUGHT FORWARD"); available=Math.floor((520-y-8)/10); }
      const take=Math.min(available,count-start), h=Math.max(24,take*10+8);
      if(start>0) text("cont.",xs[0]+3,y+13,7,true);
      lines.forEach((ls,i)=>ls.slice(start,start+take).forEach((t,j)=>text(t,i>=2?xs[i+1]-4:xs[i]+3,y+13+j*10,8,i===0,i>=2?{align:"right"}:undefined)));
      if(start===0) priorRows.push(row);
      y+=h; rule(24,y,768,y); start+=take;
      if(start<count){ subtotal("CARRIED FORWARD"); d.addPage("letter","landscape"); head(); subtotal("BROUGHT FORWARD"); }
    }
  }
  if(y+34>550){subtotal("CARRIED FORWARD");d.addPage("letter","landscape");head();}
  subtotal("TOTAL");
  if (a.certification || overflow.length) {
    d.addPage("letter", "portrait"); let yy=45;
    text("ADDITIONAL APPLICATION DETAILS",40,yy,13,true); yy+=22;
    const entries: [string,string][] = [...overflow];
    if(a.certification) entries.push(["Recorded certificate", `${value(a.certification.amount_cents)} | ${a.certification.date} | ${a.certification.source}`]);
    for(const [label, detail] of entries){
      const lines=clip(`${label}: ${detail}`,532,9);
      for(const line of lines){if(yy>750){d.addPage("letter","portrait");yy=45;}text(line,40,yy,9);yy+=13;} yy+=8;
    }
  }
  const pages=d.getNumberOfPages();
  for(let i=1;i<=pages;i++){d.setPage(i);const w=d.internal.pageSize.getWidth(), h=d.internal.pageSize.getHeight();text(clip(`${a.number} | v${saved.version} | ${i} / ${pages}`,w-200,7)[0],24,h-20,7);drawPoweredByAthena(d,w-24,h-20);}
  return new Uint8Array(d.output("arraybuffer"));
}
