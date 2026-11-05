// Nov 2026: a chat link to the member's own Athena account page (company profile, team, plan). The page itself
// requires an Athena sign-in; a signed-out member gets the emailed sign-in code and lands back on the section asked
// for. No token rides in the link: the account page can invite people and change roles, so it never opens without
// a real session.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text } from "../guard";
import { guide } from "../visible";
import { renderHtml } from "../cards/html";
import { renderMarkdown } from "../cards/markdown";
import type { CardModel } from "../cards/model";

export const ACCOUNT_URL = "https://app.meetathena.io/account";
export const ACCOUNT_SECTIONS = [
  "overview",
  "company",
  "team",
  "payments",
  "billing",
  "projects",
] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

const LABEL: Record<AccountSection, string> = {
  overview: "Your Athena account",
  company: "Company profile",
  team: "Team & access",
  payments: "Client payments",
  billing: "Plan & billing",
  projects: "Your projects",
};
const BUTTON: Record<AccountSection, string> = {
  overview: "Open my account",
  company: "Edit company profile",
  team: "Manage team",
  payments: "Open client payments",
  billing: "Open plan & billing",
  projects: "Open my projects",
};
const ALIASES: Record<string, AccountSection> = {
  account: "overview",
  overview: "overview",
  home: "overview",
  settings: "overview",
  company: "company",
  profile: "company",
  "company profile": "company",
  logo: "company",
  branding: "company",
  team: "team",
  people: "team",
  users: "team",
  invite: "team",
  invites: "team",
  roles: "team",
  permissions: "team",
  access: "team",
  privileges: "team",
  payments: "payments",
  "client payments": "payments",
  stripe: "payments",
  "get paid": "payments",
  billing: "billing",
  plan: "billing",
  subscription: "billing",
  seats: "billing",
  projects: "projects",
  jobs: "projects",
};

/** Maps what the member said to an account section; anything unknown opens the overview. */
export function accountSection(raw: string | null | undefined): AccountSection {
  const key = (raw ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return ALIASES[key] ?? "overview";
}

export function accountUrl(section: AccountSection): string {
  return section === "overview" ? ACCOUNT_URL : `${ACCOUNT_URL}#${section}`;
}

export function accountLinkCard(section: AccountSection): CardModel {
  return {
    state: "result",
    show_state: false,
    presentation: "report-link",
    title: LABEL[section],
    sections: [
      {
        heading: "Open",
        kind: "chips",
        rows: [{ cells: [BUTTON[section]], href: accountUrl(section), tone: "action" }],
      },
      {
        heading: "Sign in",
        kind: "list",
        rows: [
          {
            cells: [
              "Sign in with the email you use for Athena. We'll email you a code; no password needed.",
            ],
            tone: "known",
          },
        ],
      },
    ],
    next_move: null,
  };
}

export const accountLink = defineTool({
  name: "account_link",
  title: "Open my Athena account page",
  description:
    "Gives the member a link to their Athena account page: company profile and logo, team invites, roles and job access, client payments, plan and billing, or saved projects. Use for 'where do I invite my team', 'change my logo', 'set permissions' or 'open my account'.",
  inputSchema: {
    section: z
      .string()
      .trim()
      .max(40)
      .optional()
      .describe("overview, company, team, payments, billing or projects"),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run("account_link", ctx, {}, async () => {
      const section = accountSection(args.section);
      const url = accountUrl(section);
      const card = accountLinkCard(section);
      return guide(
        {
          ...text(renderMarkdown(card)),
          structuredContent: { url, section, requires_session: true, card, html: renderHtml(card) },
        },
        "Return the complete Markdown reply and its link. Team changes can also be made here in chat with the team tools.",
      );
    }),
});
