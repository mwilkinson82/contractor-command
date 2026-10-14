import { createHash } from "node:crypto";
import { z } from "zod";
import { loadSession } from "./store.server";
import { assertAnnounceable, sessionHubUrl, sessionLabel, sessionSelectionSchema } from "./model";

export const announcementSessionFields = {
  mode: z.enum(["general", "call"]).default("general"),
  session: sessionSelectionSchema.optional(),
  previewHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
};
type Content = {
  mode: "general" | "call";
  session?: { id: string; version: number };
  subject: string;
  headline: string;
  preheader?: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  signoff?: string;
};
export async function resolveAnnouncement(db: unknown, input: Content) {
  if (input.mode === "general" && input.session)
    throw new Error("General announcements cannot include a session");
  // A pasted Meet URL defeats the Hub membership check, including in Markdown/images.
  if (
    /meet\.google\.com/i.test(
      [
        input.subject,
        input.headline,
        input.preheader,
        input.body,
        input.ctaUrl,
        input.ctaLabel,
        input.signoff,
      ].join("\n"),
    )
  )
    throw new Error("Use the Hub link instead of pasting a Meet URL into an announcement");
  let callSession: { title: string; details: string; hubUrl: string } | undefined;
  let snapshot: Record<string, unknown> | null = null;
  if (input.mode === "call") {
    if (!input.session) throw new Error("Select and preview a confirmed session");
    const row = await loadSession(db, input.session.id);
    assertAnnounceable(row, input.session.version);
    callSession = { title: row.title, details: sessionLabel(row), hubUrl: sessionHubUrl(row.id) };
    snapshot = {
      id: row.id,
      version: row.version,
      starts_at: row.starts_at,
      time_zone: row.time_zone,
      duration_min: row.duration_min,
      ...callSession,
    };
  }
  const props = {
    headline: input.headline,
    preheader: input.preheader,
    body: input.body,
    ctaLabel: input.ctaLabel,
    ctaUrl: input.ctaUrl,
    signoff: input.signoff,
    callSession,
  };
  const hash = createHash("sha256")
    .update(JSON.stringify({ subject: input.subject, props, snapshot }))
    .digest("hex");
  return { props, snapshot, hash };
}
