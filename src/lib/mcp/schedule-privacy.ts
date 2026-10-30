/** Mirror the bounded database projection for schedule-only field roles.
 * Private event narrative/source provenance stays available to full job roles. */
export function publicScheduleControl(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const control = structuredClone(raw) as Record<string, unknown>;
  if (control.analysis && typeof control.analysis === "object") {
    const analysis = control.analysis as Record<string, unknown>;
    for (const key of ["description", "source_refs", "assumptions", "before_activities"])
      delete analysis[key];
  }
  if (Array.isArray(control.baselines)) {
    for (const baseline of control.baselines) {
      if (!baseline || typeof baseline !== "object" || !Array.isArray(baseline.activities))
        continue;
      for (const activity of baseline.activities)
        for (const key of ["value", "billable_value", "actual_cost", "budget_cost"])
          delete activity[key];
    }
  }
  return control;
}
