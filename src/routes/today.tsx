import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BoardSignIn } from "@/components/athena/BoardSignIn";
import { MorningBriefPushBar } from "@/components/athena/MorningBriefPushBar";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/today")({
  head: () => ({
    meta: [
      { title: "Today — Athena" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TodayPage,
});

function TodayPage() {
  const { session, loading } = useAuth();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    void (async () => {
      try {
        const token = session.access_token;
        const res = await fetch("/api/athena/morning-brief", { headers: { Authorization: `Bearer ${token}` } });
        const body = (await res.json()) as { html?: string; error?: string };
        if (!alive) return;
        if (!res.ok || !body.html) {
          setError(body.error || "Could not open today's brief.");
          return;
        }
        setHtml(body.html);
      } catch {
        if (alive) setError("Could not open today's brief.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [session]);

  if (loading) return <div style={{ padding: 32, color: "#6B7280" }}>Loading…</div>;
  if (!session) return <BoardSignIn returnTo="/today" />;
  return <TodayBriefView html={html} error={error} />;
}

export function TodayBriefView({ html, error }: { html: string | null; error: string | null }) {
  return (
    <div data-screen="today" style={{ background: "#F3F4F6", minHeight: "100vh" }}>
      <MorningBriefPushBar showBoardLink={false} />
      {error ? (
        <p style={{ maxWidth: 640, margin: "16px auto", color: "#1E3A5F" }}>{error}</p>
      ) : html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div style={{ padding: 32, color: "#6B7280" }}>Loading…</div>
      )}
    </div>
  );
}
