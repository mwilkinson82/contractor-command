import { shouldSkipResendCapture } from "@/lib/resend/never-email";
import {
  DEFAULT_CAPTURE_SEGMENT,
  RESEND_SEGMENT_IDS,
  type CaptureSegment,
} from "@/lib/resend/segments";
import {
  persistResendSyncLog,
  type ResendSyncLogClient,
} from "@/lib/resend/sync-log";

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

export type SyncResendOpts = {
  apiKey?: string | null;
  fetch?: ResendFetch;
  supabase?: ResendSyncLogClient | null;
};

export type SyncResendContactResult = CaptureResult | { ok: false; reason: string };

export const ADMIN_COMP_SOURCE = "admin_comp";
export const MARSHALL_COMP_SOURCE = "marshall_comp";

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
 * Does not send mail. Persists success/skip/failure to resend_sync_log.
 */
export async function syncPaidResendContact(
  input: CaptureInput & { segment: CaptureSegment },
  opts?: SyncResendOpts,
): Promise<SyncResendContactResult> {
  const source = input.source ?? "stripe";
  const segment = input.segment;
  try {
    const result = await upsertResendCapture(
      {
        ...input,
        source,
        source_url: input.source_url ?? "https://app.alpcontractorcircle.com",
        magnet: input.magnet ?? segment,
      },
      opts,
    );
    await persistResendSyncLog(
      {
        email: input.email,
        segment,
        source,
        status: result.ok && result.skipped ? "skipped" : "ok",
        contactId: result.contactId,
        metadata: { magnet: input.magnet ?? segment },
      },
      { supabase: opts?.supabase },
    );
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("Resend paid-contact sync failed", { email: input.email, segment, err });
    await persistResendSyncLog(
      {
        email: input.email,
        segment,
        source,
        status: "failed",
        errorMessage: reason,
        metadata: { magnet: input.magnet ?? segment },
      },
      { supabase: opts?.supabase },
    );
    return { ok: false, reason };
  }
}

/**
 * Marshall/admin Circle (and hardcore) comps: same Circle members segment
 * as paid Circle. Source is admin_comp / marshall_comp — never stripe.
 * Does not send mail. Never throws.
 */
export async function syncCompedResendContact(
  input: Omit<CaptureInput, "segment"> & {
    source?: typeof ADMIN_COMP_SOURCE | typeof MARSHALL_COMP_SOURCE;
  },
  opts?: SyncResendOpts,
): Promise<SyncResendContactResult> {
  return syncPaidResendContact(
    {
      ...input,
      segment: "circle",
      source: input.source ?? ADMIN_COMP_SOURCE,
      source_url: input.source_url ?? "https://app.alpcontractorcircle.com",
      magnet: input.magnet ?? MARSHALL_COMP_SOURCE,
    },
    opts,
  );
}
