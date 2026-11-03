import type { DocumentEmailArtifact } from "./document-email-artifact";

export type Attachment = Omit<DocumentEmailArtifact, "content_base64" | "latest_version">;
export type ReviewedEmail = {
  company_id: string; job_id: string; from: string; to: string; cc: string[];
  subject: string; body: string; attachment: Attachment;
};
export type ProviderReceipt = { provider: string; message_id: string; sent_at: string };
export type DeliveryState = "reviewed" | "sending" | "sent" | "uncertain";
export type Delivery = { id: string; actor_id: string; email: ReviewedEmail; review_hash: string; state: DeliveryState; receipt: ProviderReceipt | null };
/** Implementations MUST atomically compare the actor, hash and state in claim, across processes.
 * finish and uncertain MUST compare the same actor/hash and transition only from sending; a recorded receipt must never be overwritten. This interface alone is not durable; no production repository or migration is provided here. */
export interface DeliveryRepository {
  claim(id: string, actorId: string, reviewHash: string): Promise<"claimed" | "sent" | "pending" | "mismatch">;
  get(id: string, actorId: string): Promise<Delivery | null>;
  finish(id: string, actorId: string, reviewHash: string, receipt: ProviderReceipt): Promise<void>;
  uncertain(id: string, actorId: string, reviewHash: string): Promise<void>;
}
const utf8 = new TextEncoder();
async function sha(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), n => n.toString(16).padStart(2,"0")).join("");
}
const emailAddress = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && !/[\r\n]/.test(s);
export async function reviewEmail(email: ReviewedEmail, artifact: DocumentEmailArtifact): Promise<string> {
  if (!emailAddress(email.from) || !emailAddress(email.to) || email.cc.some(x => !emailAddress(x))) throw new Error("A valid sender and recipient are required.");
  if (!email.subject.trim() || !email.body.trim() || /[\r\n]/.test(email.subject)) throw new Error("The email subject and body are required.");
  const {content_base64,latest_version: _latest, ...metadata}=artifact;
  // Fixed serialization order, including actual sender, recipients, text and all attachment identity fields.
  const keys=(a: Attachment) => [a.kind,a.company_id,a.job_id,a.document_id,a.version,a.filename,a.mime_type,a.size_bytes,a.sha256];
  if (email.company_id !== metadata.company_id || email.job_id !== metadata.job_id || JSON.stringify(keys(email.attachment)) !== JSON.stringify(keys(metadata))) throw new Error("The document does not match this email.");
  let bytes: Uint8Array;
  try { const raw=atob(content_base64);bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)); } catch { throw new Error("The attachment cannot be decoded."); }
  if (bytes.length !== metadata.size_bytes || await sha(bytes) !== metadata.sha256) throw new Error("The attachment bytes do not match the reviewed document.");
  return sha(utf8.encode(JSON.stringify([email.company_id,email.job_id,email.from,email.to,email.cc,email.subject,email.body,keys(metadata)])));
}
/** Called only after a user confirms the displayed exact review. A network exception has an
 * uncertain outcome; a subsequent invocation refuses to call the provider again. */
export async function sendReviewedEmail(input: {
  repository: DeliveryRepository; deliveryId: string; actorId: string; email: ReviewedEmail;
  artifact: DocumentEmailArtifact; confirmedHash: string; confirmed: true;
  ensureCurrentAccessVersionAndSender: () => Promise<void>;
  provider: (email: ReviewedEmail, artifact: DocumentEmailArtifact, idempotencyKey: string) => Promise<ProviderReceipt>;
}): Promise<{status: "sent" | "already_sent" | "uncertain"; receipt: ProviderReceipt | null}> {
  if (input.confirmed !== true) throw new Error("Confirm the email before sending.");
  const digest = await reviewEmail(input.email,input.artifact);
  if (digest !== input.confirmedHash) throw new Error("This email changed after review.");
  await input.ensureCurrentAccessVersionAndSender();
  const state = await input.repository.claim(input.deliveryId,input.actorId,digest);
  if (state === "mismatch") throw new Error("This review is unavailable or changed.");
  if (state === "pending") return {status:"uncertain",receipt:null};
  if (state === "sent") return {status:"already_sent",receipt:(await input.repository.get(input.deliveryId,input.actorId))?.receipt ?? null};
  try {
    const receipt = await input.provider(input.email,input.artifact,input.deliveryId);
    if (!receipt.provider.trim() || !receipt.message_id.trim() || !Number.isFinite(Date.parse(receipt.sent_at))) throw new Error("Provider receipt is incomplete.");
    await input.repository.finish(input.deliveryId,input.actorId,digest,receipt);
    return {status:"sent",receipt};
  } catch {
    // If recording itself fails, the existing 'sending' state is also fail-closed.
    try { await input.repository.uncertain(input.deliveryId,input.actorId,digest); } catch { /* reconcile the existing claim */ }
    return {status:"uncertain",receipt:null};
  }
}
