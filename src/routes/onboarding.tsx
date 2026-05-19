import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCompany, logoPublicUrl } from "@/hooks/use-company";
import { Building2, Upload, Loader2, Image as ImageIcon } from "lucide-react";
import { GREETING_ICONS, type GreetingIconKey } from "@/components/portal/greeting-icon";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Set up your Command Center" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: OnboardingPage,
});

const BUCKET = "company-logos";

function OnboardingPage() {
  const { user } = useAuth();
  const { company, refetch } = useCompany();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [greetingIcon, setGreetingIcon] = useState<GreetingIconKey>("wave");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Hydrate from existing row if user lands here mid-onboarding
  useEffect(() => {
    if (!company) return;
    setName(company.name ?? "");
    setAddress(company.address ?? "");
    setLogoPath(company.logo_path);
    setLogoPreview(logoPublicUrl(company.logo_path));
    if (company.greeting_icon) {
      setGreetingIcon(company.greeting_icon as GreetingIconKey);
    }
  }, [company]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      setErr("Pick an image file (PNG, JPG, SVG).");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setErr("Keep logo under 2MB.");
      return;
    }
    setErr(null);
    setUploading(true);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${user.id}/logo.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) {
      setErr(error.message);
    } else {
      setLogoPath(path);
      // Bust browser cache on overwrite
      setLogoPreview(`${logoPublicUrl(path)}?v=${Date.now()}`);
    }
    setUploading(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setErr("Company name is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    const { error } = await supabase
      .from("companies")
      .upsert(
        {
          owner_user_id: user.id,
          name: trimmed,
          address: address.trim() || null,
          logo_path: logoPath,
          greeting_icon: greetingIcon,
        },
        { onConflict: "owner_user_id" },
      );
    if (error) {
      setErr(error.message);
      setSaving(false);
      return;
    }
    await refetch();
    // Hard nav so the root layout re-runs useCompany and sees the new row.
    // (useCompany state in this component is not shared with __root.)
    if (typeof window !== "undefined") {
      window.location.assign("/");
    } else {
      navigate({ to: "/" });
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto w-full max-w-xl">
        <p className="label-mono">Step 01 · Set up</p>
        <h1 className="mt-3 font-display text-[2rem] leading-tight sm:text-[2.5rem]">
          Let's set up your command center.
        </h1>
        <p className="mt-3 max-w-md text-[14px] text-muted-foreground">
          This becomes the frame around everything you see — your company's
          name, address, and logo. You can change it later in Account.
        </p>

        <form onSubmit={save} className="mt-10 space-y-6">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Company name
            </label>
            <div className="relative mt-2">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                placeholder="ACME Construction Co."
                className="w-full rounded-md border border-border bg-card pl-10 pr-3 py-2.5 text-[14px] focus:border-ink focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Address <span className="text-muted-foreground/60">· optional</span>
            </label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, Vancouver, BC"
              className="mt-2 w-full rounded-md border border-border bg-card px-3 py-2.5 text-[14px] focus:border-ink focus:outline-none"
            />
          </div>

          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Logo <span className="text-muted-foreground/60">· optional</span>
            </label>
            <div className="mt-2 flex items-center gap-4">
              <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-card">
                {logoPreview ? (
                  // Square-crop, center-fit — preview matches how the logo renders in the sidebar.
                  <img src={logoPreview} alt="Logo preview" className="h-full w-full object-cover object-center" />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
                )}
              </div>
              <div className="flex-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={onFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[12px] hover:bg-muted disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {logoPath ? "Replace logo" : "Upload logo"}
                </button>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  PNG, JPG, or SVG. Under 2MB. We center-crop to a square — upload tight to the mark for best results.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Greeting icon
            </label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Pick the icon Marshall greets you with on your dashboard.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {GREETING_ICONS.map(({ key, label, Icon }) => {
                const active = greetingIcon === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setGreetingIcon(key)}
                    className={`group flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-all ${
                      active
                        ? "border-ink bg-ink text-cream shadow-sm"
                        : "border-border bg-card text-foreground/70 hover:border-foreground/40 hover:bg-muted"
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

          {err && <p className="text-[12px] text-red-600">{err}</p>}

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
            <button
              type="submit"
              disabled={saving || uploading}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-5 py-2.5 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Enter the Command Center"}
            </button>
            <p className="text-[11px] text-muted-foreground">
              You can edit any of this later in Account → Company.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
