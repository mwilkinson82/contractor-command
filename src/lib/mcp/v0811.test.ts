import { describe, expect, it } from "vitest";
import { ATHENA_VERSION } from "./server-info-branding";
import { CPM_REQUIRED_TOP } from "./living";
import {
  classifyConsentError, ConsentRecoverableError, EXPIRED_MESSAGE, rememberRequest, recallRequest, returnToAppUrl, LAST_REQUEST_TTL_MS,
} from "@/lib/consent-loading";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe("0.8.11 one-click connect", () => {
  it("version", () => expect(ATHENA_VERSION).toBe("0.8.11"));
  it("classifies Supabase rejections", () => {
    expect(classifyConsentError("authorization not found")).toBe("expired");
    expect(classifyConsentError("authorization request cannot be processed")).toBe("used");
    expect(classifyConsentError("authorization belongs to another user")).toBe("wrong_account");
    expect(classifyConsentError("boom")).toBe("unknown");
  });
  it("recoverable error carries the plain message and the id", () => {
    const e = new ConsentRecoverableError("expired", "abc", "authorization not found");
    expect(e.message).toBe(EXPIRED_MESSAGE);
    expect(e.stage).toBe("details");
    expect(e.authorizationId).toBe("abc");
  });
  it("remembers the last return address for one hour", () => {
    const s = mem();
    rememberRequest(s, { authorization_id: "a", redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect", client_name: "ChatGPT" }, 0);
    expect(recallRequest(s, 1000)?.client_name).toBe("ChatGPT");
    expect(recallRequest(s, LAST_REQUEST_TTL_MS + 1)).toBeNull();
  });
  it("return-to-app adds error=access_denied", () => {
    const u = new URL(returnToAppUrl("https://claude.ai/api/mcp/auth_callback?x=1")!);
    expect(u.searchParams.get("error")).toBe("access_denied");
    expect(u.searchParams.get("x")).toBe("1");
    expect(returnToAppUrl("javascript:alert(1)")).toBeNull();
  });
  it("CPM REQUIRED: count and tie lines are the first two header lines, plus the owner-furnished note", () => {
    expect(CPM_REQUIRED_TOP).toContain("line 1 is the Count check line, line 2 is the Tie line");
    expect(CPM_REQUIRED_TOP).toContain("owner-furnished note");
  });
});
