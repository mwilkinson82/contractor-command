import { describe, expect, it } from "vitest";
import {
  FILE_LINK_RULE,
  FILE_MAX_BYTES,
  FILE_SHARE_HOW,
  FileRejected,
  allowedDownloadUrl,
  decodeBase64,
  downloadHeaders,
  expiry,
  goneHtml,
  kindAllowed,
  newToken,
  safeFilename,
  shareLink,
  storagePath,
  tokenFromLink,
  tokenHash,
  validateFile,
} from "./file-share";

const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const PDF = enc("%PDF-1.7\n%test\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0]);

describe("0.8.11 file share: validation", () => {
  it("accepts real pdf, png, xlsx, docx and csv", () => {
    expect(validateFile(PDF, "2701 SOV.pdf")).toMatchObject({
      name: "2701 SOV.pdf",
      mime: "application/pdf",
    });
    expect(validateFile(PNG, "gantt.PNG").mime).toBe("image/png");
    expect(validateFile(ZIP, "sov.xlsx").mime).toMatch(/spreadsheetml/);
    expect(validateFile(ZIP, "report.docx").mime).toMatch(/wordprocessingml/);
    expect(validateFile(enc("Item,Value\n1,$1.00\n"), "sov.csv").mime).toBe("text/csv");
  });
  it("rejects disallowed types, renamed files, empty and oversize files", () => {
    expect(() => validateFile(PDF, "x.exe")).toThrow(FileRejected);
    expect(() => validateFile(PDF, "x.html")).toThrow(/Only PDF/);
    expect(() => validateFile(enc("<html>"), "x.pdf")).toThrow(/isn't a real .pdf/);
    expect(() => validateFile(PDF, "x.png")).toThrow(FileRejected);
    expect(() => validateFile(new Uint8Array([0, 1, 2]), "x.csv")).toThrow(FileRejected);
    expect(() => validateFile(new Uint8Array(0), "x.pdf")).toThrow(/empty/);
    const big = new Uint8Array(FILE_MAX_BYTES + 1);
    big.set(PDF);
    expect(() => validateFile(big, "x.pdf")).toThrow(/over 10 MB/);
  });
  it("sanitizes names: no paths, no double extensions, no control chars", () => {
    expect(safeFilename("../../etc/passwd.pdf").name).toBe("passwd.pdf");
    expect(safeFilename("C:\\x\\a.b.pdf").name).toBe("a_b.pdf");
    expect(safeFilename("bad\u0000<name>.pdf").name).toBe("bad_name_.pdf");
    expect(safeFilename(".pdf").name).toBe("file.pdf");
  });
  it("decodes base64, data URLs and base64url; refuses junk", () => {
    expect(Array.from(decodeBase64(b64(PDF)))).toEqual(Array.from(PDF));
    expect(Array.from(decodeBase64(`data:application/pdf;base64,${b64(PDF)}`))).toEqual(
      Array.from(PDF),
    );
    expect(
      Array.from(decodeBase64(b64(PNG).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))),
    ).toEqual(Array.from(PNG));
    expect(() => decodeBase64("not base64 !!")).toThrow(/valid base64/);
  });
});

describe("0.8.11 file share: access, tokens, links", () => {
  it("full shares anything, super schedules only, contract nothing", () => {
    expect(kindAllowed("sov", "full")).toBe(true);
    expect(kindAllowed("schedule", "super")).toBe(true);
    expect(kindAllowed("sov", "super")).toBe(false);
    expect(kindAllowed("report", "super")).toBe(false);
    expect(kindAllowed("schedule", "contract")).toBe(false);
    expect(kindAllowed("schedule", undefined)).toBe(false);
  });
  it("tokens are 43-char base64url, unique, and only a sha-256 hex is stored", async () => {
    const a = newToken(),
      b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    const h = await tokenHash(a);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(a);
  });
  it("link round-trips and revoke accepts the link, the path or the bare token", () => {
    const t = newToken();
    expect(shareLink(t)).toBe(`https://app.meetathena.io/f/${t}`);
    expect(tokenFromLink(shareLink(t))).toBe(t);
    expect(tokenFromLink(`${shareLink(t)}?x=1`)).toBe(t);
    expect(tokenFromLink(`/f/${t}/`)).toBe(t);
    expect(tokenFromLink("https://example.com/f/short")).toBeNull();
  });
  it("storage path is company/job/share/name", () => {
    expect(storagePath("c", "j", "s", "a.pdf")).toBe("c/j/s/a.pdf");
  });
  it("expiry defaults to 30 days and clamps to 1..90", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    expect(expiry(undefined, now).toISOString()).toBe("2026-11-19T00:00:00.000Z");
    expect(expiry(500, now).toISOString()).toBe("2027-01-18T00:00:00.000Z");
    expect(expiry(0, now).toISOString()).toBe("2026-10-21T00:00:00.000Z");
  });
  it("ChatGPT file urls: OpenAI hosts over https only", () => {
    expect(allowedDownloadUrl("https://files.oaiusercontent.com/file-abc?sig=1")).toBe(true);
    expect(allowedDownloadUrl("http://files.oaiusercontent.com/x")).toBe(false);
    expect(allowedDownloadUrl("https://evil.com/?files.oaiusercontent.com")).toBe(false);
    expect(allowedDownloadUrl("https://oaiusercontent.com.evil.com/x")).toBe(false);
    expect(allowedDownloadUrl("https://169.254.169.254/latest")).toBe(false);
    expect(allowedDownloadUrl("https://u:p@files.oaiusercontent.com/x")).toBe(false);
  });
});

describe("0.8.11 file share: host wording and page", () => {
  it("link rule is pinned REQUIRED and never lets the host claim an attachment", () => {
    expect(FILE_LINK_RULE).toMatch(/^Put this link in the email body/);
    expect(FILE_LINK_RULE).toMatch(/Say the file is attached only if your email tool attached it/);
    expect(FILE_SHARE_HOW).toMatch(/content_base64/);
  });
  it("download is always an attachment with nosniff and a sandbox CSP", () => {
    const h = downloadHeaders('2701 SOV "v1".pdf', "application/pdf", 10);
    expect(h.get("content-disposition")).toMatch(
      /^attachment; filename="2701 SOV _v1_.pdf"; filename\*=UTF-8''/,
    );
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("content-security-policy")).toMatch(/sandbox/);
    expect(h.get("cache-control")).toBe("private, no-store");
    expect(h.get("content-length")).toBe("10");
  });
  it("blue/gray only, no Lovable, fragnet wording intact", () => {
    const all = [goneHtml(), FILE_LINK_RULE, FILE_SHARE_HOW].join(" ");
    expect(all).not.toMatch(/lovable|supabase|\bred\b|fragment/i);
    const colors = goneHtml().match(/#[0-9A-Fa-f]{6}/g)!;
    for (const c of colors)
      expect(["#F3F4F6", "#6B7280", "#FFFFFF", "#D1D5DB", "#2563EB", "#9CA3AF"]).toContain(c);
  });
});
