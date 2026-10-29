import type { SupportInbox } from "./ticket.ts";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NAVY = "#0B1F3A";
const MARK = "#1E5FED";
const PAGE = "#EEF1F6";
const CARD = "#FFFFFF";
const INK = "#4A5568";
const MUTED = "#D6E0F0";

export const CIRCLE_LOGO_URL = "https://app.alpcontractorcircle.com/brand/circle-v1/email-ink.png";

export type RenderedMail = { html: string; text: string };

function shell(input: {
  inbox: SupportInbox;
  ticketNumber: string;
  heading: string;
  preview: string;
  paragraphs: string[];
  footer: string;
}): RenderedMail {
  const paragraphs = input.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:${INK};">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  const header =
    input.inbox.brand === "circle"
      ? `<table role="presentation" cellpadding="0" cellspacing="0">
<tr>
<td valign="middle"><img src="${CIRCLE_LOGO_URL}" width="200" height="53" alt="Contractor Circle" style="display:block;width:200px;height:53px;border:0;outline:none;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:${CARD};"></td>
<td valign="middle" style="padding-left:14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:1.3;color:${MUTED};">${escapeHtml(input.inbox.product)}</td>
</tr>
</table>`
      : `<table role="presentation" cellpadding="0" cellspacing="0">
<tr>
<td bgcolor="${MARK}" width="28" height="28" align="center" valign="middle" style="background:${MARK};width:28px;height:28px;border-radius:6px;text-align:center;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:28px;color:${CARD};">${escapeHtml(input.inbox.mark)}</td>
<td style="padding-left:12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:1.3;color:${CARD};">${escapeHtml(input.inbox.product)}</td>
</tr>
</table>`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.inbox.product)} ${escapeHtml(input.ticketNumber)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${PAGE}" style="background:${PAGE};">
<tr>
<td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" bgcolor="${CARD}" style="width:100%;max-width:560px;background:${CARD};border:1px solid ${MUTED};border-radius:12px;">
<tr>
<td bgcolor="${NAVY}" style="background:${NAVY};padding:22px 28px;">
${header}
</td>
</tr>
<tr>
<td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;">
<p style="margin:0 0 8px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${INK};">${escapeHtml(input.inbox.kicker)} · ${escapeHtml(input.ticketNumber)}</p>
<h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;font-weight:700;color:${NAVY};">${escapeHtml(input.heading)}</h1>
${paragraphs}
</td>
</tr>
<tr>
<td style="padding:4px 28px 28px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${INK};">${escapeHtml(input.footer)}</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
  const text = [
    input.inbox.product,
    `Ticket ${input.ticketNumber}`,
    "",
    input.heading,
    "",
    ...input.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    input.footer,
  ].join("\n");
  return { html, text };
}

export function renderSupportAutoreply(input: {
  inbox: SupportInbox;
  ticketNumber: string;
}): RenderedMail {
  return shell({
    inbox: input.inbox,
    ticketNumber: input.ticketNumber,
    heading: "We've got it.",
    preview: `We've got it. Ticket ${input.ticketNumber}.`,
    paragraphs: [
      "We're on it. We're looking at it, and we'll get right back to you.",
      `Your ticket number is ${input.ticketNumber}.`,
    ],
    footer: "Reply to this email if you need to add anything. It stays on this ticket.",
  });
}

export function renderManualSupportReply(input: {
  inbox: SupportInbox;
  ticketNumber: string;
  message: string;
}): RenderedMail {
  return shell({
    inbox: input.inbox,
    ticketNumber: input.ticketNumber,
    heading: "Following up",
    preview: `Following up on ${input.ticketNumber}.`,
    paragraphs: [input.message, `Your ticket number is ${input.ticketNumber}.`],
    footer: "Reply to this email if you need to add anything. It stays on this ticket.",
  });
}

export function renderSupportNotice(input: {
  inbox: SupportInbox;
  ticketNumber: string;
  fromEmail: string;
  subject: string;
  summary: string | null;
  autoreplyNote: string;
}): RenderedMail {
  const paragraphs = [
    `From: ${input.fromEmail}`,
    `Subject: ${input.subject}`,
    input.summary ? `Summary: ${input.summary}` : "Summary: (no message body)",
    input.autoreplyNote,
  ];
  return shell({
    inbox: input.inbox,
    ticketNumber: input.ticketNumber,
    heading: "New support ticket",
    preview: `New ticket ${input.ticketNumber} from ${input.fromEmail}.`,
    paragraphs,
    footer: "This note is only for Marshall. It is not the customer reply.",
  });
}
