import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ATHENA_DOCUMENT_TITLE,
  ATHENA_OG_IMAGE_PATH,
  HUB_ACCOUNT_TITLE,
  HUB_DOCUMENT_TITLE,
  HUB_HOME_TITLE,
  HUB_ORIGIN,
  companyTabTitle,
  documentBrand,
  iconLinks,
  pageTitle,
} from "./host-document";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("per-host document title and Open Graph", () => {
  it("Athena host title, site name, and og:title are Athena", () => {
    const b = documentBrand("app.meetathena.io");
    expect(b.athena).toBe(true);
    expect(b.title).toBe("Athena");
    expect(b.title).toBe(ATHENA_DOCUMENT_TITLE);
    expect(b.ogTitle).toBe("Athena");
    expect(b.siteName).toBe("Athena");
    expect(b.origin).toBe("https://app.meetathena.io");
    expect(b.ogImage).toEqual({
      url: `https://app.meetathena.io${ATHENA_OG_IMAGE_PATH}`,
      type: "image/png",
      width: "256",
      height: "256",
      alt: "Athena",
    });
    expect(b.ogImage.url).not.toMatch(/r2\.dev|lovable/i);
    expect(b.twitterCard).toBe("summary");
  });

  it("Hub title and og tags stay the Contractor Circle set", () => {
    const b = documentBrand("app.alpcontractorcircle.com");
    expect(b.athena).toBe(false);
    expect(b.title).toBe(HUB_DOCUMENT_TITLE);
    expect(b.title).toBe("Command Center — Contractor Circle");
    expect(b.ogTitle).toBe("Command Center — Contractor Circle");
    expect(b.siteName).toBe("Contractor Circle");
    expect(b.origin).toBe(HUB_ORIGIN);
    expect(b.appName).toBe("Contractor Circle Command Center");
    expect(b.ogImage).toEqual({
      url: `${HUB_ORIGIN}/brand/circle-v1/social.png`,
      type: "image/png",
      width: "1024",
      height: "1024",
      alt: "Contractor Circle Command Center branded preview.",
    });
    expect(b.twitterCard).toBe("summary_large_image");
    expect(b.description).toContain("private member portal for Contractor Circle");
  });

  it("subdomains follow the host, and a bare hostname is the Hub", () => {
    expect(documentBrand("meetathena.io").title).toBe("Athena");
    expect(documentBrand("www.meetathena.io").ogImage.url).toContain("meetathena.io");
    expect(documentBrand("localhost").title).toBe(HUB_DOCUMENT_TITLE);
    expect(documentBrand("").siteName).toBe("Contractor Circle");
  });

  it("home and account titles are Athena only on the Athena host", () => {
    expect(pageTitle("app.meetathena.io", HUB_HOME_TITLE)).toBe("Athena");
    expect(pageTitle("app.alpcontractorcircle.com", HUB_HOME_TITLE)).toBe(
      "Command Center — ALP Contractor Circle",
    );
    expect(pageTitle("app.meetathena.io", HUB_ACCOUNT_TITLE)).toBe("Athena");
    expect(pageTitle("app.alpcontractorcircle.com", HUB_ACCOUNT_TITLE)).toBe(
      "Account — ALP Contractor Circle",
    );
  });

  it("the company tab title does not replace Athena", () => {
    expect(companyTabTitle("app.meetathena.io", "Calloway Builders")).toBeNull();
    expect(companyTabTitle("app.alpcontractorcircle.com", "Calloway Builders")).toBe(
      "Calloway Builders · Command Center",
    );
    expect(companyTabTitle("app.alpcontractorcircle.com", "  ")).toBeNull();
  });

  it("Athena adds the 64px PNG icon and both hosts keep the apple touch icon", () => {
    const athena = iconLinks(true);
    const hub = iconLinks(false);
    expect(athena).toEqual([
      { rel: "icon", sizes: "any", href: "/favicon.ico" },
      {
        rel: "icon",
        type: "image/png",
        sizes: "64x64",
        href: "/brand/athena/athena-mono-blue-64.png",
      },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ]);
    expect(hub.map((l) => l.href)).toEqual([
      "/favicon.ico",
      "/apple-touch-icon.png",
      "/site.webmanifest",
    ]);
    expect(hub.some((l) => l.href.includes("athena"))).toBe(false);
  });

  it("the routes use the host helpers and leave the Hub strings in place", () => {
    const root = read("../routes/__root.tsx");
    expect(root).toContain("documentBrand(currentHostname(), athenaAppOrigin())");
    expect(root).toContain("iconLinks(b.athena)");
    expect(root).toContain("content: b.ogTitle");
    expect(root).toContain("content: b.ogImage.url");
    expect(root).not.toContain("Command Center — ALP Contractor Circle");

    const index = read("../routes/index.tsx");
    expect(index).toContain("pageTitle(currentHostname(), HUB_HOME_TITLE)");
    expect(index).toContain("The private member portal for Contractor Circle");

    const account = read("../routes/account.tsx");
    expect(account).toContain("pageTitle(currentHostname(), HUB_ACCOUNT_TITLE)");

    const company = read("../hooks/use-company.ts");
    expect(company).toContain("companyTabTitle(");
  });
});
