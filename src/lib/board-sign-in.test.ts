import { describe, expect, it } from "vitest";
import { boardReturnForVisit, boardSignInReturn, continueBoardSignIn } from "./board-sign-in";
import { vi } from "vitest";

const JOB = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const board = `/r/job/${JOB}/items`;

describe("job board sign-in return", () => {
  it("reloads an identical record URL and rejects an unsafe Continue target", () => {
    const next = `/r/job/${JOB}/submittal/05%2012%2000-001?t=key&upload=1#upload`;
    const url = new URL(next, "https://app.meetathena.io");
    const navigation = {
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      assign: vi.fn(),
      reload: vi.fn(),
    };
    continueBoardSignIn(next, navigation);
    expect(navigation.reload).toHaveBeenCalledOnce();
    expect(navigation.assign).not.toHaveBeenCalled();
    continueBoardSignIn("https://evil.example", navigation);
    expect(navigation.reload).toHaveBeenCalledOnce();
    expect(navigation.assign).not.toHaveBeenCalled();
  });
  it("keeps a stable board path, including its hash", () => {
    expect(boardSignInReturn(`${board}#item-8`)).toBe(`${board}#item-8`);
    expect(boardSignInReturn(`/r/job/${JOB}/field#activity-A2000`)).toBe(
      `/r/job/${JOB}/field#activity-A2000`,
    );
    expect(boardReturnForVisit("ior", JOB)).toBe(`/r/job/${JOB}/ior`);
  });

  it("strips the token and utm params and keeps the path", () => {
    expect(
      boardSignInReturn(`${board}?t=expired-token&utm_source=chatgpt.com&utm_medium=email`),
    ).toBe(board);
    expect(
      boardSignInReturn(`/r/job/${JOB}/field?utm_source=chatgpt.com&utm_campaign=board#today`),
    ).toBe(`/r/job/${JOB}/field#today`);
    expect(boardSignInReturn(`${board}?UTM_SOURCE=chatgpt.com&T=abc`)).toBe(board);
    expect(boardReturnForVisit("items", JOB, `${board}?t=old&utm_source=chatgpt.com#item-1`)).toBe(
      `${board}#item-1`,
    );
  });

  it("allows a private billing page after sign-in without carrying a board token", () => {
    const billing = `/r/job/${JOB}/billing-records`;
    expect(boardSignInReturn(`${billing}?t=expired&utm_source=test#invoice`)).toBe(
      `${billing}#invoice`,
    );
    expect(boardSignInReturn(`https://evil.example${billing}`)).toBeUndefined();
  });

  it("retains production ranges and exact daily dates through sign-in", () => {
    expect(boardSignInReturn(`/r/job/${JOB}/production?from=2026-10-28&to=2026-10-29&utm_source=chatgpt`)).toBe(`/r/job/${JOB}/production?from=2026-10-28&to=2026-10-29`);
    expect(boardSignInReturn(`/r/job/${JOB}/daily?date=2026-10-28&t=old`)).toBe(`/r/job/${JOB}/daily?date=2026-10-28`);
  });

  it("rejects open redirects and anything that is not this origin's job board", () => {
    const rejected = [
      "https://evil.example/r/job/" + JOB + "/items",
      "https://app.meetathena.io.evil.example/r/job/" + JOB + "/items",
      "//evil.example/r/job/" + JOB + "/items",
      "/\\evil.example",
      "javascript:alert(1)",
      "/login",
      "/login?redirect=https://evil.example",
      "/account",
      `/r/portfolio/${JOB}`,
      `/r/job/${JOB}/items/../../../login`,
      `/r/job/${JOB}/admin`,
      `/r/job/not-a-job/items`,
      `/r/s/tok`,
      `/f/tok`,
      `https://app.meetathena.io/r/job/${JOB}/items`,
      "",
    ];
    for (const value of rejected) expect(boardSignInReturn(value), value).toBeUndefined();
    expect(boardReturnForVisit("items", JOB, "https://evil.example/phish")).toBe(board);
    expect(boardReturnForVisit("items", JOB, `//evil.example/r/job/${OTHER}/items`)).toBe(board);
    expect(boardReturnForVisit("items", JOB, "https://evil.example")).not.toContain("evil.example");
  });

  it("keeps the submittal record key, upload intent and anchor across both return validations", () => {
    const record = `/r/job/${JOB}/submittal/05%2012%2000-001`;
    const expected = `${record}?t=saved-board-key&upload=1#upload`;
    const returned = boardReturnForVisit(
      "submittals",
      JOB,
      `${record}?t=saved-board-key&upload=1&utm_source=chatgpt.com#upload`,
    );
    expect(returned).toBe(expected);
    expect(boardSignInReturn(returned)).toBe(expected);
  });
});
