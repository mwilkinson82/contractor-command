import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, Container } from "@/components/portal/page-header";
import { AOS_URL } from "@/lib/vault";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCompany, logoPublicUrl } from "@/hooks/use-company";
import { GREETING_ICONS, type GreetingIconKey } from "@/components/portal/greeting-icon";
import { ArrowUpRight, Check, AlertCircle, KeyRound, Building2, Loader2, Upload, Image as ImageIcon } from "lucide-react";
import { createBillingPortalSession, submitBillingQuestion } from "@/lib/billing.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const LOGO_BUCKET = "company-logos";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Account — ALP Contractor Circle" }] }),
  component: AccountPage,
});

type Profile = { full_name: string | null; email: string };
type AosLink = {
  aos_email: string | null;
  link_code: string | null;
  verified_at: string | null;
  last_sync_at: string | null;
};

function AccountPage() {
  const { user } = useAuth();
  const { company, refetch: refetchCompany } = useCompany();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [link, setLink] = useState<AosLink | null>(null);
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Company edit state
  const [coName, setCoName] = useState("");
  const [coAddress, setCoAddress] = useState("");
  const [coIcon, setCoIcon] = useState<GreetingIconKey>("wave");
  const [coLogoPath, setCoLogoPath] = useState<string | null>(null);
  const [coLogoPreview, setCoLogoPreview] = useState<string | null>(null);
  const [coUploading, setCoUploading] = useState(false);
  const [coSaving, setCoSaving] = useState(false);
  const [coMsg, setCoMsg] = useState<string | null>(null);
  const logoFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!company) return;
    setCoName(company.name ?? "");
    setCoAddress(company.address ?? "");
    setCoLogoPath(company.logo_path);
    setCoLogoPreview(logoPublicUrl(company.logo_path));
    if (company.greeting_icon) {
      setCoIcon(company.greeting_icon as GreetingIconKey);
    }
  }, [company]);

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      setCoMsg("Pick an image file (PNG, JPG, SVG).");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setCoMsg("Keep logo under 2MB.");
      return;
    }
    setCoMsg(null);
    setCoUploading(true);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${user.id}/logo.${ext}`;
    const { error } = await supabase.storage
      .from(LOGO_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) {
      setCoMsg(error.message);
    } else {
      setCoLogoPath(path);
      setCoLogoPreview(`${logoPublicUrl(path)}?v=${Date.now()}`);
    }
    setCoUploading(false);
  }

  async function saveCompany() {
    if (!user) return;
    const trimmed = coName.trim();
    if (!trimmed) {
      setCoMsg("Company name is required.");
      return;
    }
    setCoSaving(true);
    setCoMsg(null);
    const { error } = await supabase
      .from("companies")
      .upsert(
        {
          owner_user_id: user.id,
          name: trimmed,
          address: coAddress.trim() || null,
          greeting_icon: coIcon,
          logo_path: coLogoPath,
        },
        { onConflict: "owner_user_id" },
      );
    if (error) setCoMsg(error.message);
    else {
      await refetchCompany();
      setCoMsg("Saved.");
    }
    setCoSaving(false);
  }

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: p }, { data: l }] = await Promise.all([
        supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
        supabase.from("aos_links").select("aos_email, link_code, verified_at, last_sync_at").eq("user_id", user.id).maybeSingle(),
      ]);
      setProfile(p as Profile | null);
      setLink(l as AosLink | null);
    })();
  }, [user]);

  async function ensureLinkRow() {
    if (!user) return;
    if (!link) {
      const { data, error } = await supabase
        .from("aos_links")
        .insert({ user_id: user.id, aos_email: user.email })
        .select("aos_email, link_code, verified_at, last_sync_at")
        .single();
      if (!error && data) setLink(data as AosLink);
    }
  }

  async function useEmailMatch() {
    if (!user) return;
    setSaving(true);
    setMsg(null);
    await ensureLinkRow();
    const { data, error } = await supabase
      .from("aos_links")
      .update({ aos_email: user.email, link_code: null, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .select("aos_email, link_code, verified_at, last_sync_at")
      .single();
    if (error) setMsg(error.message);
    else if (data) {
      setLink(data as AosLink);
      setMsg("Saved. We'll match by your login email when the AOS connector goes live.");
    }
    setSaving(false);
  }

  async function saveLinkCode() {
    if (!user) return;
    const trimmed = code.trim();
    if (!trimmed) return;
    setSaving(true);
    setMsg(null);
    await ensureLinkRow();
    const { data, error } = await supabase
      .from("aos_links")
      .update({ link_code: trimmed, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .select("aos_email, link_code, verified_at, last_sync_at")
      .single();
    if (error) setMsg(error.message);
    else if (data) {
      setLink(data as AosLink);
      setCode("");
      setMsg("Link code saved.");
    }
    setSaving(false);
  }

  return (
    <Container>
      <PageHeader
        eyebrow="Account"
        title="Profile, AOS link & billing."
        lede="Your Contractor Circle membership, the AOS account it's wired to, and billing details."
      />

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        {/* Profile */}
        <div className="rounded-2xl border border-border bg-card p-7">
          <p className="label-mono">Profile</p>
          <dl className="mt-4 space-y-3 text-sm">
            <Row k="Name" v={profile?.full_name ?? "—"} />
            <Row k="Email" v={profile?.email ?? user?.email ?? "—"} />
          </dl>
        </div>

        {/* Membership */}
        <div className="rounded-2xl border border-border bg-card p-7">
          <p className="label-mono">Membership</p>
          <dl className="mt-4 space-y-3 text-sm">
            <Row k="Plan" v="Contractor Circle" />
            <Row k="Rate" v="$497 / month" />
            <Row k="Status" v="Active" />
          </dl>
          <BillingActions />
        </div>
      </div>

      {/* Company */}
      <div className="mt-5 rounded-2xl border border-border bg-card p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label-mono">Company</p>
            <h3 className="mt-2 font-display text-xl">
              Name, address & greeting icon.
            </h3>
            <p className="mt-1 max-w-xl text-[13px] text-muted-foreground">
              How Marshall greets you on the command center.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Company name
            </label>
            <div className="relative mt-2">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={coName}
                onChange={(e) => setCoName(e.target.value)}
                placeholder="ACME Construction Co."
                className="w-full rounded-md border border-border bg-background pl-10 pr-3 py-2.5 text-[14px] focus:border-ink focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Address <span className="text-muted-foreground/60">· optional</span>
            </label>
            <input
              value={coAddress}
              onChange={(e) => setCoAddress(e.target.value)}
              placeholder="123 Main St, Vancouver, BC"
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2.5 text-[14px] focus:border-ink focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6">
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Greeting icon
          </label>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {GREETING_ICONS.map(({ key, label, Icon }) => {
              const active = coIcon === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCoIcon(key)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-all ${
                    active
                      ? "border-ink bg-ink text-cream shadow-sm"
                      : "border-border bg-background text-foreground/70 hover:border-foreground/40 hover:bg-muted"
                  }`}
                  aria-pressed={active}
                  aria-label={label}
                >
                  <Icon className="text-[1.75rem]" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em]">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <button
            onClick={saveCompany}
            disabled={coSaving}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-cream hover:opacity-90 disabled:opacity-50"
          >
            {coSaving ? "Saving…" : "Save changes"}
          </button>
          {coMsg && (
            <p className="text-[12px] text-foreground/70">{coMsg}</p>
          )}
        </div>
      </div>

      {/* AOS link */}
      <div className="mt-5 rounded-2xl border border-border bg-card p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label-mono">AOS connection</p>
            <h3 className="mt-2 font-display text-xl">Link your AOS account.</h3>
            <p className="mt-1 max-w-xl text-[13px] text-muted-foreground">
              Your scorecard, rocks, and open issues will surface inside the Command Center once linked.
              Try email match first — paste a link code if your AOS email is different.
            </p>
          </div>
          <a
            href={AOS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-[12px] hover:bg-muted"
          >
            Open AOS <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-background p-5">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-foreground/70" />
              <p className="font-display text-[14px]">Match by email</p>
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Use the same email you sign into AOS with: <span className="text-foreground">{user?.email}</span>
            </p>
            <button
              onClick={useEmailMatch}
              disabled={saving}
              className="mt-4 inline-flex rounded-md bg-ink px-3 py-1.5 text-[12px] text-cream hover:opacity-90 disabled:opacity-50"
            >
              Use this email
            </button>
            {link?.aos_email && !link.link_code && (
              <p className="mt-3 text-[11px] text-foreground/70">
                Linked to <span className="font-medium">{link.aos_email}</span>
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-background p-5">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-foreground/70" />
              <p className="font-display text-[14px]">Paste link code</p>
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Generate a code inside AOS → Settings, then paste it here.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. AOS-XXXX-XXXX"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-[12px] focus:border-ink focus:outline-none"
              />
              <button
                onClick={saveLinkCode}
                disabled={saving || !code.trim()}
                className="rounded-md bg-ink px-3 py-2 text-[12px] text-cream hover:opacity-90 disabled:opacity-50"
              >
                Save
              </button>
            </div>
            {link?.link_code && (
              <p className="mt-3 text-[11px] text-foreground/70">
                Code on file: <span className="font-mono">{link.link_code}</span>
              </p>
            )}
          </div>
        </div>

        {!(link?.aos_email || link?.link_code) && (
          <div className="mt-5 flex flex-wrap items-center gap-2 rounded-md bg-foreground/[0.03] px-3 py-2 text-[11px] text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>
              AOS data sync is wiring up — once the AOS endpoint is live, your scorecard and rocks will surface on Home and in the Vault.
            </span>
          </div>
        )}

        {msg && <p className="mt-3 text-[12px] text-foreground/70">{msg}</p>}
      </div>
    </Container>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2 last:border-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}

function BillingActions() {
  const portalFn = useServerFn(createBillingPortalSession);
  const submitFn = useServerFn(submitBillingQuestion);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("Billing question");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function openPortal() {
    setLoading(true);
    setErr(null);
    try {
      const { url } = await portalFn();
      window.location.assign(url);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : "Could not open billing portal.";
      setErr(m);
      setLoading(false);
    }
  }

  async function send() {
    if (!message.trim()) return;
    setSending(true);
    try {
      await submitFn({ data: { subject: subject.trim() || "Billing question", message: message.trim() } });
      setSent(true);
      setMessage("");
      setTimeout(() => { setOpen(false); setSent(false); }, 1400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-6 border-t border-border pt-5">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={openPortal}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-cream hover:opacity-90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
          {loading ? "Opening…" : "Manage subscription"}
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm hover:bg-muted"
        >
          Billing question
        </button>
      </div>
      {err && <p className="mt-3 text-[12px] text-foreground/70">{err}</p>}

      {open && (
        <div className="mt-4 rounded-xl border border-border bg-background p-4">
          {sent ? (
            <p className="flex items-center gap-2 text-[13px] text-foreground/80">
              <Check className="h-4 w-4 text-signal" /> Sent. Marshall's team will follow up by email.
            </p>
          ) : (
            <>
              <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] focus:border-ink focus:outline-none"
              />
              <label className="mt-3 block font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Question</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Refund, invoice, plan change, dispute…"
                className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] focus:border-ink focus:outline-none"
              />
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={send}
                  disabled={sending || !message.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12px] text-cream hover:opacity-90 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

