import { createFileRoute } from "@tanstack/react-router";
import { createHash, createHmac } from "crypto";

// Temporary diagnostic. Returns a fingerprint of AOS_SHARED_SECRET (not the
// secret itself) so we can compare against AOS's logged fingerprint and
// verify both sides hold the byte-identical value.
export const Route = createFileRoute("/api/public/aos-fp")({
  server: {
    handlers: {
      GET: async () => {
        const s = process.env.AOS_SHARED_SECRET ?? "";
        const t = s.trim();
        const fp = (x: string) =>
          createHash("sha256").update(x).digest("hex").slice(0, 16);
        const sampleEmail = "wilkinson.marshall@gmail.com";
        const ts = 1700000000;
        const nonce = "fixednonce123";
        const sig = (secret: string, str: string) =>
          createHmac("sha256", secret).update(str).digest("hex").slice(0, 16);

        return new Response(
          JSON.stringify(
            {
              present: !!s,
              rawLen: s.length,
              trimLen: t.length,
              rawFp: s ? fp(s) : null,
              trimFp: t ? fp(t) : null,
              firstCharCode: s ? s.charCodeAt(0) : null,
              lastCharCode: s ? s.charCodeAt(s.length - 1) : null,
              hasQuotes:
                s.startsWith('"') ||
                s.startsWith("'") ||
                s.endsWith('"') ||
                s.endsWith("'"),
              // Deterministic HMAC samples so AOS can recompute and compare.
              sample: {
                email: sampleEmail,
                ts,
                nonce,
                signing3: `${sampleEmail}|${ts}|${nonce}`,
                sig3_raw: s ? sig(s, `${sampleEmail}|${ts}|${nonce}`) : null,
                sig3_trim: t ? sig(t, `${sampleEmail}|${ts}|${nonce}`) : null,
              },
            },
            null,
            2,
          ),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
