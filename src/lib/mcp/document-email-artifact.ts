import { applicationPdf } from "../payment-applications/pdf";
import type { PaymentBrand } from "../payment-applications/brand";
import type { ApplicationContext } from "../payment-applications/workflow";

/** A private, exact-version attachment. No public share URL or persistent object is created. */
export type DocumentEmailArtifact = {
  kind: "payment_application";
  company_id: string;
  job_id: string;
  document_id: string;
  version: number;
  latest_version: number;
  filename: string;
  mime_type: "application/pdf";
  size_bytes: number;
  sha256: string;
  content_base64: string;
};

export async function paymentApplicationArtifact(input: {
  companyId: string; jobId: string; applicationId: string; version: number;
  allowHistorical: boolean; context: ApplicationContext; brand?: PaymentBrand;
}): Promise<DocumentEmailArtifact> {
  const s = input.context.selected;
  if (!s || s.application_id !== input.applicationId || s.version !== input.version)
    throw new Error("This exact payment application version is unavailable on this job.");
  if (s.working_state) throw new Error("Save the payment application before preparing its document.");
  if (!Number.isSafeInteger(s.latest_version) || s.latest_version < s.version)
    throw new Error("The current application version could not be verified.");
  if (s.version !== s.latest_version && !input.allowHistorical)
    throw new Error("A newer application version exists. Choose which version to send.");
  const bytes = applicationPdf(input.context.job, s, input.brand);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw new Error("The payment application document is empty or too large to attach.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  let binary = "";
  for (let n = 0; n < bytes.length; n += 8192)
    binary += String.fromCharCode(...bytes.subarray(n, n + 8192));
  return {
    kind: "payment_application", company_id: input.companyId, job_id: input.jobId,
    document_id: s.application_id, version: s.version, latest_version: s.latest_version,
    filename: `Payment-application-${s.body.number.replace(/[^a-zA-Z0-9_-]/g, "-")}-v${s.version}.pdf`,
    mime_type: "application/pdf", size_bytes: bytes.length,
    sha256: Array.from(digest, x => x.toString(16).padStart(2, "0")).join(""),
    content_base64: btoa(binary),
  };
}
