import { type CustomerProposal } from "./proposal";
import {
  COMPARE_CSS,
  COMPARE_FONTS,
  contractorBar,
  esc,
  poweredByAthena,
  renderCompare,
} from "./compare-page";

/** Proposal pages may show product photos from https hosts and load Inter from Google Fonts; nothing else loads. */
export const PROPOSAL_PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex",
};

export type ProposalPagePayload = {
  company: string | null;
  job_name: string | null;
  expires_at: string | null;
  /** True once the job has a known contract value. Null when the share predates the check. */
  under_contract?: boolean | null;
  proposal: CustomerProposal;
};

export const longDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

const SHELL_CSS = `*{box-sizing:border-box}html,body{margin:0;background:#fff}main{max-width:1180px;margin:0 auto}`;

/**
 * The customer's side-by-side Good, Better, Best page behind a share link. Holds no cost, margin,
 * notes or product links. Choosing happens on the signed-in customer page, so this page only shows.
 */
export function renderProposalDocument(p: ProposalPagePayload): string {
  const v = p.proposal;
  const company = p.company || "Your contractor";
  const chosen = v.accepted?.tier ?? null;
  const body = renderCompare(v, {
    company,
    underContract: p.under_contract ?? null,
    eyebrow: null,
    note: chosen
      ? null
      : `Ready to choose? Sign your choice on your customer page from ${company}, or ask ${company} for an invite.`,
  });
  const fine = [
    chosen ? `Chosen on ${longDate(v.accepted!.recorded_on)}.` : "",
    v.valid_until ? `Prices valid until ${longDate(v.valid_until)}.` : "",
    v.terms,
    p.expires_at ? `This link expires ${longDate(p.expires_at)}.` : "",
  ].filter(Boolean);
  const close = `<footer class="close"><p>${fine.map(esc).join("\n\n")}</p>${poweredByAthena()}</footer>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(v.title)}</title>${COMPARE_FONTS}<style>${SHELL_CSS}${COMPARE_CSS}</style></head><body><main class="gbb">${contractorBar(company, p.job_name, v.valid_until ? `Valid until ${longDate(v.valid_until)}` : null)}${body}${close}</main></body></html>`;
}

export function proposalGoneHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Proposal not available</title>${COMPARE_FONTS}<style>${SHELL_CSS}${COMPARE_CSS}</style></head><body><main class="gbb"><section class="hero"><h1>This proposal link is no longer available.</h1><p class="intro">Ask your contractor for a new link.</p></section><footer class="close"><p></p>${poweredByAthena()}</footer></main></body></html>`;
}
