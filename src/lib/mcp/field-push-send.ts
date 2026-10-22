// Sends one Web Push message. Keys are read from the environment at call time and are not logged.
import { VAPID_SUBJECT, vapidConfig, type PushCandidate } from "./field-push";

export type PushMessage = { title: string; body: string; url: string };

export async function sendFieldPush(row: Pick<PushCandidate, "endpoint" | "p256dh" | "auth">, message: PushMessage, env: Record<string, string | undefined> = process.env): Promise<"sent" | "unconfigured"> {
  const keys = vapidConfig(env);
  if (!keys) return "unconfigured";
  const webpush = await import("web-push");
  webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
  await webpush.sendNotification(
    { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
    JSON.stringify(message),
  );
  return "sent";
}
