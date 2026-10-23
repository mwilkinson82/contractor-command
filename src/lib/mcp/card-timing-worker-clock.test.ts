import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

it("starts request age at zero when the Worker module clock is zero", async () => {
  vi.resetModules();
  const now = vi.spyOn(Date, "now").mockReturnValue(0);
  const { beginCardTiming, timingFields } = await import("./card-timing");

  now.mockReturnValue(1_792_777_032_510);
  const first = beginCardTiming();
  expect(timingFields(first)).toMatchObject({
    requestNo: 1,
    isolateAgeMs: 0,
    cold: true,
    totalMs: 0,
  });

  now.mockReturnValue(1_792_777_032_760);
  expect(timingFields(beginCardTiming())).toMatchObject({
    requestNo: 2,
    isolateAgeMs: 250,
    cold: false,
    totalMs: 0,
  });
});
