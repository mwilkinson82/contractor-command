import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { siteIconResponse } from "./site-icons";

// Hub icons must be the approved linked-C Circle assets (commit 58c00003), never
// the plain "A" from d0bf32b8 nor any Athena mark.
const md5 = (b: Buffer) => createHash("md5").update(b).digest("hex");
const PLAIN_A_ICO_MD5 = "463c5bf8eb"; // the 2,613-byte "A" favicon live on the Hub on 21 Oct
const hub = (p: string) => siteIconResponse(new Request(`https://app.alpcontractorcircle.com${p}`))!;
const athena = (p: string) => siteIconResponse(new Request(`https://app.meetathena.io${p}`))!;
const bytes = async (r: Response) => Buffer.from(await r.arrayBuffer());

// Expected bytes pinned as md5 of the 58c00003 linked-C files.
const EXPECT = {
  ico: "", app256: "", app512: "", fav32: "",
};
try {
  const show = (p: string) => execFileSync("git", ["show", `58c00003:public/brand/circle-v1/${p}`]);
  EXPECT.ico = md5(show("favicon.ico"));
  EXPECT.app256 = md5(show("app-icon-256.png"));
  EXPECT.app512 = md5(show("app-icon-512.png"));
  EXPECT.fav32 = md5(show("favicon-32.png"));
} catch {
  /* shallow checkout: the byte pins below are skipped, the "not A / not Athena" checks still run */
}

describe("Hub host icons are the Circle linked-C set", () => {
  it("favicon.ico is not the plain A and not the Athena icon", async () => {
    const ico = await bytes(hub("/favicon.ico"));
    expect(md5(ico).startsWith(PLAIN_A_ICO_MD5)).toBe(false);
    expect(md5(ico)).not.toBe(md5(await bytes(athena("/favicon.ico"))));
    if (EXPECT.ico) expect(md5(ico)).toBe(EXPECT.ico);
  });

  it("apple-touch-icon and PWA icons are the 58c00003 linked-C PNGs", async () => {
    if (!EXPECT.app512) return;
    expect(md5(await bytes(hub("/apple-touch-icon.png")))).toBe(EXPECT.app512);
    expect(md5(await bytes(hub("/brand/circle/app-icon-256.png")))).toBe(EXPECT.app256);
    expect(md5(await bytes(hub("/brand/circle/app-icon-512.png")))).toBe(EXPECT.app512);
    expect(md5(await bytes(hub("/brand/circle/favicon-32.png")))).toBe(EXPECT.fav32);
  });

  it("favicon.svg is the linked-C mark and has no Athena", async () => {
    const svg = await hub("/favicon.svg").text();
    expect(svg).toBe(readFileSync(new URL("../../public/brand/circle-v1/mark-small.svg", import.meta.url), "utf8"));
    expect(svg).not.toMatch(/athena/i);
  });

  it("Hub manifest stays Contractor Circle and points at the served linked-C icons", async () => {
    const mf = JSON.parse(await hub("/site.webmanifest").text());
    expect(mf.name).toBe("Contractor Circle Command Center");
    expect(mf.icons.map((i: { src: string }) => i.src)).toEqual([
      "/brand/circle/app-icon-256.png",
      "/brand/circle/app-icon-512.png",
    ]);
    expect(JSON.stringify(mf)).not.toMatch(/athena/i);
  });

  it("Athena host icons are unchanged", async () => {
    expect((await athena("/site.webmanifest").text())).toContain("Athena");
    expect(await athena("/favicon.svg").text()).toContain("mono-blue");
  });
});
