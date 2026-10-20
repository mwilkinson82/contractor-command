// Current-request host detection (isomorphic). Kept apart from athena-host.ts
// so server functions and tests can use the pure helpers without React Start.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { isAthenaHost } from "@/lib/site-icons";

function hostFromHeaders(headers: Headers | undefined): string {
  const raw = headers?.get("x-forwarded-host") || headers?.get("host") || "";
  return raw.split(",")[0].trim().replace(/:\d+$/, "");
}

/** Current request hostname: request headers on the server, location in the browser. */
export const currentHostname = createIsomorphicFn()
  .server(() => {
    try {
      return hostFromHeaders(getRequest()?.headers);
    } catch {
      return "";
    }
  })
  .client(() => window.location.hostname);

export function onAthenaHost(): boolean {
  return isAthenaHost(currentHostname());
}
