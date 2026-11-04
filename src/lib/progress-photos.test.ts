import { describe, expect, it } from "vitest";
import { photoImageInfo, photoQualityProblem, PHOTO_MIN_EDGE } from "./mcp/superintendent";
import { photoAddHref, photoPageHref } from "./mcp/tools/superintendent-tools";
import { readPhotoExif } from "./photo-exif";
import { brokenJpeg, testJpeg } from "./photo-fixtures.test-helpers";
import {
  dailyHref,
  groupByDate,
  isIsoDate,
  isLowRes,
  longDate,
  photoIdFromHash,
  photosHref,
  formatBytes,
} from "./progress-photos";

describe("stored photo checks", () => {
  it("reads the pixel size of a whole JPEG", () => {
    expect(photoImageInfo(testJpeg(4032, 3024), "jpg")).toEqual({ width: 4032, height: 3024 });
    expect(photoQualityProblem({ width: 4032, height: 3024 })).toBeNull();
  });

  it("refuses the 2810 kind of damaged file: valid first bytes but no frame or scan", () => {
    expect(photoImageInfo(brokenJpeg(), "jpg")).toBeNull();
    expect(photoQualityProblem(null)).toMatch(/damaged or incomplete/);
  });

  it("refuses a JPEG cut off before its picture data", () => {
    const whole = testJpeg(2000, 1500);
    expect(photoImageInfo(whole.subarray(0, whole.length - 120), "jpg")).toBeNull();
    expect(
      photoImageInfo(
        Uint8Array.from([
          0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
        ]),
        "jpg",
      ),
    ).toBeNull();
  });

  it("refuses a small preview like the 120 x 160 file saved for 2810", () => {
    const info = photoImageInfo(testJpeg(120, 160), "jpg");
    expect(info).toEqual({ width: 120, height: 160 });
    expect(photoQualityProblem(info)).toMatch(/small preview \(120 × 160 pixels\)/);
    expect(photoQualityProblem({ width: PHOTO_MIN_EDGE, height: 480 })).toBeNull();
  });

  it("reads PNG and WebP sizes", () => {
    const png = new Uint8Array(45);
    png.set([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 7,
      0x80, 0, 0, 4, 0x38,
    ]);
    png.set([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], 37);
    expect(photoImageInfo(png, "png")).toEqual({ width: 1920, height: 1080 });
    expect(photoImageInfo(png.subarray(0, 40), "png")).toBeNull();
    const webp = new Uint8Array(40);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    webp.set([0x7f, 0x07, 0x00, 0x37, 0x04, 0x00], 24); // 1920 x 1080 minus one each
    expect(photoImageInfo(webp, "webp")).toEqual({ width: 1920, height: 1080 });
  });
});

describe("camera details", () => {
  it("reads camera date, camera and GPS presence", () => {
    const exif = readPhotoExif(
      testJpeg(4032, 3024, {
        make: "Apple",
        model: "Apple iPhone 15 Pro",
        date: "2026:11:03 14:22:05",
        gps: true,
      }),
    );
    expect(exif).toMatchObject({
      taken_at: "2026-11-03 14:22:05",
      camera: "Apple iPhone 15 Pro",
      has_gps: true,
    });
  });

  it("returns nothing for a file without EXIF or a damaged one", () => {
    expect(readPhotoExif(testJpeg(800, 600))).toEqual({
      taken_at: null,
      camera: null,
      orientation: null,
      has_gps: false,
    });
    expect(readPhotoExif(brokenJpeg()).taken_at).toBeNull();
    expect(readPhotoExif(new Uint8Array([1, 2, 3])).camera).toBeNull();
  });
});

describe("photo page links", () => {
  const job = "f568fe39-26d1-4c49-9d93-a9072a896c46";
  it("narrows to a day and keeps the board token", () => {
    expect(photosHref(job, { date: "2026-11-03", token: "abc" })).toBe(
      `/r/job/${job}/photos?date=2026-11-03&t=abc`,
    );
    expect(photosHref(job, { date: "2026-11-03", photoId: "a476b452" })).toBe(
      `/r/job/${job}/photos?date=2026-11-03#photo-a476b452`,
    );
    expect(photosHref(job, { date: "11/03/2026" })).toBe(`/r/job/${job}/photos`);
    expect(dailyHref(job, "2026-11-03", "abc")).toBe(`/r/job/${job}/daily?date=2026-11-03&t=abc`);
  });

  it("builds chat links to one day's photos without losing the token", () => {
    expect(
      photoPageHref("https://app.meetathena.io/r/job/x/photos?t=tok", "2026-11-03", "abc12345"),
    ).toBe("https://app.meetathena.io/r/job/x/photos?t=tok&date=2026-11-03#photo-abc12345");
    expect(photoPageHref("https://app.meetathena.io/r/job/x/photos?t=tok", null)).toBe(
      "https://app.meetathena.io/r/job/x/photos?t=tok",
    );
    expect(photoPageHref(null, "2026-11-03")).toBeNull();
  });

  it("links to the Add photos form with the confirmed date and place filled in", () => {
    expect(
      photoAddHref(
        "https://app.meetathena.io/r/job/x/photos?t=tok",
        "2026-11-03",
        " Office / ceiling ",
      ),
    ).toBe(
      "https://app.meetathena.io/r/job/x/photos?t=tok&date=2026-11-03&add=1&area=Office+%2F+ceiling",
    );
    expect(photoAddHref(null, "2026-11-03", "Office")).toBeNull();
    const job = "f568fe39-26d1-4c49-9d93-a9072a896c46";
    expect(photosHref(job, { date: "2026-11-03", add: true, area: "Level 1 & 2" })).toBe(
      `/r/job/${job}/photos?date=2026-11-03&add=1&area=Level%201%20%26%202`,
    );
    expect(photosHref(job, { area: "ignored without add" })).toBe(`/r/job/${job}/photos`);
  });

  it("opens a photo from its link", () => {
    expect(photoIdFromHash("#photo-A476B452-3ede-47da-9580-3754228db49f")).toBe(
      "a476b452-3ede-47da-9580-3754228db49f",
    );
    expect(photoIdFromHash("#field")).toBeNull();
  });

  it("groups by day, newest first, and labels days", () => {
    const groups = groupByDate([
      { taken_on: "2026-11-02" },
      { taken_on: "2026-11-03" },
      { taken_on: null },
      { taken_on: "2026-11-03" },
    ]);
    expect(groups.map((g) => [g.date, g.photos.length])).toEqual([
      ["2026-11-03", 2],
      ["2026-11-02", 1],
      [null, 1],
    ]);
    expect(longDate("2026-11-03")).toBe("Tuesday, November 3, 2026");
    expect(isIsoDate("2026-02-30")).toBe(false);
  });

  it("flags previews and formats sizes", () => {
    expect(isLowRes(120, 160)).toBe(true);
    expect(isLowRes(4032, 3024)).toBe(false);
    expect(formatBytes(1340)).toBe("1.3 KB");
    expect(formatBytes(3_400_000)).toBe("3.2 MB");
  });
});
