import { describe, expect, it, vi } from "vitest";
import { projectReadRecovery } from "./project-read-recovery";
import { continueBoardSignIn } from "./board-sign-in";

describe("project sign-in recovery", () => {
  it("does not ask an authenticated member for another code after the observed database failure", () => {
    expect(
      projectReadRecovery(true, {
        code: "25006",
        message: "cannot execute INSERT in a read-only transaction",
      }),
    ).toBe("unavailable");
  });
  it.each([{ code: "MCP_NO_JOB" }, { status: 403 }, new Error("Network unavailable"), undefined])(
    "does not turn a denied or unavailable project into an OTP loop: %s",
    (error) => {
      expect(projectReadRecovery(true, error)).toBe("unavailable");
    },
  );
  it.each([{ status: 401 }, { code: "PGRST301" }, { code: "PGRST303" }])(
    "allows reauthentication for an explicitly rejected session: %s",
    (error) => {
      expect(projectReadRecovery(true, error)).toBe("sign-in");
    },
  );
  it("keeps the account project destination through a missing session and successful same-page OTP return", () => {
    const path = "/r/job/11111111-1111-4111-8111-111111111111/home";
    expect(projectReadRecovery(false)).toBe("sign-in");
    const navigation = { pathname: path, search: "", hash: "", assign: vi.fn(), reload: vi.fn() };
    continueBoardSignIn(path, navigation);
    expect(navigation.reload).toHaveBeenCalledOnce();
    expect(navigation.assign).not.toHaveBeenCalled();
    expect(projectReadRecovery(true, { code: "25006" })).toBe("unavailable");
  });
});
