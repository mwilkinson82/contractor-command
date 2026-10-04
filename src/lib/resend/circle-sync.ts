import type { CircleDecision } from "@/lib/membership/circle.server";
import { shouldSkipResendCapture } from "./never-email";
import { RESEND_SEGMENT_IDS } from "./segments";

const API = "https://api.resend.com";
let nextResendRequestAt = 0;
export type CircleContact = { id: string; email: string; unsubscribed?: boolean };
export type CircleSyncInput = {
  email: string;
  decision: CircleDecision;
  suppressed: boolean;
  firstName?: string | null;
  company?: string | null;
  lastName?: string | null;
};
export function circleSegmentAction(input: CircleSyncInput): "add" | "remove" | "review" {
  if (input.suppressed || shouldSkipResendCapture(input)) return "remove";
  if (input.decision.state === "review") return "review";
  return input.decision.state === "eligible" ? "add" : "remove";
}

export function circleResendClient(apiKey: string, fetchFn: typeof fetch = fetch, paceMs = 550) {
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    allow404 = false,
    allowConflict = false,
  ) {
    if (paceMs > 0) {
      const slot = Math.max(Date.now(), nextResendRequestAt);
      nextResendRequestAt = slot + paceMs;
      const delay = slot - Date.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const res = await fetchFn(`${API}${path}`, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (allow404 && res.status === 404) return null;
    if (allowConflict && res.status === 409) return {};
    if (!res.ok) throw new Error(`Circle Resend ${method} failed (${res.status})`);
    return res.status === 204 ? {} : await res.json();
  }
  return {
    async contact(email: string): Promise<CircleContact | null> {
      return request(
        `/contacts/${encodeURIComponent(email.trim().toLowerCase())}`,
        "GET",
        undefined,
        true,
      );
    },
    async list(): Promise<CircleContact[]> {
      const contacts: CircleContact[] = [];
      let after: string | undefined;
      for (;;) {
        const page = await request(
          `/segments/${RESEND_SEGMENT_IDS.circle}/contacts?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`,
        );
        if (!Array.isArray(page?.data)) throw new Error("Invalid Resend contacts response");
        contacts.push(...page.data);
        if (!page.has_more) return contacts;
        const next = page.data.at(-1)?.id;
        if (!next || next === after) throw new Error("Invalid Resend pagination cursor");
        after = next;
      }
    },
    async apply(input: CircleSyncInput) {
      const action = circleSegmentAction(input);
      if (action === "review") throw new Error("Circle membership requires review");
      const email = input.email.trim().toLowerCase();
      const contact = await request(
        `/contacts/${encodeURIComponent(email)}`,
        "GET",
        undefined,
        true,
      );
      // Never reset unsubscribed or delete the global contact/other segments.
      if (action === "remove" || contact?.unsubscribed) {
        if (contact)
          await request(
            `/contacts/${encodeURIComponent(contact.id)}/segments/${RESEND_SEGMENT_IDS.circle}`,
            "DELETE",
            undefined,
            true,
          );
        return "removed";
      }
      if (!contact) {
        // No unsubscribed field: preserve provider suppression on an existing-contact race.
        await request(
          "/contacts",
          "POST",
          {
            email,
            ...(input.firstName ? { first_name: input.firstName } : {}),
          },
          false,
          true,
        );
      }
      // Re-read before adding so a concurrently created unsubscribed contact is not enrolled.
      const current = await request(`/contacts/${encodeURIComponent(email)}`);
      if (current?.unsubscribed) return "suppressed";
      if (!current?.id) throw new Error("Resend contact has no id");
      await request(
        `/contacts/${encodeURIComponent(current.id)}/segments/${RESEND_SEGMENT_IDS.circle}`,
        "POST",
        undefined,
        false,
        true,
      );
      return "added";
    },
  };
}
