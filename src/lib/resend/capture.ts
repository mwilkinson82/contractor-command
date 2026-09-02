import { shouldSkipResendCapture } from "@/lib/resend/never-email";
import {
  DEFAULT_CAPTURE_SEGMENT,
  RESEND_SEGMENT_IDS,
  type CaptureSegment,
} from "@/lib/resend/segments";

const RESEND_API = "https://api.resend.com";

export type CaptureInput = {
  email: string;
  segment?: CaptureSegment;
  source?: string | null;
  source_url?: string | null;
  magnet?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
};

export type CaptureResult =
  | { ok: true; skipped: true; contactId: null; segment: CaptureSegment }
  | { ok: true; skipped?: false; contactId: string; segment: CaptureSegment };

export type ResendFetch = typeof fetch;

type ResendJson = {
  status: number;
  ok: boolean;
  body: Record<string, unknown> | null;
};

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function captureProperties(input: CaptureInput): Record<string, string> {
  const properties: Record<string, string> = {};
  const source = trimOrNull(input.source);
  const sourceUrl = trimOrNull(input.source_url);
  const magnet = trimOrNull(input.magnet);
  if (source) properties.source = source;
  if (sourceUrl) properties.source_url = sourceUrl;
  if (magnet) properties.magnet = magnet;
  return properties;
}

async function resendRequest(
  path: string,
  init: RequestInit,
  apiKey: string,
  fetchFn: ResendFetch,
): Promise<ResendJson> {
  const res = await fetchFn(`${RESEND_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { raw: text };
    }
  }
  return { status: res.status, ok: res.ok, body };
}

function contactIdFromBody(body: Record<string, unknown> | null): string | null {
  const id = body?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function addContactToSegment(
  contactRef: string,
  segmentId: string,
  apiKey: string,
  fetchFn: ResendFetch,
): Promise<void> {
  const added = await resendRequest(
    `/contacts/${encodeURIComponent(contactRef)}/segments/${encodeURIComponent(segmentId)}`,
    { method: "POST" },
    apiKey,
    fetchFn,
  );
  if (added.ok || added.status === 409) return;
  throw new Error(
    `Resend add-to-segment failed (${added.status}): ${JSON.stringify(added.body)}`,
  );
}

/**
 * Create-or-update a Resend contact and add them to the matching segment.
 * Does not send mail.
 */
export async function upsertResendCapture(
  input: CaptureInput,
  opts?: { apiKey?: string | null; fetch?: ResendFetch },
): Promise<CaptureResult> {
  const email = input.email.trim().toLowerCase();
  const segment = input.segment ?? DEFAULT_CAPTURE_SEGMENT;
  const segmentId = RESEND_SEGMENT_IDS[segment];

  if (
    shouldSkipResendCapture({
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      company: input.company,
    })
  ) {
    return { ok: true, skipped: true, contactId: null, segment };
  }

  const apiKey = opts?.apiKey ?? process.env.RESEND_API_KEY ?? null;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  const fetchFn = opts?.fetch ?? fetch;

  const firstName = trimOrNull(input.firstName);
  const lastName = trimOrNull(input.lastName);
  const properties = captureProperties(input);

  const createBody: Record<string, unknown> = {
    email,
    segments: [{ id: segmentId }],
  };
  if (firstName) createBody.first_name = firstName;
  if (lastName) createBody.last_name = lastName;
  if (Object.keys(properties).length > 0) createBody.properties = properties;

  const created = await resendRequest(
    "/contacts",
    { method: "POST", body: JSON.stringify(createBody) },
    apiKey,
    fetchFn,
  );

  if (created.ok) {
    const contactId = contactIdFromBody(created.body);
    if (!contactId) {
      throw new Error("Resend create contact returned no id");
    }
    return { ok: true, contactId, segment };
  }

  if (created.status !== 409) {
    throw new Error(`Resend create contact failed (${created.status}): ${JSON.stringify(created.body)}`);
  }

  const updateBody: Record<string, unknown> = {};
  if (firstName) updateBody.first_name = firstName;
  if (lastName) updateBody.last_name = lastName;
  if (Object.keys(properties).length > 0) updateBody.properties = properties;

  const updated = await resendRequest(
    `/contacts/${encodeURIComponent(email)}`,
    { method: "PATCH", body: JSON.stringify(updateBody) },
    apiKey,
    fetchFn,
  );
  if (!updated.ok) {
    throw new Error(`Resend update contact failed (${updated.status}): ${JSON.stringify(updated.body)}`);
  }

  let contactId = contactIdFromBody(updated.body) ?? contactIdFromBody(created.body);
  if (!contactId) {
    const got = await resendRequest(`/contacts/${encodeURIComponent(email)}`, { method: "GET" }, apiKey, fetchFn);
    contactId = contactIdFromBody(got.body);
  }
  if (!contactId) {
    throw new Error("Resend update contact returned no id");
  }

  await addContactToSegment(contactId, segmentId, apiKey, fetchFn);
  return { ok: true, contactId, segment };
}

/**
 * Stripe alongside-path: write a paying customer into Resend.
 * Never throws — webhook onboarding must not fail over a contact upsert.
 * Does not send mail.
 */
export async function syncPaidResendContact(
  input: CaptureInput & { segment: CaptureSegment },
  opts?: { apiKey?: string | null; fetch?: ResendFetch },
): Promise<CaptureResult | { ok: false; reason: string }> {
  try {
    return await upsertResendCapture(
      {
        ...input,
        source: input.source ?? "stripe",
        source_url: input.source_url ?? "https://app.alpcontractorcircle.com",
        magnet: input.magnet ?? input.segment,
      },
      opts,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("Resend paid-contact sync failed", { email: input.email, segment: input.segment, err });
    return { ok: false, reason };
  }
}
