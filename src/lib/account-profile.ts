import { MAX_COMPANY_LOGO_BYTES, validatePaymentLogo } from "@/lib/payment-applications/brand";

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
};
export type SetupStep = {
  id: "profile" | "team" | "payments";
  label: string;
  detail: string;
  done: boolean;
  href: string;
  /** Shown on the list but not counted until the feature ships. */
  soon?: boolean;
};

export function setupSteps(i: SetupInput): SetupStep[] {
  const p = i.profile;
  const profileDone = !!(p?.name?.trim() && p.logo_url);
  const people = i.members + i.pending;
  return [
    {
      id: "profile",
      label: "Company profile and logo",
      detail: profileDone
        ? "Shows on pay apps, proposals and client pages"
        : "Add your logo so clients see your brand, not ours",
      done: profileDone,
      href: "#company",
    },
    {
      id: "team",
      label: "Invite your team",
      detail: people > 1 ? `${people} people on your team` : "Add your PMs, AP and supers",
      done: people > 1,
      href: "#team",
    },
    {
      id: "payments",
      label: "Get paid by your clients",
      detail: "Card and bank payments on the client page are coming soon",
      done: false,
      href: "#payments",
      soon: true,
    },
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
