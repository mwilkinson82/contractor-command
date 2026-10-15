import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { sendCircleWelcomeBackfill } from "@/lib/email/circle-welcome.functions";

export function CircleWelcomeSender() {
  const send = useServerFn(sendCircleWelcomeBackfill);
  const [email, setEmail] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [result, setResult] = useState("");
  const inFlight = useRef(false);

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4" aria-labelledby="welcome-heading">
      <h2 id="welcome-heading" className="font-medium">Send Circle welcome</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Sends one welcome email with a sign-in link through the Hub mailer. Use the same request key when retrying an uncertain result to prevent another email.
      </p>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={async (event) => {
        event.preventDefault();
        if (inFlight.current || finished) return;
        inFlight.current = true;
        setBusy(true);
        setResult("");
        try {
          const response = await send({ data: { email: email.trim().toLowerCase(), idempotencyKey: requestKey.trim() } });
          setFinished(response.status !== "failed");
          setResult(response.status === "queued"
            ? `Queued for ${email.trim().toLowerCase()}. Delivery is not yet confirmed. Message ID: ${response.messageId}`
            : response.status === "duplicate"
              ? "This request is already queued or sent. No additional email was queued."
              : response.status === "suppressed"
                ? "Not sent: recipient is suppressed or unsubscribed."
                : `Not queued: ${response.reason ?? "mailer error"}. Keep the same request key for any retry.`);
        } catch {
          setResult("The result could not be confirmed. Keep the same recipient and request key for any retry.");
        } finally {
          inFlight.current = false;
          setBusy(false);
        }
      }}>
        <label className="grid gap-1 text-sm">Welcome recipient
          <input className="rounded-md border border-border bg-background px-3 py-2" type="email" required value={email} disabled={busy || finished} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">Welcome request key
          <input className="rounded-md border border-border bg-background px-3 py-2" required minLength={1} maxLength={200} value={requestKey} disabled={busy || finished} onChange={(event) => setRequestKey(event.target.value)} />
        </label>
        <button className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50" type="submit" disabled={busy || finished || !email.trim() || !requestKey.trim()}>
          {busy ? "Queueing welcome…" : "Send one welcome email"}
        </button>
      </form>
      {result && <p className="mt-3 text-sm" role="status">{result}</p>}
    </section>
  );
}
