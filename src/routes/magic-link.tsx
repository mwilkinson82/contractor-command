import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AuthCard, AuthField, AuthSubmit } from "@/components/auth/auth-card";
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
  const [isHydrated, setIsHydrated] = useState(false);

  function requestMagicLinkWithTimeout(emailAddress: string) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("That took too long. Please try again.")),
        18_000,
      );
    });

    return Promise.race([requestMagicLink({ data: { email: emailAddress } }), timeout]).finally(
      () => {
        if (timeoutId) clearTimeout(timeoutId);
      },
    );
  }

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !isHydrated) return;
    setBusy(true);
    setErr(null);
    try {
      await requestMagicLinkWithTimeout(email.trim());
      setSent(true);
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={sent ? "Check your inbox." : "Email me a secure link."}
      subtitle={
        sent
          ? `If ${email} is attached to active access, the newest sign-in link is on its way.`
          : "Use the email attached to your Hub, Handbook, AOS, or OverWatch access."
      }
    >
      {sent ? (
        <div>
          <div className="rounded-xl border border-border bg-muted/45 p-5 text-[13px] leading-relaxed text-foreground/75">
            Check your inbox and spam folder. Open the newest email only; each secure link works
            once.
          </div>
          <button
            type="button"
            className="mx-auto mt-5 block text-[12px] font-medium text-clay hover:underline"
            onClick={() => setSent(false)}
          >
            Try again
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          <AuthField
            id="magic-email"
            label="Work email"
            type="email"
            required
            autoFocus
            value={email}
            onChange={setEmail}
            placeholder="name@company.com"
          />
          {err && <p className="text-[12px] text-[color:var(--danger-warm)]">{err}</p>}
          <AuthSubmit
            busy={busy || !isHydrated}
            label={isHydrated ? "Email my secure link" : "Loading"}
            busyLabel={isHydrated ? "Sending secure link" : "Loading"}
          />
          <p className="text-center text-[12px] text-muted-foreground">
            Prefer a password?{" "}
            <Link to="/login" className="font-medium text-foreground hover:underline">
              Sign in here
            </Link>
          </p>
        </form>
      )}
    </AuthCard>
  );
}
