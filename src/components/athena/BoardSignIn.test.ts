import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_STEP_TIMEOUT_MS } from "@/lib/consent-loading";

const m = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  request: vi.fn(),
  verify: vi.fn(),
  assign: vi.fn(),
  reload: vi.fn(),
}));
// Exercise the real component's rendered forms and handlers without a DOM or
// production credentials. State slots persist across explicit rerenders.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = m.cursor++;
    if (!(index in m.slots)) m.slots[index] = initial;
    return [m.slots[index], (value: unknown) => (m.slots[index] = value)];
  },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/magic-link.functions", () => ({ requestMemberMagicLink: m.request }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { verifyOtp: m.verify } },
}));
import { BoardSignIn } from "./BoardSignIn";

const RECORD = "/r/job/323a040a-7ed1-4726-8f6a-da13fdb5a0eb/submittal/05%2012%2000-001";
const RETURN = `${RECORD}?t=fictional-board-key&upload=1#upload`;
const verified = {
  data: {
    session: {
      access_token: "fictional-session",
      user: { id: "fictional-member", email: "pm@example.com" },
    },
  },
  error: null,
};
type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...nodes(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<Record<string, unknown>>(node)) return text(node.props.children as ReactNode);
  return typeof node === "string" ? node : "";
}
function render() {
  m.cursor = 0;
  return BoardSignIn({
    returnTo: `${RETURN.replace("#upload", "")}&utm_source=chatgpt.com#upload`,
  });
}
function input(id: string, value: string) {
  const field = nodes(render()).find((node) => node.props.id === id)!;
  (field.props.onChange as (event: unknown) => void)({ target: { value } });
}
function submit() {
  const form = nodes(render()).find((node) => node.type === "form")!;
  return (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
}
function button(label: string) {
  return nodes(render()).find((node) => node.type === "button" && text(node) === label)!;
}
async function enterCode() {
  input("board-email", "pm@example.com");
  await submit();
  input("board-otp", "1234 5678");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  m.slots = [];
  m.cursor = 0;
  m.request.mockReset().mockResolvedValue({ ok: true });
  m.verify.mockReset().mockResolvedValue(verified);
  vi.stubGlobal("window", { location: { assign: m.assign, reload: m.reload } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("record email-code sign-in", () => {
  it("requests and verifies the code, returns to the exact token/upload URL and clears busy even if navigation is delayed", async () => {
    await enterCode();
    await submit();
    expect(m.request).toHaveBeenCalledWith({
      data: { email: "pm@example.com", return_to: RETURN },
    });
    expect(m.verify).toHaveBeenCalledWith({
      email: "pm@example.com",
      token: "12345678",
      type: "email",
    });
    expect(m.assign).toHaveBeenCalledOnce();
    expect(m.assign).toHaveBeenCalledWith(RETURN);
    expect(m.slots[3]).toBe(false);
    expect(text(render())).not.toContain("Checking code");
    expect(button("Continue")).toBeDefined();
    expect(text(render())).toContain("Browser account: pm@example.com");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reloads the same token/upload record on success and when Continue is clicked", async () => {
    const url = new URL(RETURN, "https://app.meetathena.io");
    vi.stubGlobal("window", {
      location: {
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
        assign: m.assign,
        reload: m.reload,
      },
    });
    await enterCode();
    await submit();
    expect(m.reload).toHaveBeenCalledOnce();
    expect(m.assign).not.toHaveBeenCalled();
    (button("Continue").props.onClick as () => void)();
    expect(m.reload).toHaveBeenCalledTimes(2);
    expect(text(render())).toContain("Browser account: pm@example.com");
  });

  it("times out a stalled verification and reenables Continue with an actionable error", async () => {
    m.verify.mockReturnValue(new Promise(() => {}));
    await enterCode();
    const pending = submit();
    expect(button("Checking code").props.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(CONSENT_STEP_TIMEOUT_MS);
    await pending;
    expect(button("Continue").props.disabled).toBe(false);
    expect(text(render())).toContain("Checking your code took too long");
    expect(nodes(render()).some((node) => node.props.role === "alert")).toBe(true);
    expect(m.assign).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never navigates when an old attempt resolves after timeout", async () => {
    let finish!: (value: typeof verified) => void;
    m.verify.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await enterCode();
    const pending = submit();
    await vi.advanceTimersByTimeAsync(CONSENT_STEP_TIMEOUT_MS);
    await pending;
    finish(verified);
    await Promise.resolve();
    expect(m.assign).not.toHaveBeenCalled();
    expect(button("Continue").props.disabled).toBe(false);
  });

  it.each(["rejected", "network", "missing-session"])(
    "makes a %s verification retryable",
    async (mode) => {
      if (mode === "rejected")
        m.verify.mockResolvedValue({ data: {}, error: { message: "private detail" } });
      if (mode === "network") m.verify.mockRejectedValue(new Error("private detail"));
      if (mode === "missing-session")
        m.verify.mockResolvedValue({ data: { session: null }, error: null });
      await enterCode();
      await submit();
      expect(button("Continue").props.disabled).toBe(false);
      expect(text(render())).toContain("That code didn't work");
      expect(text(render())).not.toContain("private detail");
      expect(m.assign).not.toHaveBeenCalled();
      m.verify.mockResolvedValue(verified);
      await submit();
      expect(m.assign).toHaveBeenCalledOnce();
    },
  );

  it("bounds requesting a code and lets the member try again", async () => {
    m.request.mockReturnValue(new Promise(() => {}));
    input("board-email", "pm@example.com");
    const pending = submit();
    expect(button("Sending code").props.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(CONSENT_STEP_TIMEOUT_MS);
    await pending;
    expect(button("Email me a sign-in code").props.disabled).toBe(false);
    expect(text(render())).toContain("Requesting a code took too long");
    expect(m.verify).not.toHaveBeenCalled();
  });

  it("offers a fresh-code path after a timeout without automatically sending email", async () => {
    m.verify.mockReturnValue(new Promise(() => {}));
    await enterCode();
    const pending = submit();
    await vi.advanceTimersByTimeAsync(CONSENT_STEP_TIMEOUT_MS);
    await pending;
    (button("Request a new code or use another email").props.onClick as () => void)();
    expect(button("Email me a sign-in code").props.disabled).toBe(false);
    expect(m.request).toHaveBeenCalledOnce();
    expect(text(render())).not.toContain("Checking your code took too long");
  });
});
