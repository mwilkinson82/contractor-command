// Isolated browser harness only. No real authentication, backend, documents or financial writes.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PaymentApplicationsPage } from "../../src/components/athena/PaymentApplicationsPage";
import { applicationFixture } from "../../src/lib/payment-applications/fixtures";
import { calculateApplication } from "../../src/lib/payment-applications/model";
import { deriveIntent } from "../../src/lib/payment-applications/working";
import {
  emptyApplication,
  type ApplicationContext,
  type SavedApplication,
} from "../../src/lib/payment-applications/workflow";
export const fixtureJob = "00000000-0000-4000-8000-000000000001";
const seed = applicationFixture();
export const context = (): ApplicationContext => {
  const applications = JSON.parse(sessionStorage.getItem("fixture-list") ?? "[]");
  const evidence = applications
    .filter((a: any) => ["submitted", "certified"].includes(a.state))
    .map((a: any) => {
      const saved = JSON.parse(sessionStorage.getItem(`fixture-saved:${a.id}`)!);
      return {
        id: a.id,
        version: saved.version,
        number: a.number,
        kind: "pay_application",
        status: a.state,
        invoice_date: saved.body.period_end,
        gross_cents: saved.calculation.billing_gross_cents,
        net_due_cents: saved.calculation.payment_due_cents,
        certified_cents: saved.body.certification?.amount_cents ?? null,
        credit_for: null,
      };
    });
  return {
    job: { number: "SYN-01", name: "Construction project" },
    currency: "USD",
    snapshot:
      new URL(location.href).searchParams.has("contract_missing") &&
      !sessionStorage.getItem("fixture-contract-basis")
        ? null
        : (JSON.parse(sessionStorage.getItem("fixture-current-sov") ?? "null") ?? seed.snapshot),
    snapshot_issue:
      new URL(location.href).searchParams.has("contract_missing") &&
      !sessionStorage.getItem("fixture-contract-basis")
        ? "Reconcile the saved SOV with the recorded approved contract and change orders."
        : null,
    evidence,
    applications,
    selected: null,
  };
};
const search = Object.fromEntries(new URL(location.href).searchParams);
if (
  new URL(location.href).searchParams.has("certificate_fixture") &&
  !sessionStorage.getItem("fixture-saved:00000000-0000-4000-8000-000000000002")
) {
  const original = applicationFixture();
  original.state = "submitted";
  const saved: SavedApplication = {
    application_id: "00000000-0000-4000-8000-000000000002",
    version: 1,
    latest_version: 1,
    body: original,
    calculation: calculateApplication(original),
    billing_version: 1,
    recorded_at: "2026-02-01T12:00:00Z",
    history: [{ version: 1, state: "submitted", recorded_at: "2026-02-01T12:00:00Z", reason: "" }],
  };
  sessionStorage.setItem(`fixture-saved:${saved.application_id}`, JSON.stringify(saved));
  sessionStorage.setItem(`fixture-version:${saved.application_id}:1`, JSON.stringify(saved));
  sessionStorage.setItem(
    "fixture-list",
    JSON.stringify([
      {
        id: saved.application_id,
        number: original.number,
        version: 1,
        state: "submitted",
        period_start: original.period_start,
        period_end: original.period_end,
      },
    ]),
  );
  seed.snapshot.contract_cents = 11000000;
  seed.snapshot.lines[0].scheduled_cents = 11000000;
  seed.snapshot.fingerprint = "changed-current-SOV";
  sessionStorage.setItem("fixture-current-sov", JSON.stringify(seed.snapshot));
}

(window as any).__pa_calls = [];
export const fixtureRpc = async (_name: string, args: any) => {
  (window as any).__pa_calls.push(args);
  try {
    const p = args._p;
    if (args._action.startsWith("contract_basis_")) {
      const stored = JSON.parse(sessionStorage.getItem("fixture-contract-basis") ?? "null");
      const version = sessionStorage.getItem("fixture-contract-version") ?? "missing-v0";
      if (args._action === "contract_basis_read")
        return {
          data: {
            version,
            original_cents:
              stored?.original_cents ??
              (new URL(location.href).searchParams.has("contract_missing")
                ? null
                : seed.snapshot.contract_cents),
            approved_cents: stored?.original_cents ?? null,
            change_cents: 0,
            sov_cents: seed.snapshot.contract_cents,
            basis: stored?.basis ?? null,
          },
          error: null,
        };
      const op = JSON.parse(
        sessionStorage.getItem(`fixture-contract-op:${p.request_id}`) ?? "null",
      );
      if (op) {
        if (op.payload !== JSON.stringify({ ...p, review_key: undefined }))
          throw Error("Operation belongs to different content");
        return { data: { ...op.result, applied: true, already_applied: true }, error: null };
      }
      if (args._action === "contract_basis_outcome")
        return { data: { applied: false }, error: null };
      if (p.expected_version !== version)
        throw Error("The contract or SOV changed. Reload the basis and review again.");
      if (p.original_cents !== seed.snapshot.contract_cents)
        throw Error("Reconcile the original contract and saved SOV.");
      if (args._action === "contract_basis_review") {
        const delay = Number(sessionStorage.getItem("fixture-contract-delay") ?? 0);
        if (delay) await new Promise((r) => setTimeout(r, delay));
        const key = crypto.randomUUID();
        sessionStorage.setItem(`fixture-contract-review:${key}`, JSON.stringify(p));
        return {
          data: {
            review_key: key,
            payload: p,
            approved_cents: p.original_cents,
            sov_cents: seed.snapshot.contract_cents,
            expires_at: "2026-12-01T12:00:00Z",
          },
          error: null,
        };
      }
      const { review_key, ...payload } = p;
      if (
        sessionStorage.getItem(`fixture-contract-review:${review_key}`) !== JSON.stringify(payload)
      )
        throw Error("Review expired or changed");
      sessionStorage.setItem("fixture-contract-basis", JSON.stringify(payload));
      sessionStorage.setItem("fixture-contract-version", crypto.randomUUID());
      const result = {
        saved: true,
        original_cents: p.original_cents,
        approved_cents: p.original_cents,
        basis: p.basis,
      };
      sessionStorage.setItem(
        `fixture-contract-op:${p.request_id}`,
        JSON.stringify({ payload: JSON.stringify(payload), result }),
      );
      if (sessionStorage.getItem("fixture-contract-lose-response")) {
        sessionStorage.removeItem("fixture-contract-lose-response");
        throw Error("Connection interrupted");
      }
      return { data: { ...result, applied: true }, error: null };
    }

    if (args._action === "payment_application_read") {
      if (p.id && p.version === undefined)
        await new Promise((r) =>
          setTimeout(r, Number(sessionStorage.getItem("fixture-predecessor-delay") ?? 0)),
        );
      const c = context();
      if (p.id) {
        const head = JSON.parse(sessionStorage.getItem(`fixture-saved:${p.id}`) ?? "null");
        const saved =
          p.version && Number(p.version) !== head?.version
            ? JSON.parse(sessionStorage.getItem(`fixture-version:${p.id}:${p.version}`) ?? "null")
            : head;
        if (!saved) throw Error("Exact version unavailable");
        c.selected = { ...saved, latest_version: head.version, history: head.history };
        c.evidence = c.evidence.filter((e) => e.id !== p.id);
      }
      return { data: c, error: null };
    }
    if (
      args._action === "payment_application_working" ||
      args._action === "payment_application_working_outcome"
    ) {
      const key = `fixture-working-op:${p.request_id}`;
      const op = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (op) {
        if (
          op.id !== p.id ||
          op.request_hash !== p.request_hash ||
          (args._action === "payment_application_working" && op.payload !== JSON.stringify(p))
        )
          throw Error("Draft request belongs to different content");
        return { data: { ...op.result, applied: true, already_applied: true }, error: null };
      }
      if (args._action === "payment_application_working_outcome")
        return { data: { applied: false }, error: null };
      const previous = JSON.parse(sessionStorage.getItem(`fixture-saved:${p.id}`) ?? "null");
      if ((previous?.version ?? 0) !== p.expected_version)
        throw Error("This draft changed in chat or the form.");
      if (p.operation === "save" && previous?.working_state === "cancelled")
        throw Error("Resume this draft first");
      if (p.operation !== "save" && !previous?.working_state) throw Error("Choose a working draft");
      const body = p.operation === "save" ? deriveIntent(p.application, p.intent) : previous.body;
      const working_intent = p.operation === "save" ? p.intent : previous.working_intent;
      const working_state = p.operation === "cancel" ? "cancelled" : "open";
      const version = p.expected_version + 1;
      const saved: SavedApplication = {
        application_id: p.id,
        version,
        latest_version: version,
        body,
        working_intent,
        working_state,
        calculation: calculateApplication(body, true),
        billing_version: null,
        recorded_at: "2026-02-01T12:00:00Z",
        history: [
          { version, state: "draft", reason: "", recorded_at: "2026-02-01T12:00:00Z" },
          ...(previous?.history ?? []),
        ],
      };
      sessionStorage.setItem(`fixture-saved:${p.id}`, JSON.stringify(saved));
      sessionStorage.setItem(`fixture-version:${p.id}:${version}`, JSON.stringify(saved));
      sessionStorage.setItem(
        "fixture-list",
        JSON.stringify([
          ...context().applications.filter((a) => a.id !== p.id),
          {
            id: p.id,
            version,
            number: body.number || "Working application",
            state: "draft",
            working_state,
            period_start: body.period_start,
            period_end: body.period_end,
          },
        ]),
      );
      const result = { id: p.id, version, working_state };
      sessionStorage.setItem(
        key,
        JSON.stringify({
          id: p.id,
          request_hash: p.request_hash,
          payload: JSON.stringify(p),
          result,
        }),
      );
      if (sessionStorage.getItem("fixture-working-lose-response")) {
        sessionStorage.removeItem("fixture-working-lose-response");
        throw Error("Connection interrupted");
      }
      return { data: { ...result, applied: true }, error: null };
    }
    if (args._action === "payment_application_outcome") {
      const op = JSON.parse(sessionStorage.getItem(`fixture-op:${p.request_id}`) ?? "null");
      if (!op) return { data: { applied: false }, error: null };
      const { review_key, ...payload } = p;
      if (op.payload !== JSON.stringify(payload))
        throw Error("Operation belongs to different content");
      return { data: { ...op.result, applied: true }, error: null };
    }
    if (args._action === "payment_application_review") {
      const existing = JSON.parse(sessionStorage.getItem(`fixture-saved:${p.id}`) ?? "null");
      if ((existing?.version ?? 0) !== p.expected_version) throw Error("Version changed");
      if (existing && !existing.working_state && existing.body.number !== p.application.number)
        throw Error("Keep the application number");
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
      const previous = JSON.parse(sessionStorage.getItem(`fixture-saved:${p.id}`) ?? "null");
      const saved: SavedApplication = {
        application_id: p.id,
        version: p.expected_version + 1,
        latest_version: p.expected_version + 1,
        body: p.application,
        calculation: calculateApplication(p.application),
        billing_version: ["submitted", "certified"].includes(p.application.state)
          ? (JSON.parse(sessionStorage.getItem(`fixture-saved:${p.id}`) ?? "null")
              ?.billing_version ?? 0) + 1
          : null,
        recorded_at: "2026-02-01T12:00:00Z",
        history: [
          {
            version: p.expected_version + 1,
            state: p.application.state,
            reason: p.application.reason,
            recorded_at: "2026-02-01T12:00:00Z",
          },
          ...(previous?.history ?? []),
        ],
      };
      sessionStorage.setItem(`fixture-saved:${p.id}`, JSON.stringify(saved));
      sessionStorage.setItem(`fixture-version:${p.id}:${saved.version}`, JSON.stringify(saved));
      sessionStorage.setItem(
        "fixture-list",
        JSON.stringify([
          ...context().applications.filter((a) => a.id !== p.id),
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
      sessionStorage.setItem(
        `fixture-op:${p.request_id}`,
        JSON.stringify({
          payload: JSON.stringify(payload),
          result: { id: p.id, version: saved.version },
        }),
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
