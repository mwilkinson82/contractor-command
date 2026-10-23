// Per-host document title, Open Graph tags, and icon links.
// app.meetathena.io is Athena. Every other host, including the Hub at
// app.alpcontractorcircle.com, keeps the Contractor Circle tags.
import { DEFAULT_ATHENA_APP_ORIGIN } from "@/lib/athena-host";
import { isAthenaHost } from "@/lib/site-icons";

export const HUB_ORIGIN = "https://app.alpcontractorcircle.com";
export const HUB_DOCUMENT_TITLE = "Command Center — Contractor Circle";
export const HUB_HOME_TITLE = "Command Center — ALP Contractor Circle";
export const HUB_ACCOUNT_TITLE = "Account — ALP Contractor Circle";
export const ATHENA_DOCUMENT_TITLE = "Athena";

const HUB_DESCRIPTION =
  "The private member portal for Contractor Circle: live calls with Marshall, AOS access, replays, templates, Ask Marshall, and the operating process behind the projects.";
const ATHENA_DESCRIPTION =
  "Athena: construction agents by ALP for contracts, schedules, lookaheads and notices.";
const HUB_SOCIAL_IMAGE = `${HUB_ORIGIN}/brand/circle-v1/social.png`;

/** Square Athena mark already served for the connector. No marketing card. */
export const ATHENA_OG_IMAGE_PATH = "/brand/athena/athena-mono-blue-256.png";

export type SocialImage = {
  url: string;
  type: string;
  width: string;
  height: string;
  alt: string;
};

export type DocumentBrand = {
  athena: boolean;
  title: string;
  description: string;
  appName: string;
  shortName: string;
  siteName: string;
  origin: string;
  ogTitle: string;
  ogImage: SocialImage;
  /** Summary card on Athena; the Hub keeps its large image card. */
  twitterCard: "summary" | "summary_large_image";
};

export function athenaOgImage(origin = DEFAULT_ATHENA_APP_ORIGIN): SocialImage {
  const base = origin.replace(/\/$/, "");
  return {
    url: `${base}${ATHENA_OG_IMAGE_PATH}`,
    type: "image/png",
    width: "256",
    height: "256",
    alt: "Athena",
  };
}

export function documentBrand(
  hostname: string,
  athenaOrigin = DEFAULT_ATHENA_APP_ORIGIN,
): DocumentBrand {
  if (isAthenaHost(hostname)) {
    return {
      athena: true,
      title: ATHENA_DOCUMENT_TITLE,
      description: ATHENA_DESCRIPTION,
      appName: "Athena",
      shortName: "Athena",
      siteName: "Athena",
      origin: athenaOrigin.replace(/\/$/, ""),
      ogTitle: ATHENA_DOCUMENT_TITLE,
      ogImage: athenaOgImage(athenaOrigin),
      twitterCard: "summary",
    };
  }
  return {
    athena: false,
    title: HUB_DOCUMENT_TITLE,
    description: HUB_DESCRIPTION,
    appName: "Contractor Circle Command Center",
    shortName: "Contractor Circle",
    siteName: "Contractor Circle",
    origin: HUB_ORIGIN,
    ogTitle: HUB_DOCUMENT_TITLE,
    ogImage: {
      url: HUB_SOCIAL_IMAGE,
      type: "image/png",
      width: "1024",
      height: "1024",
      alt: "Contractor Circle Command Center branded preview.",
    },
    twitterCard: "summary_large_image",
  };
}

/** Route titles that the Hub sets itself. Athena uses the host title. */
export function pageTitle(hostname: string, hubTitle: string): string {
  return isAthenaHost(hostname) ? ATHENA_DOCUMENT_TITLE : hubTitle;
}

/**
 * Company name in the tab on the Hub. Athena keeps the host document title
 * ("Athena") instead of "Company · Command Center".
 */
export function companyTabTitle(
  hostname: string,
  companyName: string | null | undefined,
): string | null {
  if (isAthenaHost(hostname)) return null;
  const name = companyName?.trim();
  return name ? `${name} · Command Center` : null;
}

type IconLink = { rel: string; href: string; type?: string; sizes?: string };

/** favicon.ico on both hosts. Athena also links the 64px PNG. Apple touch icon stays. */
export function iconLinks(athena: boolean): IconLink[] {
  const links: IconLink[] = [{ rel: "icon", sizes: "any", href: "/favicon.ico" }];
  if (athena) {
    links.push({
      rel: "icon",
      type: "image/png",
      sizes: "64x64",
      href: "/brand/athena/athena-mono-blue-64.png",
    });
  }
  links.push({ rel: "apple-touch-icon", href: "/apple-touch-icon.png" });
  links.push({ rel: "manifest", href: "/site.webmanifest" });
  return links;
}
