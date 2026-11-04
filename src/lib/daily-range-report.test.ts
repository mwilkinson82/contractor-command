import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import {
  dailyRangePath,
  dailyRangePeriod,
  dateRuns,
  readDailyRange,
  reported,
  type DailyRangeClient,
} from "./daily-range-report";
import { dailyRangePdf } from "./daily-range-pdf";

const JOB = "11111111-2222-4333-8444-555555555555";
type Call = { table: string; filters: [string, string, unknown][]; limit?: number };

function client(
  data: Record<string, Record<string, unknown>[]>,
  access: Record<string, unknown> = {},
) {
  const calls: Call[] = [];
  const rpcs: unknown[] = [];
  const c: DailyRangeClient = {
    rpc: (name, args) => {
      rpcs.push({ name, args });
      return Promise.resolve({
        data: {
          page: "field",
          scope: "full",
          job_number: "2810",
          job_name: "Lakeside Clinic",
          company: "ALP Construction",
          time_zone: "America/Manaus",
          ...access,
        },
        error: null,
      });
    },
    from: (table) => {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => (call.filters.push(["eq", col, v]), q),
        in: (col: string, v: unknown) => (call.filters.push(["in", col, v]), q),
        gte: (col: string, v: unknown) => (call.filters.push(["gte", col, v]), q),
        lte: (col: string, v: unknown) => (call.filters.push(["lte", col, v]), q),
        order: () => q,
        limit: (n: number) => ((call.limit = n), q),
        then: (ok: (r: { data: unknown; error: null }) => unknown) => {
          let rows = data[table] ?? [];
          for (const [op, col, v] of call.filters)
            rows = rows.filter((r) =>
              op === "eq"
                ? r[col] === v
                : op === "in"
                  ? (v as unknown[]).includes(r[col])
                  : op === "gte"
                    ? String(r[col]) >= String(v)
                    : String(r[col]) <= String(v),
            );
          return Promise.resolve({ data: rows, error: null }).then(ok);
        },
      };
      return q as never;
    },
  };
  return { c, calls, rpcs };
}

const daily = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
  id,
  job_id: JOB,
  report_date: date,
  weather: "Clear, 84F",
  manpower: "ALP 6 electricians, 8 hrs",
  subs_on_site: "None",
  deliveries: "Wire from CED",
  issues: "None",
  delays: "None",
  safety: "Toolbox talk on ladders",
  created_at: `${date}T21:00:00Z`,
  updated_at: `${date}T22:15:00Z`,
  ...extra,
});
const DATA = {
  mcp_daily_reports: [
    daily("d-1", "2026-11-02"),
    daily("d-2", "2026-11-03", { issues: "Ceiling grid not ready in corridor B.\nWaiting on GC." }),
    daily("d-other", "2026-11-03", { job_id: "other-job" }),
  ],
  mcp_daily_work_lines: [
    {
      job_id: JOB,
      daily_id: "d-1",
      line_no: 1,
      work: "Pull feeders to panel LP-2",
      qty: 420,
      unit: "LF",
      crew: 4,
      hours: 8,
      sov_item: "26.04",
      activity_id: "E-1040",
      pct_complete: null,
    },
    {
      job_id: JOB,
      daily_id: "d-2",
      line_no: 2,
      work: "Install track lighting, corridor A",
      qty: 18,
      unit: "EA",
      crew: 2,
      hours: 6,
      sov_item: null,
      activity_id: null,
      pct_complete: null,
    },
    {
      job_id: JOB,
      daily_id: "d-2",
      line_no: 1,
      work: "Rough-in boxes, rooms 101-108",
      qty: 32,
      unit: "EA",
      crew: 2,
      hours: 8,
      sov_item: "26.05",
      activity_id: "E-1100",
      pct_complete: 40,
    },
  ],
  mcp_progress_photos: [
    {
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      job_id: JOB,
      daily_id: "d-2",
      taken_on: "2026-11-03",
      area: "Corridor A",
      work: "Track lighting",
      sov_item: null,
      activity_id: null,
      client_safe: true,
      storage_path: "c/j/1/progress.jpg",
      mime_type: "image/jpeg",
      size_bytes: 1000,
      created_at: "2026-11-03T20:00:00Z",
    },
    {
      id: "aaaaaaaa-0000-4000-8000-000000000002",
      job_id: JOB,
      daily_id: null,
      taken_on: "2026-11-03",
      area: "Room 104",
      work: null,
      sov_item: "26.05",
      activity_id: null,
      client_safe: false,
      storage_path: "c/j/2/progress.png",
      mime_type: "image/png",
      size_bytes: 1000,
      created_at: "2026-11-03T20:05:00Z",
    },
    {
      id: "aaaaaaaa-0000-4000-8000-000000000003",
      job_id: JOB,
      daily_id: null,
      taken_on: "2026-11-05",
      area: "Electrical room",
      work: null,
      sov_item: null,
      activity_id: null,
      client_safe: false,
      storage_path: "c/j/3/progress.webp",
      mime_type: "image/webp",
      size_bytes: 1000,
      created_at: "2026-11-05T15:00:00Z",
    },
  ],
};

/** A small real PNG, so the PDF test draws an actual image. */
function png(w: number, h: number) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type), body]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(tb));
    return Buffer.concat([len, tb, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 255) / w;
      raw[o + 1] = 120;
      raw[o + 2] = (y * 255) / h;
    }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

describe("daily reports for a date range", () => {
  it("checks access first, then reads only this job's dailies, lines and photos in the range", async () => {
    const { c, calls, rpcs } = client(DATA);
    const r = await readDailyRange(
      c,
      JOB,
      { from: "2026-11-01", to: "2026-11-05" },
      new Date("2026-11-04T12:00:00Z"),
    );
    expect(rpcs).toEqual([
      { name: "mcp_report_page_get", args: { _page: "field", _job: JOB, _company: null } },
    ]);
    for (const call of calls) expect(call.filters).toContainEqual(["eq", "job_id", JOB]);
    expect(r.dailies_count).toBe(2);
    expect(r.days.map((d) => [d.date, !!d.daily, d.photos.length])).toEqual([
      ["2026-11-02", true, 0],
      ["2026-11-03", true, 2],
      ["2026-11-05", false, 1],
    ]);
    expect(r.days[1].daily!.lines.map((l) => l.line_no)).toEqual([1, 2]);
    expect(r.days[1].daily!.lines[1]).toMatchObject({ sov_item: null, activity_id: null });
    expect(r.no_daily_dates).toEqual(["2026-11-01", "2026-11-04", "2026-11-05"]);
    expect(r.photos_count).toBe(3);
  });

  it("can leave photos out or keep only client-safe ones", async () => {
    const none = await readDailyRange(client(DATA).c, JOB, {
      from: "2026-11-01",
      to: "2026-11-05",
      photos: "none",
    });
    expect(none.photos_count).toBe(0);
    expect(client(DATA).calls.some((c) => c.table === "mcp_progress_photos")).toBe(false);
    const safe = await readDailyRange(client(DATA).c, JOB, {
      from: "2026-11-01",
      to: "2026-11-05",
      photos: "client_safe",
    });
    expect(safe.days.flatMap((d) => d.photos.map((p) => p.area))).toEqual(["Corridor A"]);
  });

  it("refuses without full or assigned-super access, and refuses bad ranges", async () => {
    await expect(
      readDailyRange(client(DATA, { scope: "contract" }).c, JOB, {
        from: "2026-11-01",
        to: "2026-11-05",
      }),
    ).rejects.toThrow(/unavailable/);
    expect(() => dailyRangePeriod("2026-11-05", "2026-11-01")).toThrow(/on or before/);
    expect(() => dailyRangePeriod("2026-08-01", "2026-11-05")).toThrow(/at most 93 days/);
    expect(() => dailyRangePeriod("2026-11-01", undefined)).toThrow(/both/);
    expect(() => dailyRangePeriod("2026-02-30", "2026-03-01")).toThrow(/valid/);
    expect(dailyRangePath(JOB, { from: "2026-11-01", to: "2026-11-30" }, "client_safe")).toBe(
      `/r/job/${JOB}/daily-log?from=2026-11-01&to=2026-11-30&photos=client_safe`,
    );
  });

  it("names missing dates as runs and tells real issues from none", () => {
    expect(dateRuns(["2026-11-01", "2026-11-02", "2026-11-04"])).toBe(
      "Nov 1, 2026 - Nov 2, 2026, Nov 4, 2026",
    );
    expect(reported("None")).toBe(false);
    expect(reported("no delays.")).toBe(false);
    expect(reported("Ceiling grid not ready")).toBe(true);
  });

  it("builds a paged PDF with a summary, one daily per day, and photos drawn or listed", async () => {
    const r = await readDailyRange(
      client(DATA).c,
      JOB,
      { from: "2026-11-01", to: "2026-11-05" },
      new Date("2026-11-04T12:00:00Z"),
    );
    const photos = new Map([
      ["aaaaaaaa-0000-4000-8000-000000000001", { data: png(400, 300), format: "PNG" as const }],
      ["aaaaaaaa-0000-4000-8000-000000000002", { data: png(300, 400), format: "PNG" as const }],
      [
        "aaaaaaaa-0000-4000-8000-000000000003",
        { reason: "WebP photo on file in Athena. Open it in Athena to view." },
      ],
    ]);
    const bytes = dailyRangePdf(r, photos);
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text).toContain("/Producer (Athena");
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(4); // summary + 3 dates
    expect((text.match(/\/Subtype \/Image/g) ?? []).length).toBe(2);
    if (process.env.DAILY_RANGE_PDF_OUT) {
      mkdirSync(process.env.DAILY_RANGE_PDF_OUT, { recursive: true });
      writeFileSync(`${process.env.DAILY_RANGE_PDF_OUT}/sample.pdf`, bytes);
    }
  });
});
