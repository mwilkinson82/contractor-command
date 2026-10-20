/**
 * 64x64 Athena mark, mono blue (0.8.8; PNG, ~1.7 KB) for ChatGPT's connector icon.
 * ChatGPT rejects or breaks on large icon files, so a small favicon-sized PNG
 * is listed first in serverInfo.icons. Stored as base64 so text-only tooling
 * can ship it; served by src/routes/brand.athena.athena-icon-64[.]png.ts.
 */
export const ATHENA_ICON_64_PNG_BASE64 = "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";

export function athenaIcon64Bytes(): Uint8Array<ArrayBuffer> {
  const bin = atob(ATHENA_ICON_64_PNG_BASE64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function athenaIcon64Response(): Response {
  return new Response(athenaIcon64Bytes(), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}
