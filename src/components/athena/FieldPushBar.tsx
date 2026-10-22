import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { iosPushHint } from "@/lib/mcp/field-push";

const NAVY = "#1E3A5F";
const BLUE = "#1E5FED";
const GRAY = "#6B7280";

async function authHeader(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? `Bearer ${token}` : null;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Install and notification controls for the field page only. */
export function FieldPushBar({ jobId, jobNumber }: { jobId: string; jobNumber?: string | null }) {
  const [hint, setHint] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setHint(iosPushHint(navigator.userAgent, standalone));
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = `/api/athena/field-push?manifest=1&job=${encodeURIComponent(jobId)}`;
    link.setAttribute("data-athena-field", "1");
    document.head.appendChild(link);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/athena-field-sw.js");
    }
    return () => {
      link.remove();
    };
  }, [jobId]);

  async function enable() {
    setBusy(true);
    setNote(null);
    try {
      const header = await authHeader();
      if (!header) {
        setNote("Sign in to turn on reminders.");
        return;
      }
      if (hint) return;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setNote("Notifications stay off until you allow them.");
        return;
      }
      const keyRes = await fetch("/api/athena/field-push?vapid=1", { headers: { Authorization: header } });
      const keyBody = (await keyRes.json()) as { publicKey?: string; error?: string };
      if (!keyRes.ok || !keyBody.publicKey) {
        setNote(keyBody.error || "Reminders are not configured yet.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyBody.publicKey) as BufferSource });
      const json = sub.toJSON();
      const saved = await fetch("/api/athena/field-push", {
        method: "POST",
        headers: { Authorization: header, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "subscribe", jobId, subscription: json }),
      });
      const body = (await saved.json()) as { error?: string };
      setNote(saved.ok ? "Daily reminders are on for this job." : body.error || "Could not save the reminder.");
    } catch {
      setNote("Could not turn on reminders.");
    } finally {
      setBusy(false);
    }
  }

  async function testNow() {
    setBusy(true);
    setNote(null);
    try {
      const header = await authHeader();
      if (!header) {
        setNote("Sign in to send a test.");
        return;
      }
      const res = await fetch("/api/athena/field-push", {
        method: "POST",
        headers: { Authorization: header, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", jobId }),
      });
      const body = (await res.json()) as { error?: string; sent?: number };
      setNote(res.ok ? `Test sent (${body.sent ?? 0}).` : body.error || "Test was not sent.");
    } catch {
      setNote("Test was not sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: "12px 16px 0", fontFamily: "system-ui, sans-serif" }}>
      {hint ? <p style={{ margin: "0 0 8px", color: GRAY, fontSize: 14 }}>{hint}</p> : null}
      <button type="button" onClick={() => void enable()} disabled={busy} style={{ background: BLUE, color: "#fff", border: 0, borderRadius: 8, padding: "10px 14px", fontWeight: 700 }}>
        Enable daily reminders
      </button>
      {jobNumber === "2701" ? (
        <button type="button" onClick={() => void testNow()} disabled={busy} style={{ marginLeft: 8, background: "#fff", color: NAVY, border: `1px solid ${GRAY}`, borderRadius: 8, padding: "10px 14px", fontWeight: 700 }}>
          Send test notification now
        </button>
      ) : null}
      {note ? <p style={{ margin: "8px 0 0", color: NAVY, fontSize: 14 }}>{note}</p> : null}
    </div>
  );
}
