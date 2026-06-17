import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { requestMemberMagicLink } from "@/lib/magic-link.functions";

export const Route = createFileRoute("/magic-link")({
  head: () => ({
    meta: [
      { title: "Send me a magic link — ALP Contractor Circle" },
      {
        name: "description",
        content: "Enter your email and we'll send a one-click sign-in link to your inbox.",
      },
    ],
  }),
  component: MagicLinkPage,
});

function MagicLinkPage() {
  const requestMagicLink = useServerFn(requestMemberMagicLink);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await requestMagicLink({ data: { email: email.trim() } });
      setSent(true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-serif tracking-tight">Send me a magic link</h1>
          <p className="text-sm text-muted-foreground">
            We'll email you a one-click sign-in link. No password needed.
          </p>
        </header>

        {sent ? (
          <div className="rounded-lg border bg-card p-6 text-center space-y-3">
            <p className="text-base">
              If <strong>{email}</strong> is an active member, a sign-in link is on its way. Check
              your inbox and spam folder.
            </p>
            <p className="text-xs text-muted-foreground">
              Didn't get it after a minute?{" "}
              <button type="button" className="underline" onClick={() => setSent(false)}>
                Try again
              </button>
              .
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-card p-6">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Email</span>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
            >
              {busy ? "Sending..." : "Send magic link"}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              Prefer a password?{" "}
              <Link to="/login" className="underline">
                Sign in here
              </Link>
              .
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
