// Athena account page: Company profile (Nov 2026). Saves to Athena's own company record, the one pay apps, proposals,
// client pages and emails read, so a logo set here finally shows up for clients. Owner-only; the database checks it.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  LOGO_RULE,
  PROFILE_COLUMNS,
  brandChanges,
  checkLogoFile,
  companyInitials,
  draftFrom,
  nameChanged,
  profileSaveError,
  validateProfile,
  type CompanyProfile,
  type ProfileDraft,
} from "@/lib/account-profile";

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ error: { message: string } | null }>;
const rpc = supabase.rpc as unknown as Rpc;
const LOGO_BUCKET = "company-logos";

export function useCompanyProfile(companyId: string | null) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(!!companyId);
  const [error, setError] = useState(false);
  const reload = useCallback(async () => {
    if (!companyId) {
      setProfile(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    const { data, error: e } = await supabase
      .from("mcp_companies")
      .select(PROFILE_COLUMNS)
      .eq("id", companyId)
      .maybeSingle();
    const row = (data as CompanyProfile | null) ?? null;
    setProfile(row);
    setError(!!e);
    setLoading(false);
    return row;
  }, [companyId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { profile, loading, error, reload };
}

export type CompanyProfileState = ReturnType<typeof useCompanyProfile>;

function Field({
  id,
  label,
  value,
  onChange,
  readOnly,
  wide,
  placeholder,
  type = "text",
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
  wide?: boolean;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div className={wide ? "aa-field aa-wide" : "aa-field"}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function CompanyProfileSection({
  state,
  companyId,
  isOwner,
  userId,
}: {
  state: CompanyProfileState;
  companyId: string | null;
  isOwner: boolean;
  userId: string | null;
}) {
  const { profile, loading, error, reload } = state;
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFrom(profile));
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => setDraft(draftFrom(profile)), [profile]);

  if (!companyId)
    return (
      <div className="aa-card">
        <h2>No Athena company yet</h2>
        <p className="aa-lede">
          Ask Athena in your chat to set up your company. Your profile shows here after.
        </p>
      </div>
    );
  if (loading && !profile)
    return (
      <div className="aa-card" role="status">
        <Loader2 size={16} className="aa-spin" /> Loading your company profile…
      </div>
    );
  if (error && !profile)
    return (
      <div className="aa-card" role="status">
        Your company profile could not be loaded. Reload the page to try again.
      </div>
    );

  const set = (k: keyof ProfileDraft) => (v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setMessage(null);
  };
  const dirty = nameChanged(profile, draft) || Object.keys(brandChanges(profile, draft)).length > 0;
  const readOnly = !isOwner;

  async function save() {
    const problem = validateProfile(draft);
    if (problem) return setMessage({ tone: "bad", text: problem });
    setSaving(true);
    setMessage(null);
    try {
      if (nameChanged(profile, draft)) {
        const r = await rpc("mcp_company_save", {
          _company: companyId,
          _p: { name: draft.name.trim() },
        });
        if (r.error) throw new Error(r.error.message);
      }
      const changes = brandChanges(profile, draft);
      if (Object.keys(changes).length) {
        const r = await rpc("mcp_company_brand_save", { _company: companyId, _p: changes });
        if (r.error) throw new Error(r.error.message);
      }
      await reload();
      setMessage({ tone: "ok", text: "Saved. Clients see this on your next document." });
    } catch (e) {
      setMessage({
        tone: "bad",
        text: profileSaveError(e instanceof Error ? e.message : undefined),
      });
    } finally {
      setSaving(false);
    }
  }

  async function onLogo(file: File | undefined) {
    if (!file || !userId || !companyId) return;
    setMessage(null);
    const check = await checkLogoFile(file);
    if (!check.ok) return setMessage({ tone: "bad", text: check.error });
    setLogoBusy(true);
    try {
      const path = `${userId}/athena-${companyId}-${crypto.randomUUID()}.${check.ext}`;
      const up = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw new Error("The logo didn't upload. Check your connection and try again.");
      const url = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
      const r = await rpc("mcp_company_brand_save", { _company: companyId, _p: { logo_url: url } });
      if (r.error) throw new Error(profileSaveError(r.error.message));
      const fresh = await reload();
      if (fresh?.logo_url !== url)
        throw new Error("The logo uploaded, but we couldn't confirm it saved. Reload and check.");
      setMessage({
        tone: "ok",
        text: "Logo saved. It shows on pay apps, proposals and client pages.",
      });
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "The logo didn't save." });
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeLogo() {
    if (!companyId) return;
    setLogoBusy(true);
    setMessage(null);
    const r = await rpc("mcp_company_brand_save", { _company: companyId, _p: { logo_url: "" } });
    if (r.error) setMessage({ tone: "bad", text: profileSaveError(r.error.message) });
    else {
      await reload();
      setMessage({ tone: "ok", text: "Logo removed. Documents show your company name instead." });
    }
    setLogoBusy(false);
  }

  const shownName = draft.name.trim() || "Your company";
  const logo = profile?.logo_url ?? null;
  const site = draft.website.trim().replace(/^https?:\/\//i, "");

  return (
    <div className="aa-company-split">
      <section className="aa-card aa-profile-form" aria-labelledby="aa-company-form-title">
        <div>
          <h2 id="aa-company-form-title">Company details</h2>
          <p className="aa-lede">
            {isOwner
              ? "One profile for every document your clients get."
              : "Only your company Owner can change these. Ask them if something's out of date."}
          </p>
        </div>
        <div className="aa-logo-drop">
          <span className="aa-logo-box" aria-hidden="true">
            {logo ? <img src={logo} alt="" /> : companyInitials(draft.name)}
          </span>
          <div className="aa-logo-actions">
            <span className="aa-flabel">Company logo</span>
            <span className="aa-hint">{LOGO_RULE}</span>
            {isOwner ? (
              <div className="aa-row" style={{ justifyContent: "flex-start", gap: 8 }}>
                <input
                  ref={fileRef}
                  id="aa-logo-file"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => void onLogo(e.target.files?.[0])}
                  disabled={logoBusy}
                />
                <button
                  type="button"
                  className="aa-btn aa-btn-ghost aa-btn-sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={logoBusy}
                >
                  {logoBusy ? <Loader2 size={14} className="aa-spin" /> : <Upload size={14} />}
                  {logo ? "Replace logo" : "Upload logo"}
                </button>
                {logo ? (
                  <button
                    type="button"
                    className="aa-btn aa-btn-ghost aa-btn-sm"
                    onClick={() => void removeLogo()}
                    disabled={logoBusy}
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="aa-form-grid">
          <Field
            id="aa-co-name"
            label="Company name"
            value={draft.name}
            onChange={set("name")}
            readOnly={readOnly}
            wide
            autoComplete="organization"
          />
          <Field
            id="aa-co-license"
            label="License number"
            value={draft.license_number}
            onChange={set("license_number")}
            readOnly={readOnly}
            placeholder="Optional"
          />
          <Field
            id="aa-co-phone"
            label="Phone"
            type="tel"
            value={draft.contact_phone}
            onChange={set("contact_phone")}
            readOnly={readOnly}
            placeholder="(512) 555-0142"
            autoComplete="tel"
          />
          <Field
            id="aa-co-contact"
            label="Main contact"
            value={draft.contact_name}
            onChange={set("contact_name")}
            readOnly={readOnly}
            placeholder="Who clients reach"
          />
          <Field
            id="aa-co-website"
            label="Website"
            value={draft.website}
            onChange={set("website")}
            readOnly={readOnly}
            placeholder="yourcompany.com"
            autoComplete="url"
          />
          <Field
            id="aa-co-address"
            label="Address"
            value={draft.address}
            onChange={set("address")}
            readOnly={readOnly}
            wide
            placeholder="Street, city, state"
            autoComplete="street-address"
          />
        </div>
        {isOwner ? (
          <div className="aa-save-bar">
            <button
              type="button"
              className="aa-btn aa-btn-primary"
              onClick={() => void save()}
              disabled={saving || !dirty}
            >
              {saving ? <Loader2 size={14} className="aa-spin" /> : null}
              {saving ? "Saving…" : "Save changes"}
            </button>
            {dirty ? (
              <button
                type="button"
                className="aa-btn aa-btn-ghost"
                onClick={() => setDraft(draftFrom(profile))}
                disabled={saving}
              >
                Undo changes
              </button>
            ) : null}
            {message ? (
              <p
                role={message.tone === "bad" ? "alert" : "status"}
                className={message.tone === "ok" ? "aa-saved" : "aa-error"}
              >
                {message.text}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
      <aside className="aa-client-preview" aria-label="What your clients see">
        <p className="aa-eyebrow">WHAT YOUR CLIENTS SEE</p>
        <div className="aa-client" aria-hidden="true">
          <div className="aa-client-bar">Client page · pay app</div>
          <div className="aa-client-head">
            <span className="aa-logo-box">
              {logo ? <img src={logo} alt="" /> : companyInitials(draft.name)}
            </span>
            <div>
              <strong>{shownName}</strong>
              <small>Client page</small>
            </div>
          </div>
          <div className="aa-client-lines">
            {draft.license_number.trim() ? (
              <span>License {draft.license_number.trim()}</span>
            ) : null}
            {draft.contact_name.trim() || draft.contact_phone.trim() ? (
              <span>
                {[draft.contact_name.trim(), draft.contact_phone.trim()]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ) : null}
            {site ? <span>{site}</span> : null}
            {draft.address.trim() ? <span>{draft.address.trim()}</span> : null}
          </div>
          <div className="aa-client-foot">
            <img src="/brand/athena/athena-mark-mono-blue.svg" alt="" /> Powered by Athena
          </div>
        </div>
        <p className="aa-hint">Your name and logo lead. Athena stays a small mark in the corner.</p>
      </aside>
    </div>
  );
}
