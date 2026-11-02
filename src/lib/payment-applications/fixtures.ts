// Isolated test/development inputs. Never used to populate a project.
import type { Application } from "./model";
export function applicationFixture(): Application {
  return {
    number: "Application 1",
    period_start: "2026-01-01",
    period_end: "2026-01-31",
    prior_cutoff: "2025-12-31",
    state: "draft",
    source: "Reviewed progress record",
    reason: "",
    retainage_basis: "Contract: ten percent on work and eligible stored materials",
    prior_mode: "first",
    prior_application: null,
    prior_certified_net_cents: 0,
    prior_basis: "First application; no prior work, storage or certificates",
    certification: null,
    evidence: [],
    snapshot: {
      fingerprint: "fixture",
      contract_cents: 10000000,
      lines: [{ item: "01", description: "Construction work", scheduled_cents: 10000000 }],
    },
    lines: [
      {
        item: "01",
        prior_work_cents: 0,
        prior_stored_cents: 0,
        prior_retained_cents: 0,
        work_cents: 1000000,
        stored_cents: 500000,
        stored_to_work_cents: 0,
        work_retainage_bps: 1000,
        stored_retainage_bps: 1000,
        release_cents: 0,
        stored_basis: "Eligible materials inventory and title evidence",
        release_basis: "",
      },
    ],
  };
}
