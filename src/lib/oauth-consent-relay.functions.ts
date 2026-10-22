// The auth server rejects a browser Origin that is not the Site URL
// ("unauthorized request origin"). The Site URL is still the lovable.app host,
// which members must not use. An empty Origin is allowed for a backend call,
// so consent details, approve, and deny run here and the browser never calls
// those endpoints directly.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { consentRequest, type ConsentApiResult } from "@/lib/oauth-consent-api";

const ConsentPath = z
  .string()
  .max(512)
  .regex(/^\/(?:user|oauth\/authorizations\/[A-Za-z0-9_-]+(?:\/consent)?)$/);

const Input = z.object({
  path: ConsentPath,
  accessToken: z.string().min(1).max(8192),
  method: z.enum(["GET", "POST"]),
  body: z.unknown().optional(),
});

export function relayConsentOnServer(
  data: z.infer<typeof Input>,
  deps?: Parameters<typeof consentRequest>[3],
): Promise<ConsentApiResult> {
  if (data.method === "POST" && !data.path.endsWith("/consent")) {
    return Promise.resolve({ data: null, error: { message: "Request failed", status: 400 } });
  }
  // Always pass fetch so this cannot bounce back through the browser relay.
  return consentRequest(data.path, data.accessToken, { method: data.method, body: data.body }, {
    ...deps,
    fetch: deps?.fetch ?? fetch,
  });
}

export const relayConsentRequest = createServerFn({ method: "POST" })
  .inputValidator(Input.parse)
  .handler(async ({ data }): Promise<ConsentApiResult> => relayConsentOnServer(data));
