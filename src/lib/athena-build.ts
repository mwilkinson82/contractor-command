// Build stamp for testers. The commit and time are baked by Vite at build time.
// Runtime env can fill a missing commit. Nothing here is a secret, and a value
// that is not a git sha or an ISO time is ignored.

declare const __ATHENA_COMMIT__: string | undefined;
declare const __ATHENA_BUILT_AT__: string | undefined;

export const BUILD_COMMIT_ENV_KEYS = [
  "ATHENA_BUILD_COMMIT",
  "VERCEL_GIT_COMMIT_SHA",
  "CF_PAGES_COMMIT_SHA",
  "WORKERS_CI_COMMIT_SHA",
  "GITHUB_SHA",
  "RENDER_GIT_COMMIT",
  "SOURCE_VERSION",
  "COMMIT_REF",
] as const;

const SHA = /^[0-9a-f]{7,64}$/i;
const BUILT_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function normalizeCommit(value: string | null | undefined): string {
  const sha = (value ?? "").trim();
  return SHA.test(sha) ? sha.slice(0, 40).toLowerCase() : "";
}

export function normalizeBuiltAt(value: string | null | undefined): string {
  const stamp = (value ?? "").trim();
  return BUILT_AT.test(stamp) ? stamp : "";
}

export function commitFromEnv(env: Record<string, string | undefined> | undefined): string {
  if (!env) return "";
  for (const key of BUILD_COMMIT_ENV_KEYS) {
    const sha = normalizeCommit(env[key]);
    if (sha) return sha;
  }
  return "";
}

function baked(name: "__ATHENA_COMMIT__" | "__ATHENA_BUILT_AT__"): string {
  const value =
    name === "__ATHENA_COMMIT__"
      ? typeof __ATHENA_COMMIT__ === "string"
        ? __ATHENA_COMMIT__
        : ""
      : typeof __ATHENA_BUILT_AT__ === "string"
        ? __ATHENA_BUILT_AT__
        : "";
  return value.trim();
}

export function athenaBuild(): { commit: string; built_at: string } {
  const env = typeof process === "undefined" ? undefined : process.env;
  const commit = normalizeCommit(baked("__ATHENA_COMMIT__")) || commitFromEnv(env) || "unknown";
  const built_at =
    normalizeBuiltAt(baked("__ATHENA_BUILT_AT__")) ||
    normalizeBuiltAt(env?.ATHENA_BUILT_AT) ||
    "unknown";
  return { commit, built_at };
}

export function withAthenaBuildHeader(response: Response, commit = athenaBuild().commit): Response {
  const headers = new Headers(response.headers);
  if (headers.get("x-athena-build") === commit) return response;
  headers.set("x-athena-build", commit);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Public read of the build stamp. Null when the path is not /version. */
export function versionResponse(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== "/version" && url.pathname !== "/version/") return null;
  const build = athenaBuild();
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-athena-build": build.commit,
  };
  const method = request.method.toUpperCase();
  if (method === "HEAD") return new Response(null, { status: 200, headers });
  if (method !== "GET") {
    return new Response(null, { status: 405, headers: { ...headers, allow: "GET, HEAD" } });
  }
  return new Response(JSON.stringify({ commit: build.commit, built_at: build.built_at }), {
    status: 200,
    headers,
  });
}
