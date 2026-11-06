import { describe, expect, it } from "vitest";
import { checkPhotoFile, photoPath } from "./account-photo";

describe("member photo", () => {
  it("takes phone and web pictures up to 20 MB, and nothing else", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", "IMAGE/HEIF"])
      expect(checkPhotoFile({ size: 5_000_000, type })).toEqual({ ok: true });
    expect(checkPhotoFile({ size: 5_000, type: "application/pdf" }).ok).toBe(false);
    expect(checkPhotoFile({ size: 5_000, type: "image/svg+xml" }).ok).toBe(false);
    expect(checkPhotoFile({ size: 21 * 1024 * 1024, type: "image/jpeg" }).ok).toBe(false);
    expect(checkPhotoFile({ size: 0, type: "image/jpeg" }).ok).toBe(false);
  });

  it("puts the photo in the member's own folder, in the shape the database accepts", () => {
    const user = "11111111-2222-4333-8444-555555555555";
    const p = photoPath(user, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(p.split("/")[0]).toBe(user);
    expect(p).toMatch(/^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/);
  });
});
