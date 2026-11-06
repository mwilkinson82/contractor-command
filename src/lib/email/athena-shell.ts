// The one HTML shell for Athena's own emails: white card, navy heading, slate text, a blue button and a blue code
// panel. Customer emails lead with the contractor (their saved logo, or their name in type) and carry Athena as the
// small A and "Powered by Athena" under the card; Athena's own emails lead with the Athena mark.
//
// Phone dark mode, and why the shell looks the way it does:
// - Apple Mail honours the light-only color-scheme metas, so it shows the email as designed.
// - The Gmail apps ignore those metas and repaint the email themselves. Android darkens light backgrounds and
//   lightens dark text. iOS inverts every colour but leaves background images alone. Nothing a sender writes turns
//   this off.
// - So the white card and the body text are plain colours with no background image. Gmail then darkens the whole
//   card evenly and the text stays readable. A forced-white background would stay white on iOS while the text
//   flipped pale on top of it, which is the unreadable email we shipped on Nov 4.
// - The sign-in code keeps its pale blue box and navy digits, also as plain colours, so it darkens with the card.
// - The button keeps its blue three ways: bgcolor, an inline one-colour gradient (iOS keeps background images), and
//   the same gradient from the style block (Gmail for Android reads gradients only from there). Its white label is
//   wrapped in the screen/difference blend spans, which only match inside Gmail (`u + .body`), so iOS can't flip it.
// - On a computer and in light mode, every client shows the designed look: white card, blue button, pale code box.

export const EMAIL_LOGO = "https://app.meetathena.io/brand/athena/email/athena-mark-180.png";
export const EMAIL_BLUE = "#1E5FED";
export const EMAIL_NAVY = "#0F1E3D";
/** The button's blue, the same blue as the design. */
export const EMAIL_PANEL = EMAIL_BLUE;
const CODE_BOX = "#F2F6FF";
export const EMAIL_SLATE = "#3B4A66";
export const EMAIL_MUTED = "#6B7488";
export const EMAIL_LINE = "#E3E8F2";
const SLATE = EMAIL_SLATE;
const MUTED = EMAIL_MUTED;
const LINE = EMAIL_LINE;
export const EMAIL_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BRAND_FONT =
  "Inter,'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif";

const PANEL_FILL = `linear-gradient(${EMAIL_PANEL},${EMAIL_PANEL})`;
export const EMAIL_HEAD_CSS = [
  ":root{color-scheme:light;supported-color-schemes:light}",
  `.ath-panel{background-color:${EMAIL_PANEL}!important;background-image:${PANEL_FILL}!important}`,
  "u + .body .gm-screen{background:#000;mix-blend-mode:screen;display:inline-block}",
  "u + .body .gm-diff{background:#000;mix-blend-mode:difference;display:inline-block}",
].join("");

export const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** White text that Gmail on iOS can't flip dark. Escape the text before passing it in. */
export const keepWhite = (html: string): string =>
  `<span class="gm-screen"><span class="gm-diff">${html}</span></span>`;

/** Only an https image may stand in for the contractor's name. */
export const safeEmailLogo = (url: string | null | undefined): string | null =>
  url && /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : null;

export type EmailFrame = {
  /** Who leads up top: the contractor on customer emails, Athena on its own. */
  brand: { contractor: string; logo?: string | null } | "athena";
  /** Blue line under the brand. */
  tagline: string;
  /** Inbox preview line. */
  preview: string;
  heading: string;
  /** Paragraphs, already escaped. */
  lines: string[];
  /** Finished HTML under the paragraphs, already escaped. Used by the morning brief. */
  body?: string;
  /** Card width in px. 520 unless set. */
  width?: number;
  button?: { label: string; href: string };
  code?: string;
  /** Small print above the rule, already escaped. */
  after?: string;
  /** Muted lines under the rule, already escaped. */
  foot: string;
  legal: string;
};

function top(brand: EmailFrame["brand"]): string {
  if (brand === "athena")
    return `<img src="${EMAIL_LOGO}" width="56" height="56" alt="Athena" style="display:block;width:56px;height:56px;border:0">`;
  const logo = safeEmailLogo(brand.logo);
  return logo
    ? `<img src="${esc(logo)}" height="48" alt="${esc(brand.contractor)}" style="display:block;height:48px;max-width:240px;width:auto;border:0">`
    : `<p style="margin:0;color:${EMAIL_NAVY};font-family:${BRAND_FONT};font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.2px">${esc(brand.contractor)}</p>`;
}

const panelStyle = `background-color:${EMAIL_PANEL};background-image:${PANEL_FILL}`;

export function emailShell(f: EmailFrame): string {
  const p = (html: string) =>
    `<p style="margin:0 0 12px;color:${SLATE};font-size:15px;line-height:24px">${html}</p>`;
  const button = f.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px"><tr><td class="ath-panel" bgcolor="${EMAIL_PANEL}" style="border-radius:10px;${panelStyle}"><a class="ath-panel" href="${esc(f.button.href)}" style="display:inline-block;padding:14px 26px;border-radius:10px;${panelStyle};color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none">${keepWhite(esc(f.button.label))}</a></td></tr></table>`
    : "";
  const code = f.code
    ? `<p style="margin:8px 0 4px;padding:14px 18px;border:1px solid ${LINE};border-radius:10px;background-color:${CODE_BOX};color:${EMAIL_NAVY};font-family:Menlo,Consolas,monospace;font-size:30px;line-height:36px;font-weight:700;letter-spacing:8px;text-align:center">${esc(f.code)}</p>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(f.heading)}</title><style>${EMAIL_HEAD_CSS}</style></head><body class="body" style="margin:0;padding:32px 12px;background-color:#FFFFFF;font-family:${EMAIL_FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(f.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background-color:#FFFFFF"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="max-width:${f.width ?? 520}px;border:1px solid ${LINE};border-radius:14px;background-color:#FFFFFF;border-collapse:separate">
<tr><td style="padding:32px 36px 0">
${top(f.brand)}
<p style="margin:14px 0 0;color:${EMAIL_BLUE};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">${esc(f.tagline)}</p>
</td></tr>
<tr><td style="padding:8px 36px 32px">
<h1 style="margin:18px 0 12px;color:${EMAIL_NAVY};font-size:26px;line-height:32px;font-weight:800">${esc(f.heading)}</h1>
${f.lines.map(p).join("\n")}
${f.body ?? ""}
${button}
${code}
${f.after ? `<p style="margin:16px 0 0;color:${SLATE};font-size:13px;line-height:21px">${f.after}</p>` : ""}
<p style="margin:28px 0 0;padding-top:18px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;line-height:19px">${f.foot}</p>
</td></tr></table>
<p style="margin:18px 0 0;color:${MUTED};font-size:11px;line-height:16px;text-align:center">${f.brand === "athena" ? "" : `<img src="${EMAIL_LOGO}" width="16" height="16" alt="" style="display:inline-block;width:16px;height:16px;border:0;vertical-align:-4px;margin-right:5px">`}${esc(f.legal)}</p>
</td></tr></table></body></html>`;
}
