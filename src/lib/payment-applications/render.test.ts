import { beforeEach, describe, it, expect, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { applicationFixture } from "./fixtures";
import { calculateApplication } from "./model";
import { applicationPdf } from "./pdf";
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
