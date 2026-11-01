import { useEffect, useRef, useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logoPublicUrl, type Company } from "@/hooks/use-company";
import { GREETING_ICONS, type GreetingIconKey } from "@/components/portal/greeting-icon";

export type OrganizationProfileProps = {
  user: { id: string; email?: string } | null;
  company: Company | null;
  loading: boolean;
  error: string | null;
  workspaceName: string | null;
  refetch: () => Promise<unknown>;
};
const initial = (company: Company | null) => ({
  name: company?.name ?? "",
  address: company?.address ?? "",
  icon: (company?.greeting_icon ?? "wave") as GreetingIconKey,
});

/** Owner's account profile, separate from the selected Athena workspace. RLS remains authoritative. */
export function OrganizationProfile(props: OrganizationProfileProps) {
  const target = `${props.user?.id ?? "signed-out"}:${props.company?.id ?? "new"}`;
  const [draft, setDraft] = useState(() => ({ target, ...initial(props.company) }));
  const [logo, setLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const identity = useRef<string | null>(target);
  const inFlight = useRef<object | null>(null);
  identity.current = target;
  const sameTarget = draft.target === target;
  if (!sameTarget) {
    setDraft({ target, ...initial(props.company) });
    setLogo(null);
    setMessage(null);
    setBusy(false);
    inFlight.current = null;
  }
  useEffect(
    () => () => {
      identity.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!logo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(logo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const owner = props.user?.id;
  const available =
    sameTarget &&
    !!owner &&
    !props.loading &&
    !props.error &&
    (!props.company || props.company.owner_user_id === owner);
  function discard() {
    if (inFlight.current) return;
    setDraft({ target, ...initial(props.company) });
    setLogo(null);
    setMessage("Unsaved changes discarded.");
  }
  function chooseLogo(file?: File) {
    if (!available || identity.current !== target || inFlight.current || !file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Choose an image for your organization logo.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMessage("Keep the logo under 2 MB.");
      return;
    }
    setLogo(file);
    setMessage(null);
  }
  async function save() {
    if (!available || identity.current !== target || inFlight.current || !owner) return;
    if (!draft.name.trim()) {
      setMessage("Organization name is required.");
      return;
    }
    const attempt = {};
    inFlight.current = attempt;
    setBusy(true);
    setMessage(null);
    try {
      let path = props.company?.logo_path ?? null;
      if (logo) {
        const extension =
          (logo.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
        // A failed profile save must not overwrite the current profile's logo.
        path = `${owner}/logo-${crypto.randomUUID()}.${extension}`;
        const upload = await supabase.storage
          .from("company-logos")
          .upload(path, logo, { contentType: logo.type });
        if (upload.error) throw upload.error;
      }
      if (identity.current !== target) return;
      const result = await supabase.from("companies").upsert(
        {
          owner_user_id: owner,
          name: draft.name.trim(),
          address: draft.address.trim() || null,
          greeting_icon: draft.icon,
          logo_path: path,
        },
        { onConflict: "owner_user_id" },
      );
      if (result.error) throw result.error;
      if (identity.current !== target) return;
      setLogo(null);
      await props.refetch();
      if (identity.current === target) setMessage("Organization profile saved.");
    } catch {
      if (identity.current === target)
        setMessage(
          "Could not confirm the profile save. Reload the profile before retrying; your draft is still here.",
        );
    } finally {
      if (inFlight.current === attempt) inFlight.current = null;
      if (identity.current === target) setBusy(false);
    }
  }

  if (!props.user) return <p role="status">Sign in to manage your organization profile.</p>;
  if (props.loading || !sameTarget) return <p role="status">Loading your organization profile…</p>;
  if (!available)
    return (
      <div role="alert">
        <p>Your organization profile could not be loaded. Editing is unavailable.</p>
        <button type="button" onClick={() => void props.refetch()}>
          Reload profile
        </button>
      </div>
    );
  return (
    <section className="aa-card min-w-0 [overflow-wrap:anywhere] [&_*]:min-w-0" aria-label="Organization profile editor">
      <h3 className="text-lg font-semibold">Organization profile</h3>
      <div className="my-4 rounded-lg border border-[#D1D5DB] bg-[#F5F8FC] p-4 text-sm">
        <p>
          <strong>Profile:</strong> {props.company?.name || "New organization profile"}
        </p>
        <p>
          <strong>Account:</strong> {props.user.email || "Your signed-in account"}
        </p>
        {props.workspaceName && (
          <p>
            <strong>Athena workspace:</strong> {props.workspaceName}
          </p>
        )}
        <p className="mt-2">
          These organization details are saved to your account and shared with Contractor Circle.
          Workspace names, teams and job access are managed separately.
        </p>
      </div>
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <legend className="sr-only">Edit this account's organization profile</legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-sm">
            Organization name
            <input
              id="organization-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="mt-1 block w-full rounded-md border p-2"
              autoComplete="organization"
            />
          </label>
          <label className="text-sm">
            Address · optional
            <input
              id="organization-address"
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              className="mt-1 block w-full rounded-md border p-2"
              autoComplete="street-address"
            />
          </label>
        </div>
        <div>
          <p className="mb-2 text-sm">Greeting icon</p>
          <div
            role="group"
            aria-label="Greeting icon"
            className="grid grid-cols-3 gap-2 sm:grid-cols-6"
          >
            {GREETING_ICONS.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                aria-pressed={draft.icon === key}
                onClick={() => setDraft({ ...draft, icon: key })}
                className="rounded-lg border p-2"
              >
                <Icon className="mx-auto mb-1 h-6 w-6" />
                <span className="text-xs">{label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {preview || props.company?.logo_path ? (
            <img
              src={preview ?? logoPublicUrl(props.company?.logo_path) ?? undefined}
              alt="Organization logo preview"
              className="h-16 w-16 rounded-lg border object-cover"
            />
          ) : (
            <Building2 aria-hidden className="h-12 w-12 text-[#6B7280]" />
          )}
          <label className="text-sm">
            Logo · optional
            <input
              id="organization-logo"
              type="file"
              accept="image/*"
              onChange={(e) => {
                chooseLogo(e.target.files?.[0]);
                e.target.value = "";
              }}
              className="mt-1 block w-full max-w-full text-sm"
            />
            <span className="mt-1 block text-xs text-[#6B7280]">
              Image under 2 MB. Uploaded when you save this profile.
            </span>
          </label>
        </div>
        <div className="flex flex-wrap gap-3 border-t pt-4">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1E3A5F] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {busy ? "Saving…" : "Save organization profile"}
          </button>
          <button
            type="button"
            onClick={discard}
            disabled={busy}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            Cancel changes
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (inFlight.current) return;
              discard();
              window.location.hash = "overview";
            }}
            className="rounded-lg px-4 py-2 text-sm underline"
          >
            Back to account
          </button>
        </div>
      </fieldset>
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
      {message?.startsWith("Could not confirm") && (
        <button
          type="button"
          onClick={() => void props.refetch()}
          className="mt-2 text-sm underline"
        >
          Reload saved profile
        </button>
      )}
    </section>
  );
}
