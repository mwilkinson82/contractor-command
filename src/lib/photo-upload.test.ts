import { describe, expect, it } from "vitest";
import { preparePhoto } from "@/lib/photo-upload";
import { brokenJpeg, testJpeg } from "@/lib/photo-fixtures.test-helpers";

const file = (bytes: Uint8Array<ArrayBuffer>, name: string) =>
  new File([bytes], name, { type: "image/jpeg" });

describe("adding photos from the photos page", () => {
  it("keeps a phone photo exactly as picked", async () => {
    const bytes = testJpeg(4032, 3024);
    const ready = await preparePhoto(file(bytes, "IMG_0412.JPG"));
    expect(ready).toMatchObject({
      ok: true,
      ext: "jpg",
      mime: "image/jpeg",
      scaled: false,
      info: { width: 4032, height: 3024 },
    });
    if (ready.ok) expect(Buffer.from(ready.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it("checks the bytes, not the name", async () => {
    expect(await preparePhoto(file(testJpeg(1600, 1200), "image"))).toMatchObject({
      ok: true,
      ext: "jpg",
    });
  });

  it("refuses a preview or a damaged file and says why", async () => {
    expect(await preparePhoto(file(testJpeg(120, 160), "small.jpg"))).toEqual({
      ok: false,
      text: "It's only 120 × 160 pixels. Pick the original photo, not a screenshot or preview.",
    });
    expect(await preparePhoto(file(brokenJpeg(), "broken.jpg"))).toEqual({
      ok: false,
      text: "The file is damaged or incomplete.",
    });
    expect(
      await preparePhoto(file(new TextEncoder().encode("<html>no</html>"), "x.jpg")),
    ).toMatchObject({ ok: false, text: "Use a JPEG, PNG or WebP photo." });
  });
});
