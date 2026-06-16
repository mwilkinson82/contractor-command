import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Container } from "@/components/portal/page-header";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  sendMemberAnnouncement,
  previewMemberAnnouncementAudience,
  getLastMemberAnnouncement,
} from "@/lib/announce.functions";
import { Megaphone, Send, Users, AlertTriangle } from "lucide-react";

type Audience = "active" | "all_with_login";

const DRAFT_KEY = "admin.announce.draft.v1";

type Draft = {
  subject: string;
  headline: string;
  preheader: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  signoff: string;
  audience: Audience;
};

export const Route = createFileRoute("/admin/announce")({
  head: () => ({ meta: [{ title: "Announce — Admin" }] }),
  component: AnnouncePage,
});

function AnnouncePage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (isAdmin === false) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  // Load any in-progress draft from localStorage so a crash / accidental
  // navigation can't erase what was typed.
  const initial = readDraft();

  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [headline, setHeadline] = useState(initial?.headline ?? "");
  const [preheader, setPreheader] = useState(initial?.preheader ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [ctaLabel, setCtaLabel] = useState(initial?.ctaLabel ?? "");
  const [ctaUrl, setCtaUrl] = useState(initial?.ctaUrl ?? "");
  const [signoff, setSignoff] = useState(initial?.signoff ?? "— Marshall");
  const [audience, setAudience] = useState<Audience>(
    initial?.audience ?? "all_with_login",
  );
  const [confirmText, setConfirmText] = useState("");
  const [hydratedFromServer, setHydratedFromServer] = useState(!!initial);

  const previewFn = useServerFn(previewMemberAnnouncementAudience);
  const sendFn = useServerFn(sendMemberAnnouncement);
  const lastFn = useServerFn(getLastMemberAnnouncement);

  // Always fetch the most recent saved announcement so the user can pull it
  // back into the form on demand, even if a stale local draft is in the way.
  const { data: lastSent } = useQuery({
    queryKey: ["announce-last"],
    queryFn: () => lastFn(),
    enabled: !!isAdmin,
  });

  // First-load auto-hydrate (only when there was no local draft).
  useEffect(() => {
    if (hydratedFromServer) return;
    const a = lastSent?.announcement;
    if (!a) return;
    setSubject(a.subject ?? "");
    setHeadline(a.headline ?? "");
    setPreheader(a.preheader ?? "");
    setBody(a.body ?? "");
    setCtaLabel(a.cta_label ?? "");
    setCtaUrl(a.cta_url ?? "");
    setSignoff(a.signoff ?? "— Marshall");
    if (a.audience === "active" || a.audience === "all_with_login") {
      setAudience(a.audience);
    }
    setHydratedFromServer(true);
  }, [lastSent, hydratedFromServer]);

  const loadLastSent = () => {
    const a = lastSent?.announcement;
    if (!a) {
      toast.error("No previous announcement saved yet.");
      return;
    }
    setSubject(a.subject ?? "");
    setHeadline(a.headline ?? "");
    setPreheader(a.preheader ?? "");
    setBody(a.body ?? "");
    setCtaLabel(a.cta_label ?? "");
    setCtaUrl(a.cta_url ?? "");
    setSignoff(a.signoff ?? "— Marshall");
    if (a.audience === "active" || a.audience === "all_with_login") {
      setAudience(a.audience);
    }
    toast.success("Loaded most recent announcement");
  };

  // Autosave the draft on every change so nothing is ever lost again.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const draft: Draft = {
      subject,
      headline,
      preheader,
      body,
      ctaLabel,
      ctaUrl,
      signoff,
      audience,
    };
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [subject, headline, preheader, body, ctaLabel, ctaUrl, signoff, audience]);

  const { data: audienceCount, isLoading: countLoading } = useQuery({
    queryKey: ["announce-audience", audience],
    queryFn: () => previewFn({ data: { audience } }),
    enabled: !!isAdmin,
  });

  const sendMutation = useMutation({
    mutationFn: (vars: { mode: "test" | "all" }) =>
      sendFn({
        data: {
          subject,
          headline,
          preheader: preheader || undefined,
          body,
          ctaLabel: ctaLabel || undefined,
          ctaUrl: ctaUrl || undefined,
          signoff: signoff || undefined,
          audience: vars.mode === "test" ? "test" : audience,
          testEmail:
            vars.mode === "test" ? (user?.email ?? undefined) : undefined,
        },
      }),
    onSuccess: (res, vars) => {
      if (vars.mode === "test") {
        toast.success(`Test queued to ${user?.email}`);
      } else {
        toast.success(
          `Queued ${res.queued} of ${res.total}. Suppressed: ${res.suppressed}. Failed: ${res.failed}.`,
        );
        setConfirmText("");
      }
    },
    onError: (err: Error) => toast.error(err.message ?? "Send failed"),
  });

  const canSendAll = useMemo(
    () => confirmText.trim().toUpperCase() === "SEND",
    [confirmText],
  );

  if (isAdmin === null) {
    return (
      <Container className="py-10">
        <p className="text-sm text-muted-foreground">Checking access…</p>
      </Container>
    );
  }
  if (!isAdmin) return null;

  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="label-mono inline-flex items-center gap-1.5">
            <Megaphone className="h-3 w-3" /> Admin · Announce
          </p>
          <h1
            className="mt-2 font-display text-3xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Send a member-wide announcement
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">
            Composes a one-off branded email and drops one copy per member into
            the queue. Suppressed addresses are skipped automatically. Always
            send a test to yourself first.
          </p>
        </div>
        <Link
          to="/admin"
          className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-muted"
        >
          ← Back to admin
        </Link>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Composer */}
        <div className="space-y-4">
          <Field label="Subject">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={255}
            />
          </Field>
          <Field label="Preheader (inbox preview text)">
            <Input
              value={preheader}
              onChange={(e) => setPreheader(e.target.value)}
              maxLength={200}
            />
          </Field>
          <Field label="Headline (top of email)">
            <Input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={160}
            />
          </Field>
          <Field label="Body (blank lines separate paragraphs)">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              maxLength={8000}
              className="font-mono text-[13px]"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CTA button label (optional)">
              <Input
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
                maxLength={60}
              />
            </Field>
            <Field label="CTA button URL (optional)">
              <Input
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https://…"
                maxLength={500}
              />
            </Field>
          </div>
          <Field label="Sign-off">
            <Input
              value={signoff}
              onChange={(e) => setSignoff(e.target.value)}
              maxLength={120}
            />
          </Field>
        </div>

        {/* Send panel */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="label-mono inline-flex items-center gap-1.5">
              <Users className="h-3 w-3" /> Audience
            </p>
            <div className="mt-3 space-y-2 text-[13px]">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="audience"
                  className="mt-1"
                  checked={audience === "active"}
                  onChange={() => setAudience("active")}
                />
                <span>
                  <span className="font-medium">Active members only</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Anyone with active/trialing/comped access or admin role.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="audience"
                  className="mt-1"
                  checked={audience === "all_with_login"}
                  onChange={() => setAudience("all_with_login")}
                />
                <span>
                  <span className="font-medium">
                    Everyone in the portal + paid subs
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    All profiles plus every Stripe subscription (claimed or not).
                  </span>
                </span>
              </label>
            </div>
            <div className="mt-4 rounded-md bg-muted/40 px-3 py-2 text-[12px]">
              Will queue to{" "}
              <span className="font-display text-base">
                {countLoading ? "…" : (audienceCount?.count ?? 0)}
              </span>{" "}
              recipient
              {audienceCount?.count === 1 ? "" : "s"}.
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="label-mono">Send a test first</p>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Sends one copy to <span className="font-mono">{user?.email}</span>.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3 w-full"
              disabled={sendMutation.isPending || !subject || !body}
              onClick={() => sendMutation.mutate({ mode: "test" })}
            >
              <Send className="mr-2 h-4 w-4" /> Send test to me
            </Button>
          </div>

          <div className="rounded-2xl border border-destructive/40 bg-card p-5">
            <p className="label-mono inline-flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="h-3 w-3" /> Send to everyone
            </p>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Type <span className="font-mono font-semibold">SEND</span> to
              confirm. There is no undo.
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type SEND"
              className="mt-3"
            />
            <Button
              type="button"
              className="mt-3 w-full"
              disabled={
                sendMutation.isPending ||
                !canSendAll ||
                !subject ||
                !body ||
                (audienceCount?.count ?? 0) === 0
              }
              onClick={() => sendMutation.mutate({ mode: "all" })}
            >
              <Send className="mr-2 h-4 w-4" />
              {sendMutation.isPending
                ? "Queuing…"
                : `Queue to ${audienceCount?.count ?? 0} member${
                    audienceCount?.count === 1 ? "" : "s"
                  }`}
            </Button>
          </div>
        </div>
      </div>
    </Container>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="label-mono">{label}</Label>
      {children}
    </div>
  );
}

function readDraft(): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (!parsed || typeof parsed !== "object") return null;
    // Require *something* to count as a draft.
    if (!parsed.subject && !parsed.body && !parsed.headline) return null;
    return {
      subject: parsed.subject ?? "",
      headline: parsed.headline ?? "",
      preheader: parsed.preheader ?? "",
      body: parsed.body ?? "",
      ctaLabel: parsed.ctaLabel ?? "",
      ctaUrl: parsed.ctaUrl ?? "",
      signoff: parsed.signoff ?? "— Marshall",
      audience:
        parsed.audience === "active" || parsed.audience === "all_with_login"
          ? parsed.audience
          : "all_with_login",
    };
  } catch {
    return null;
  }
}
