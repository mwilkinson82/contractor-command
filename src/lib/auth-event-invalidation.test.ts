import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthInvalidationScheduler,
  shouldInvalidateOnAuthEvent,
} from "@/lib/auth-event-invalidation";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(path: string) {
  const state = { path };
  const invalidate = vi.fn();
  const s = createAuthInvalidationScheduler({ getPathname: () => state.path, invalidate });
  return { state, invalidate, s };
}

describe("auth event invalidation", () => {
  it("ignores INITIAL_SESSION and TOKEN_REFRESHED", () => {
    expect(shouldInvalidateOnAuthEvent("INITIAL_SESSION", "/")).toBe(false);
    expect(shouldInvalidateOnAuthEvent("TOKEN_REFRESHED", "/")).toBe(false);
  });
  it.each(["/login", "/auth/callback", "/oauth/consent"])(
    "never restarts public flow %s",
    async (p) => {
      const { s, invalidate } = setup(p);
      for (const e of ["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"]) s.onEvent(e);
      await vi.runAllTimersAsync();
      expect(invalidate).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("defers protected-route invalidation outside the callback and coalesces", async () => {
    const { s, invalidate } = setup("/vault");
    s.onEvent("SIGNED_OUT");
    s.onEvent("SIGNED_IN");
    expect(invalidate).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
  it("re-reads the current path when the timer fires (no stale closure)", async () => {
    const { s, invalidate, state } = setup("/vault");
    s.onEvent("SIGNED_IN");
    state.path = "/oauth/consent";
    await vi.runAllTimersAsync();
    expect(invalidate).not.toHaveBeenCalled();
  });
  it("clears pending timers on dispose", async () => {
    const { s, invalidate } = setup("/vault");
    s.onEvent("SIGNED_OUT");
    expect(vi.getTimerCount()).toBe(1);
    s.dispose();
    expect(vi.getTimerCount()).toBe(0);
    s.onEvent("SIGNED_OUT");
    await vi.runAllTimersAsync();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
