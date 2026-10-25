import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { requestMemberMagicLink } from "@/lib/magic-link.functions";
import { signInReturn, continueBoardSignIn, BOARD_SIGN_IN_TITLE } from "@/lib/board-sign-in";
import { boundedStep, ConsentStepError } from "@/lib/consent-loading";
import { normalizeOtpCode } from "@/lib/login-otp";
import { ATHENA_LOGIN_LOGO } from "@/lib/login-copy";

const NAVY = "#1E3A5F";
const BLUE = "#2563EB";
const GRAY = "#6B7280";
const GRAY_SOFT = "#9CA3AF";
const LINE = "#D1D5DB";
const PAPER = "#F3F4F6";
const DANGER = "#B91C1C";

/**
 * Athena email-code sign-in for a job board. The code is typed on this page.
 * After it works, the browser returns only to the validated board path.
 */
export function BoardSignIn({ returnTo }: { returnTo: string }) {
  const requestCode = useServerFn(requestMemberMagicLink);
  const safeReturn = signInReturn(returnTo);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);

  async function onEmail(event: FormEvent) {
    event.preventDefault();
    if (busy || !safeReturn) return;
    setBusy(true);
    setErr(null);
    try {
      await boundedStep("session", () =>
        requestCode({ data: { email: email.trim(), return_to: safeReturn } }),
      );
      setSent(true);
    } catch (error) {
      setErr(
        error instanceof ConsentStepError && error.kind === "timeout"
          ? "Requesting a code took too long. Please try again."
          : "We could not confirm your request. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onCode(event: FormEvent) {
    event.preventDefault();
    const token = normalizeOtpCode(code);
    const next = signInReturn(safeReturn);
    if (busy || !next) return;
    if (!token) {
      setErr("Enter the code from the email.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { data, error } = await boundedStep("session", () =>
        supabase.auth.verifyOtp({ email: email.trim(), token, type: "email" }),
      );
      if (error) throw error;
      if (!data.session?.access_token || !data.session.user?.id)
        throw new Error("No verified session");
      setConfirmed(true);
      setConfirmedEmail(data.session.user.email ?? null);
      continueBoardSignIn(next, window.location);
    } catch (error) {
      setErr(
        error instanceof ConsentStepError && error.kind === "timeout"
          ? "Checking your code took too long. Try again, or request a new code."
          : "That code didn't work. Use the newest email, or request a new code.",
      );
    } finally {
      // Navigation may be delayed or blocked. Never leave this form disabled
      // after verification has settled, including a successful same-page return.
      setBusy(false);
    }
  }

  return (
    <div style={{ background: PAPER, minHeight: "100vh", padding: "48px 16px" }}>
      <main
        data-screen="board-sign-in"
        data-return-to={safeReturn ?? ""}
        style={{
          maxWidth: 480,
          margin: "0 auto",
          background: "#fff",
          border: `1px solid ${LINE}`,
          borderRadius: 12,
          padding: 32,
          color: GRAY,
        }}
      >
        <img
          src={ATHENA_LOGIN_LOGO}
          alt="Athena powered by ALP"
          style={{ display: "block", height: 40, width: "auto", margin: "0 0 24px" }}
        />
        <h1 style={{ margin: "0 0 12px", fontSize: 22, lineHeight: 1.3, color: NAVY }}>
          {BOARD_SIGN_IN_TITLE}
        </h1>
        <p style={{ margin: "0 0 20px", lineHeight: 1.5 }}>
          No password required. Use the email associated with your Athena account. We'll send a code
          you can type here.
        </p>
        {safeReturn ? (
          confirmed ? (
            <div role="status">
              <p style={{ margin: "0 0 16px" }}>You're signed in. Continue to your page.</p>
              {confirmedEmail ? (
                <p style={{ marginBottom: 16 }}>Browser account: {confirmedEmail}</p>
              ) : null}
              <button
                type="button"
                onClick={() => continueBoardSignIn(safeReturn, window.location)}
                style={{
                  border: 0,
                  borderRadius: 8,
                  background: BLUE,
                  color: "#fff",
                  padding: "12px 20px",
                }}
              >
                Continue
              </button>
            </div>
          ) : sent ? (
            <form onSubmit={onCode}>
              <p style={{ margin: "0 0 16px", lineHeight: 1.5 }}>
                Check your inbox and spam folder. Open the newest email only; each code works once.
              </p>
              <label htmlFor="board-otp" style={{ display: "block", fontSize: 12, color: GRAY }}>
                Type the code from the email
              </label>
              <input
                id="board-otp"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="12345678"
                required
                style={{
                  marginTop: 8,
                  height: 44,
                  width: "100%",
                  boxSizing: "border-box",
                  border: `1px solid ${LINE}`,
                  borderRadius: 8,
                  padding: "0 12px",
                  fontSize: 16,
                  color: NAVY,
                }}
              />
              {err ? (
                <p role="alert" style={{ margin: "12px 0 0", fontSize: 13, color: DANGER }}>
                  {err}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={busy}
                style={{
                  marginTop: 16,
                  height: 44,
                  width: "100%",
                  border: 0,
                  borderRadius: 8,
                  background: BLUE,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: busy ? "default" : "pointer",
                }}
              >
                {busy ? "Checking code" : "Continue"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setCode("");
                  setErr(null);
                  setSent(false);
                }}
                style={{ marginTop: 16, border: 0, background: "transparent", color: BLUE }}
              >
                Request a new code or use another email
              </button>
            </form>
          ) : (
            <form onSubmit={onEmail}>
              <label htmlFor="board-email" style={{ display: "block", fontSize: 12, color: GRAY }}>
                Work email
              </label>
              <input
                id="board-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="name@company.com"
                required
                style={{
                  marginTop: 8,
                  height: 44,
                  width: "100%",
                  boxSizing: "border-box",
                  border: `1px solid ${LINE}`,
                  borderRadius: 8,
                  padding: "0 12px",
                  fontSize: 16,
                  color: NAVY,
                }}
              />
              {err ? (
                <p role="alert" style={{ margin: "12px 0 0", fontSize: 13, color: DANGER }}>
                  {err}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={busy}
                style={{
                  marginTop: 16,
                  height: 44,
                  width: "100%",
                  border: 0,
                  borderRadius: 8,
                  background: BLUE,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: busy ? "default" : "pointer",
                }}
              >
                {busy ? "Sending code" : "Email me a sign-in code"}
              </button>
            </form>
          )
        ) : (
          <p style={{ margin: 0 }}>This page can't be opened from here.</p>
        )}
        <p style={{ margin: "24px 0 0", fontSize: 12, color: GRAY_SOFT }}>Athena powered by ALP</p>
      </main>
    </div>
  );
}
