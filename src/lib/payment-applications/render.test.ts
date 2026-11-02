import { beforeEach, describe, it, expect, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { applicationFixture } from "./fixtures";
import { calculateApplication } from "./model";
import { applicationPdf } from "./pdf";
import { validatePaymentLogo } from "./brand";
import type { ApplicationContext, SavedApplication } from "./workflow";
const state = vi.hoisted(() => ({
  data: null as any,
  error: null as any,
  rpc: vi.fn(),
  signedIn: true,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    session: state.signedIn ? { user: { id: "isolated-fixture" } } : null,
    loading: false,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: state.data, error: state.error, isPending: false }),
}));
vi.mock("@/components/athena/BoardSignIn", () => ({
  BoardSignIn: ({ returnTo }: { returnTo: string }) =>
    h("a", { href: returnTo }, "Sign in to open this exact application"),
}));
import { PaymentApplicationsPage } from "@/components/athena/PaymentApplicationsPage";
const job = "00000000-0000-4000-8000-000000000001",
  id = "00000000-0000-4000-8000-000000000002";
function fixture(missing = false): ApplicationContext {
  const a = applicationFixture();
  a.state = missing ? "draft" : "submitted";
  if (missing) a.lines[0].work_cents = null;
  const saved: SavedApplication = {
    application_id: id,
    version: 2,
    latest_version: 2,
    body: a,
    calculation: calculateApplication(a),
    billing_version: missing ? null : 1,
    recorded_at: "2026-02-01T12:00:00Z",
    history: [
      {
        version: 2,
        state: a.state,
        recorded_at: "2026-02-01T12:00:00Z",
        reason: "Reviewed continuation",
      },
      { version: 1, state: "draft", recorded_at: "2026-01-31T12:00:00Z", reason: "" },
    ],
  };
  return {
    job: { number: "SYN-01", name: "Construction project" },
    currency: "USD",
    snapshot: a.snapshot,
    evidence: [],
    selected: saved,
    applications: [
      {
        id,
        number: a.number,
        version: 2,
        state: a.state,
        period_start: a.period_start,
        period_end: a.period_end,
      },
    ],
  };
}
beforeEach(() => {
  state.signedIn = true;
  state.data = fixture();
  state.error = null;
  state.rpc.mockClear();
});
describe("saved application view and document", () => {
  it("renders exact saved state and history without any read or write during rendering", () => {
    const html = renderToStaticMarkup(
      h(PaymentApplicationsPage, { jobId: job, search: { application_id: id, version: 2 } }),
    );
    expect(html).toContain("Current requested payment");
    expect(html).toContain("$13,500.00");
    expect(html).toContain("Download saved PDF");
    expect(html).toContain("version=1");
    expect(html).not.toContain("review_key");
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("keeps incomplete totals Needed and rejects an invalid target without showing another record", () => {
    state.data = fixture(true);
    const html = renderToStaticMarkup(
      h(PaymentApplicationsPage, { jobId: job, search: { application_id: id, version: 2 } }),
    );
    expect(html).toContain("Incomplete draft");
    expect(html).toContain("Needed");
    const invalid = renderToStaticMarkup(
      h(PaymentApplicationsPage, { jobId: job, search: { version: 2 } }),
    );
    expect(invalid).toContain("No other application was substituted");
    expect(invalid).not.toContain("Construction work");
  });
  it("preserves the exact document destination at sign-in", () => {
    state.signedIn = false;
    expect(
      renderToStaticMarkup(
        h(PaymentApplicationsPage, {
          jobId: job,
          search: { application_id: id, version: 2, download: "pdf" },
        }),
      ),
    ).toContain(`application_id=${id}&amp;version=2&amp;download=pdf`);
  });
  it("creates a stable PDF from the saved snapshot, not today’s forecast", () => {
    const f = fixture();
    const bytes = applicationPdf(f.job, f.selected!);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes).toEqual(applicationPdf(f.job, f.selected!));
  });
  it("renders an original branded application and paginated continuation without inventing unknown inputs", () => {
    const f = fixture();
    const a = f.selected!.body;
    a.snapshot.lines = Array.from({ length: 40 }, (_, i) => ({
      item: String(i + 1).padStart(2, "0"), description: `Work package ${i + 1}`,
      scheduled_cents: 250000,
    }));
    a.lines = a.snapshot.lines.map((s) => ({ ...a.lines[0], item: s.item, work_cents: 100000, stored_cents: 50000 }));
    f.selected!.calculation = calculateApplication(a);
    const bytes = applicationPdf(f.job, f.selected!, { companyName: "Example Builders" });
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).toContain("Example Builders");
    expect(raw).toContain("CONTINUATION SCHEDULE");
    expect(raw).toContain("CARRIED FORWARD");
    expect(raw).toContain("BROUGHT FORWARD");
    expect(raw).toContain("Not provided");
    expect(raw).toContain("not an AIA contract document");
    const dir = process.env.ATHENA_PAYMENT_APP_ARTIFACTS;
    if (dir) writeFileSync(`${dir}/multipage.pdf`, bytes);
  });
  it("prints saved application values and retains zero, unknown, and original contract distinctions", () => {
    const f = fixture(), a = f.selected!.body;
    a.snapshot.contract_cents = 48000000;
    a.snapshot.provenance.contract_fact = { value: 480000 };
    const schedule = [3000000, 22000000, 15000000, 6000000, 2000000];
    const prior = [3000000, 1800000, 0, 0, 0], work = [3000000, 4800000, 1500000, 700000, 0];
    a.snapshot.lines = schedule.map((scheduled_cents, i) => ({item: String(i+1), description: `Scope ${i+1}`, scheduled_cents}));
    a.lines = a.snapshot.lines.map((s,i) => ({...a.lines[0], item:s.item, prior_work_cents:prior[i], work_cents:work[i],
      prior_stored_cents:0, prior_retained_cents:[200000,180000,0,0,0][i], stored_cents:0, stored_to_work_cents:0,
      work_retainage_bps:1000, stored_retainage_bps:1000, release_cents:i===0?100000:0,
      release_basis:i===0?"Reviewed release":"", stored_basis:"" }));
    a.prior_mode = "external"; a.prior_certified_net_cents = 4420000;
    f.selected!.calculation = calculateApplication(a);
    expect(f.selected!.calculation.payment_due_cents).toBe(4680000);
    const raw=Buffer.from(applicationPdf(f.job,f.selected!,{companyName:"Example Builders"})).toString("latin1");
    expect(raw).toContain("$46,800.00");
    expect(raw).toContain("$480,000.00");
    expect(raw).toContain("$30,000.00");
    const dir=process.env.ATHENA_PAYMENT_APP_ARTIFACTS;
    if(dir) writeFileSync(`${dir}/payment-summary.pdf`,applicationPdf(f.job,f.selected!,{companyName:"Example Builders"}));
  });
  it("embeds a supplied company logo and preserves missing work as Needed", () => {
    const f=fixture();
    f.selected!.body.lines[0].work_cents=null;
    f.selected!.calculation=calculateApplication(f.selected!.body);
    const logo = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==", "base64"));
    const raw=Buffer.from(applicationPdf(f.job,f.selected!,{companyName:"Example Builders",logo,logoFormat:"PNG"})).toString("latin1");
    expect(raw).toContain("/Subtype /Image");
    expect(raw).toContain("Example Builders");
    expect(raw).toContain("Needed");
  });
  it("embeds validated PNG and JPEG bytes in the generated application PDF", async () => {
    const f=fixture();
    const logos=[
      Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==", "base64")),
      new Uint8Array(readFileSync("tests/fixtures/payment-brand/logo.jpg")),
    ];
    for (const logo of logos) {
      const logoFormat=await validatePaymentLogo(logo);
      expect(logoFormat).not.toBeNull();
      const raw=Buffer.from(applicationPdf(f.job,f.selected!,{companyName:"Example Builders",logo,logoFormat:logoFormat!})).toString("latin1");
      expect(raw).toContain("/Subtype /Image");
    }
  });
  it("paginates every line of a maximum-length description and rejects unsupported characters", () => {
    const f=fixture(), a=f.selected!.body;
    const description=Array.from({length:100},(_,i)=>`L${String(i).padStart(3,"0")}`).join("\n");
    a.snapshot.lines[0].description=description;
    f.selected!.calculation=calculateApplication(a);
    const bytes=applicationPdf(f.job,f.selected!,{companyName:"Construção São José"});
    const raw=Buffer.from(bytes).toString("latin1");
    for(let i=0;i<100;i++) expect(raw).toContain(`(L${String(i).padStart(3,"0")})`);
    expect(raw).toContain("CARRIED FORWARD");
    expect(raw.split("(CARRIED FORWARD)")[1].split("(BROUGHT FORWARD)")[0]).toContain("($100,000.00)");
    expect(()=>applicationPdf(f.job,f.selected!,{companyName:"建設"})).toThrow(/cannot yet display/);
    const dir=process.env.ATHENA_PAYMENT_APP_ARTIFACTS;
    if(dir) writeFileSync(`${dir}/long-description.pdf`,bytes);
  });
  it("retains long unbroken descriptions and long company and project names", () => {
    const f=fixture(), a=f.selected!.body;
    a.snapshot.lines[0].description="W".repeat(500);
    f.selected!.calculation=calculateApplication(a);
    const bytes=applicationPdf({number:"01",name:"Project ".repeat(60)},f.selected!,{companyName:"Company ".repeat(30)});
    const raw=Buffer.from(bytes).toString("latin1");
    const pieces=[...raw.matchAll(/\((W+)\) Tj/g)].map(m=>m[1].length);
    expect(pieces.reduce((n,x)=>n+x,0)).toBe(500);
    expect(raw).toContain("ADDITIONAL APPLICATION DETAILS");
  });
  it("exports private rendered fixtures when explicitly requested", () => {
    const dir = process.env.ATHENA_PAYMENT_APP_ARTIFACTS;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const css =
      readFileSync("src/components/athena/payment-applications.css", "utf8") +
      readFileSync("src/components/athena/accounting-workspace.css", "utf8");
    for (const missing of [false, true]) {
      state.data = fixture(missing);
      const body = renderToStaticMarkup(
        h(PaymentApplicationsPage, { jobId: job, search: { application_id: id, version: 2 } }),
      );
      writeFileSync(
        `${dir}/${missing ? "incomplete" : "saved"}.html`,
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,sans-serif}${css}</style></head><body>${body}</body></html>`,
      );
      writeFileSync(
        `${dir}/${missing ? "incomplete" : "saved"}.pdf`,
        applicationPdf(state.data.job, state.data.selected),
      );
    }
    const multi = fixture();
    const a = multi.selected!.body;
    a.snapshot.lines = Array.from({ length: 5 }, (_, i) => ({
      item: String(i + 1).padStart(2, "0"),
      description: `Construction work ${i + 1}`,
      scheduled_cents: 2000000,
    }));
    a.lines = a.snapshot.lines.map((s) => ({ ...a.lines[0], item: s.item }));
    multi.selected!.calculation = calculateApplication(a);
    writeFileSync(`${dir}/continuation.pdf`, applicationPdf(multi.job, multi.selected!));
    writeFileSync(
      `${dir}/embedded.html`,
      '<!doctype html><html><body style="margin:0"><div style="width:600px;margin-left:auto"><iframe title="Payment application" src="saved.html" style="width:600px;height:1000px;border:0"></iframe></div></body></html>',
    );
  });
});

describe("frozen certificate action", () => {
  it("offers a certificate-only action after a current SOV change", () => {
    state.data = fixture();
    state.data.snapshot = {
      ...state.data.snapshot,
      fingerprint: "new-source",
      contract_cents: 11000000,
    };
    const html = renderToStaticMarkup(
      h(PaymentApplicationsPage, { jobId: job, search: { application_id: id, version: 2 } }),
    );
    expect(html).toContain("Record actual certificate");
    expect(html).toContain("current SOV source differs");
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("financial read failure", () => {
  it("hides retained financial results after an authorization error", () => {
    state.data = fixture();
    state.error = Error("Billing evidence requires full project access.");
    const html = renderToStaticMarkup(
      h(PaymentApplicationsPage, { jobId: job, search: { application_id: id, version: 2 } }),
    );
    expect(html).toContain("full project access");
    expect(html).not.toContain("$13,500.00");
    expect(html).not.toContain("Download saved PDF");
  });
});
