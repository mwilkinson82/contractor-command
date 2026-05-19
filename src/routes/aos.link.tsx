// AOS Link — escape hatch for the case where the member's AOS account lives
// under a different email than the one they use on Circle. They type in
// their AOS email; we verify it exists on AOS via the snapshot endpoint
// (same HMAC channel as the SSO mint), then store it in aos_links.aos_email
// so future "Enter AOS" clicks SSO into that account.

import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowUpRight, Check, Loader2 } from "lucide-react";
import { linkExistingAosAccount } from "@/lib/aos.functions";

export const Route = createFileRoute("/aos/link")({
  head: () => ({
    meta: [
      { title: "Link your AOS account — Circle" },
      {
        name: "description",
        content:
          "Link an existing AOS account that lives under a different email.",
      },
    ],
  }),
  component: AosLinkPage,
});

function AosLinkPage() {
  const link = useServerFn(linkExistingAosAccount);
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<"idle" | "linking" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [linkedTo, setLinkedTo] = useState<{ email: string; company: string | null } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPhase("linking");
    try {
      const res = await link({ data: { aosEmail: email } });
      if (!res.ok) {
        setError(res.error);
        setPhase("idle");
        return;
      }
      setLinkedTo({ email: res.aos_email, company: res.company_name });
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("idle");
    }
  };

  return (
    <div className="mx-auto max-w-xl px-6 py-16 sm:py-24">
      <Link
        to="/aos"
        className="inline-flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to AOS gateway
      </Link>

      <p className="label-mono mt-8">Link existing AOS</p>
      <h1 className="mt-3 font-display text-3xl tracking-tight sm:text-4xl">
        What email do you use on AOS?
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
        If your AOS account is under a different email than this Circle login,
        enter it here. We'll verify it exists and link the two so "Enter AOS"
        signs you straight in.
      </p>

      {phase !== "done" ? (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div>
            <label
              htmlFor="aos-email"
              className="label-mono block !text-muted-foreground"
            >
              Your AOS email
            </label>
            <input
              id="aos-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={phase === "linking"}
              placeholder="you@yourcompany.com"
              className="mt-2 w-full rounded-md border border-border bg-background px-4 py-3 text-[15px] outline-none ring-0 transition-colors focus:border-gold disabled:opacity-60"
            />
          </div>

          {error && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={phase === "linking" || !email}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-5 py-3 text-[14px] font-medium text-cream hover:opacity-90 disabled:opacity-60"
            >
              {phase === "linking" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying with AOS…
                </>
              ) : (
                <>Link my account</>
              )}
            </button>
            <Link
              to="/aos"
              className="text-[13px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Link>
          </div>

          <p className="pt-4 text-[12px] text-muted-foreground">
            We only check that the email is on AOS. We never see your AOS
            password — sign-in still happens through AOS.
          </p>
        </form>
      ) : (
        <div className="mt-8 rounded-2xl border border-border bg-card p-6">
          <p className="flex items-center gap-2 text-[13px] text-emerald-700">
            <Check className="h-4 w-4" /> Linked
          </p>
          <p className="mt-3 font-display text-xl">
            {linkedTo?.company ?? "Your AOS account"} is now connected.
          </p>
          <p className="mt-2 text-[14px] text-muted-foreground">
            Next time you click "Enter AOS", we'll sign you in as{" "}
            <span className="font-medium text-foreground">{linkedTo?.email}</span>.
          </p>
          <button
            type="button"
            onClick={() => navigate({ to: "/aos" })}
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-ink px-5 py-3 text-[14px] font-medium text-cream hover:opacity-90"
          >
            Enter AOS now <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
