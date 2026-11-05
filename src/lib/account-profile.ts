import { companyBoardPath, isCompanyId } from "@/lib/company-board";
import { MAX_COMPANY_LOGO_BYTES, validatePaymentLogo } from "@/lib/payment-applications/brand";
import { READINESS, type ClientPaymentsState } from "@/lib/client-payments/account-view";

// Athena account page: the company profile clients see (Marshall, Nov 4 2026). It reads and writes Athena's own
// company record (mcp_companies), the one pay apps, proposals, client pages and emails use. The name goes through
// mcp_company_save; logo, license, contact, phone, website and address go through mcp_company_brand_save. Both
// database functions check that the caller is the company Owner, so this file only shapes inputs and messages.

export type CompanyProfile = {
  id: string;
  name: string;
  logo_url: string | null;
  license_number: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  website: string | null;
  address: string | null;
};

export type ProfileDraft = {
  name: string;
  license_number: string;
  contact_name: string;
  contact_phone: string;
  website: string;
  address: string;
};

export const PROFILE_COLUMNS =
  "id, name, logo_url, license_number, contact_name, contact_phone, website, address";

export function draftFrom(p: CompanyProfile | null): ProfileDraft {
  return {
    name: p?.name ?? "",
    license_number: p?.license_number ?? "",
    contact_name: p?.contact_name ?? "",
    contact_phone: p?.contact_phone ?? "",
    website: p?.website ?? "",
    address: p?.address ?? "",
  };
}

const LIMITS: Record<keyof ProfileDraft, number> = {
  name: 200,
  license_number: 80,
  contact_name: 120,
  contact_phone: 40,
  website: 200,
  address: 300,
};
const FIELD_NAME: Record<keyof ProfileDraft, string> = {
  name: "Company name",
  license_number: "License number",
  contact_name: "Main contact",
  contact_phone: "Phone",
  website: "Website",
  address: "Address",
};

/** Plain-language check before saving. Returns the first problem, or null. */
export function validateProfile(d: ProfileDraft): string | null {
  if (!d.name.trim()) return "Enter your company name.";
  for (const key of Object.keys(LIMITS) as (keyof ProfileDraft)[]) {
    if (d[key].trim().length > LIMITS[key])
      return `${FIELD_NAME[key]} is too long. Keep it under ${LIMITS[key]} characters.`;
  }
  const phone = d.contact_phone.trim();
  if (phone && !/^[+()\d\s.\-x]{7,}$/i.test(phone))
    return "Enter the phone as digits, like (512) 555-0142.";
  const site = d.website.trim();
  if (site && !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(site))
    return "Enter the website like ridgelineelectric.com.";
  return null;
}

/** Only the fields that changed, so a save never blanks something another tool set. */
export function brandChanges(
  before: CompanyProfile | null,
  d: ProfileDraft,
): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = ["license_number", "contact_name", "contact_phone", "website", "address"] as const;
  for (const k of keys) {
    const now = d[k].trim();
    if (now !== (before?.[k] ?? "").trim()) out[k] = now;
  }
  return out;
}

export function nameChanged(before: CompanyProfile | null, d: ProfileDraft): boolean {
  return d.name.trim() !== (before?.name ?? "").trim();
}

/** Two letters for the logo placeholder. */
export function companyInitials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (letters || "A").toUpperCase();
}

/** Owner-facing message for a failed save. Database messages that start with MCP_BAD: are already plain words. */
export function profileSaveError(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("Only a company Owner"))
    return "Only the company Owner can change the company profile.";
  const bad = /MCP_BAD:(.+)$/.exec(m);
  if (bad) return bad[1].trim();
  if (m.includes("MCP_INACTIVE"))
    return "Your membership isn't active, so profile changes are paused. Your saved profile is safe.";
  return "That didn't save. Check your connection and try again.";
}

// ---- Setup checklist on the overview ------------------------------------------------------------------------------
export type SetupInput = {
  profile: CompanyProfile | null;
  members: number;
  pending: number;
  /** Client payments as the account page reads them; null or missing reads as not set up. */
  payments?: ClientPaymentsState | null;
  /**
   * Whether Athena has answered this member in a connected AI app, and how many jobs the company has saved.
   * Left out until the account page has read them, so the two steps don't flash "not done" while loading.
   */
  progress?: SetupProgress | null;
  /** The member's Athena company; the profile step then opens its company board, where the editor lives. */
  companyId?: string | null;
};
export type SetupProgress = {
  connected: boolean;
  jobs: number;
  /** Kinds-of-work questions. Left off until its company setting exists. */
  work?: { done: boolean; left: number } | null;
};

/** What a member sends in their AI chat to answer the kinds-of-work questions. */
export const WORK_PROFILE_MESSAGE = "Athena, let's set up the kinds of work we do.";

/** Where a member learns to put Athena in ChatGPT, Claude or Grok Bot. */
export const CONNECT_GUIDE_URL = "https://meetathena.io/connect/";
/** The first message every connect screen gives. */
export const FIRST_JOB_MESSAGE = "Athena, let's set up my first job.";
export type SetupStep = {
  id: "connect" | "work" | "first-job" | "profile" | "team" | "payments";
  label: string;
  detail: string;
  done: boolean;
  href: string;
  /** The pill on a finished step. Defaults to Done. */
  doneLabel?: string;
  /** The button on an open step. Defaults to Start. */
  action?: string;
  /** Shown on the list but not counted until the feature ships. */
  soon?: boolean;
};

/** Client payments on the overview checklist: connected once a Stripe account is linked in either mode. */
export function paymentsStep(s: ClientPaymentsState | null | undefined): SetupStep {
  const base = { id: "payments" as const, label: "Get paid by your clients", href: "#payments" };
  if (!s || !(s.test.connected || s.live.connected))
    return {
      ...base,
      detail: "Not set up. Connect Stripe so clients can pay approved pay apps by bank or card",
      done: false,
      action: "Set up",
    };
  const status = s.mode === "live" ? s.live.status : s.test.status;
  const detail = !s.ready
    ? `Stripe connected. ${READINESS[status].label}`
    : s.mode === "live"
      ? "Stripe connected. Clients can pay approved pay apps"
      : "Stripe connected in test mode. No real money moves yet";
  return { ...base, detail, done: true, doneLabel: "Connected" };
}

/** The steps that get a new member working: Athena in their AI, the kinds of work they do, then their first job. */
export function startSteps(progress: SetupProgress): SetupStep[] {
  const jobs = Math.max(0, Math.floor(progress.jobs));
  return [
    {
      id: "connect",
      label: "Connect Athena to your AI",
      detail: progress.connected
        ? "Athena is answering you in your AI app"
        : "Not yet. Takes about 3 minutes, once, on a computer",
      done: progress.connected,
      doneLabel: "Connected",
      href: CONNECT_GUIDE_URL,
      action: "Show me how",
    },
    ...(progress.work
      ? [
          {
            id: "work" as const,
            label: "Tell Athena the kinds of work you do",
            detail: progress.work.done
              ? "Athena asks new jobs only what fits your work"
              : `${progress.work.left} quick ${progress.work.left === 1 ? "question" : "questions"} left. In your connected chat, send: ${WORK_PROFILE_MESSAGE}`,
            done: progress.work.done,
            href: CONNECT_GUIDE_URL,
            action: "How to start",
          },
        ]
      : []),
    {
      id: "first-job",
      label: "Set up your first job",
      detail:
        jobs > 0
          ? `${jobs} ${jobs === 1 ? "job" : "jobs"} saved`
          : `In your connected chat, send: ${FIRST_JOB_MESSAGE}`,
      done: jobs > 0,
      href: "#projects",
      action: "See projects",
    },
  ];
}

export function setupSteps(i: SetupInput): SetupStep[] {
  const p = i.profile;
  const profileDone = !!(p?.name?.trim() && p.logo_url);
  const people = i.members + i.pending;
  return [
    ...(i.progress ? startSteps(i.progress) : []),
    {
      id: "profile",
      label: "Company profile and logo",
      detail: profileDone
        ? "Shows on pay apps, proposals and client pages"
        : "Add your logo so clients see your brand, not ours",
      done: profileDone,
      href: isCompanyId(i.companyId) ? companyBoardPath(i.companyId) : "#company",
      ...(isCompanyId(i.companyId) ? { action: "Open company board" } : {}),
    },
    {
      id: "team",
      label: "Invite your team",
      detail: people > 1 ? `${people} people on your team` : "Add your PMs, AP and supers",
      done: people > 1,
      href: "#team",
    },
    paymentsStep(i.payments),
  ];
}

// ---- Logo file check ----------------------------------------------------------------------------------------------
// Same rule as pay apps and proposals: PNG or JPEG, at most 1 MB and 2048 px, so the logo prints on every document.

export const LOGO_RULE = "PNG or JPG, up to 1 MB and 2048 px on the long side.";

export async function checkLogoFile(file: {
  size: number;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}): Promise<{ ok: true; ext: "png" | "jpg" } | { ok: false; error: string }> {
  if (file.size < 1 || file.size > MAX_COMPANY_LOGO_BYTES)
    return { ok: false, error: "That logo is over 1 MB. Choose a smaller PNG or JPG." };
  const format = await validatePaymentLogo(new Uint8Array(await file.arrayBuffer()));
  if (!format || (format === "PNG" ? file.type !== "image/png" : file.type !== "image/jpeg"))
    return {
      ok: false,
      error:
        "That file won't print on documents. Use a PNG or JPG up to 2048 px. If it's a PNG, re-save it as a plain PNG or use JPG.",
    };
  return { ok: true, ext: format === "PNG" ? "png" : "jpg" };
}
