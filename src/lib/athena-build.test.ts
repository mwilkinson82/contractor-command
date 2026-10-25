import { afterEach, describe, expect, it } from "vitest";
import {
  athenaBuild,
  commitFromEnv,
  normalizeBuiltAt,
  normalizeCommit,
  versionResponse,
  withAthenaBuildHeader,
} from "./athena-build";

const ENV_KEYS = [
  "ATHENA_BUILD_COMMIT",
  "VERCEL_GIT_COMMIT_SHA",
  "CF_PAGES_COMMIT_SHA",
  "WORKERS_CI_COMMIT_SHA",
  "GITHUB_SHA",
  "RENDER_GIT_COMMIT",
  "SOURCE_VERSION",
  "COMMIT_REF",
  "ATHENA_BUILT_AT",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("build stamp", () => {
  it("accepts a git sha and an ISO time, and drops anything else", () => {
    expect(normalizeCommit("CEC52936CEC52936CEC52936CEC52936CEC52936")).toHaveLength(40);
    expect(normalizeCommit("abc1234")).toBe("abc1234");
    expect(normalizeCommit("not-a-sha")).toBe("");
    expect(normalizeCommit("ghp_secretvalue")).toBe("");
    expect(normalizeBuiltAt("2026-10-25T19:00:00.000Z")).toBe("2026-10-25T19:00:00.000Z");
    expect(normalizeBuiltAt("yesterday")).toBe("");
  });

  it("reads the first sha-shaped build env var", () => {
    expect(commitFromEnv({ GITHUB_SHA: "main", ATHENA_BUILD_COMMIT: "cec5293" })).toBe("cec5293");
    expect(commitFromEnv({ RENDER_GIT_COMMIT: "deadbeef" })).toBe("deadbeef");
    expect(commitFromEnv({ SOURCE_VERSION: "branch-name" })).toBe("");
  });

  it("falls back to unknown when the build did not inject a sha or a time", () => {
    expect(athenaBuild()).toEqual({ commit: "unknown", built_at: "unknown" });
    process.env.GITHUB_SHA = "cec52936cec52936cec52936cec52936cec52936";
    process.env.ATHENA_BUILT_AT = "2026-10-25T19:22:00.000Z";
    expect(athenaBuild()).toEqual({
      commit: "cec52936cec52936cec52936cec52936cec52936",
      built_at: "2026-10-25T19:22:00.000Z",
    });
  });

  it("serves /version as public JSON and stamps the response header", async () => {
    process.env.ATHENA_BUILD_COMMIT = "abc1234";
    process.env.ATHENA_BUILT_AT = "2026-10-25T19:22:00Z";
    const res = versionResponse(new Request("https://app.meetathena.io/version?unused=1"))!;
    expect(res.headers.get("x-athena-build")).toBe("abc1234");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ commit: "abc1234", built_at: "2026-10-25T19:22:00Z" });
    const head = versionResponse(
      new Request("https://app.meetathena.io/version/", { method: "HEAD" }),
    )!;
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("x-athena-build")).toBe("abc1234");
    expect(
      versionResponse(new Request("https://app.meetathena.io/version", { method: "POST" }))!.status,
    ).toBe(405);
    expect(versionResponse(new Request("https://app.meetathena.io/login"))).toBeNull();
  });

  it("adds x-athena-build on an MCP response without changing the body", async () => {
    const original = Response.json(
      { ok: true },
      { status: 401, headers: { "www-authenticate": 'Bearer realm="mcp"' } },
    );
    const stamped = withAthenaBuildHeader(original, "unknown");
    expect(stamped).not.toBe(original);
    expect(stamped.status).toBe(401);
    expect(stamped.headers.get("www-authenticate")).toBe('Bearer realm="mcp"');
    expect(stamped.headers.get("x-athena-build")).toBe("unknown");
    expect(await stamped.json()).toEqual({ ok: true });
    expect(withAthenaBuildHeader(stamped, "unknown")).toBe(stamped);
  });
});
