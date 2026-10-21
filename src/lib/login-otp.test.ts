import { describe, expect, it } from "vitest";
import { normalizeOtpCode } from "./login-otp";

describe("normalizeOtpCode", () => {
  it("accepts a 6-digit code with spaces", () => expect(normalizeOtpCode(" 123 456 ")).toBe("123456"));
  it("rejects letters and short codes", () => {
    expect(normalizeOtpCode("12a456")).toBeNull();
    expect(normalizeOtpCode("12345")).toBeNull();
  });
});
