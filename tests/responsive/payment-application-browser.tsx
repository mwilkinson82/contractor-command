// Isolated browser harness only. No real authentication, backend, documents or financial writes.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PaymentApplicationsPage } from "../../src/components/athena/PaymentApplicationsPage";
import { applicationFixture } from "../../src/lib/payment-applications/fixtures";
import { calculateApplication } from "../../src/lib/payment-applications/model";
import {
  emptyApplication,
  type ApplicationContext,
  type SavedApplication,
} from "../../src/lib/payment-applications/workflow";
export const fixtureJob = "00000000-0000-4000-8000-000000000001";
const seed = applicationFixture();
export const context = (): ApplicationContext => ({
  job: { number: "SYN-01", name: "Construction project" },
  currency: "USD",
  snapshot: seed.snapshot,
  evidence: [],
  applications: JSON.parse(sessionStorage.getItem("fixture-list") ?? "[]"),
  selected: null,
});
const search = Object.fromEntries(new URL(location.href).searchParams);
(window as any).__pa_calls = [];
export const fixtureRpc = async (_name: string, args: any) => {
  (window as any).__pa_calls.push(args);
  try {
    const p = args._p;
    if (args._action === "payment_application_read") {
      const c = context();
      if (p.id) {
        const saved = JSON.parse(sessionStorage.getItem(`fixture-saved:${p.id}`) ?? "null");
        if (!saved || (p.version && Number(p.version) !== saved.version))
          throw Error("Exact version unavailable");
        c.selected = saved;
      }
      return { data: c, error: null };
    }
    if (args._action === "payment_application_review") {
      const calc = calculateApplication(p.application);
      if (p.application.state !== "draft" && !calc.complete) throw Error("Needed inputs remain");
      const key = crypto.randomUUID();
      sessionStorage.setItem(`fixture-review:${key}`, JSON.stringify(p));
      return {
        data: {
          review_key: key,
          expires_at: "2026-12-01T12:00:00Z",
          payload: p,
          calculation: calc,
          billing_effect: "Saved application only; no issued billing.",
        },
        error: null,
      };
    }
    if (args._action === "payment_application_save") {
      const { review_key, ...payload } = p;
      if (sessionStorage.getItem(`fixture-review:${review_key}`) !== JSON.stringify(payload))
        throw Error("Review changed");
      const saved: SavedApplication = {
        application_id: p.id,
        version: p.expected_version + 1,
        latest_version: p.expected_version + 1,
        body: p.application,
        calculation: calculateApplication(p.application),
        billing_version: null,
        recorded_at: "2026-02-01T12:00:00Z",
        history: [
          {
            version: p.expected_version + 1,
            state: p.application.state,
            reason: p.application.reason,
            recorded_at: "2026-02-01T12:00:00Z",
          },
        ],
      };
      sessionStorage.setItem(`fixture-saved:${p.id}`, JSON.stringify(saved));
      sessionStorage.setItem(
        "fixture-list",
        JSON.stringify([
          {
            id: p.id,
            version: saved.version,
            number: p.application.number,
            state: p.application.state,
            period_start: p.application.period_start,
            period_end: p.application.period_end,
          },
        ]),
      );
      return { data: { id: p.id, version: saved.version }, error: null };
    }
    throw Error("Unsupported fixture action");
  } catch (e) {
    return { data: null, error: { message: (e as Error).message } };
  }
};
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <PaymentApplicationsPage jobId={fixtureJob} search={search} />
  </QueryClientProvider>,
);
