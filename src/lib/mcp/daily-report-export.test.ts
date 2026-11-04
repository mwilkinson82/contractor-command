// daily_report_export: every saved daily in a date range as one PDF with that day's photos.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";

const JOB_ID = "41000000-0000-4000-8000-000000000001";
const store = vi.hoisted(() => ({
  uploads: [] as { path: string; bytes: Uint8Array; mime: string }[],
  downloads: [] as string[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  scope: "full" as "full" | "super",
  tables: {} as Record<string, Record<string, unknown>[]>,
  png: new Uint8Array(),
}));

function query(table: string) {
  const filters: [string, string, unknown][] = [];
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), q),
    is: (c: string, v: unknown) => (filters.push(["is", c, v]), q),
    in: (c: string, v: unknown) => (filters.push(["in", c, v]), q),
    gte: (c: string, v: unknown) => (filters.push(["gte", c, v]), q),
    lte: (c: string, v: unknown) => (filters.push(["lte", c, v]), q),
    order: () => q,
    limit: () => q,
    then: (ok: (r: unknown) => unknown) => {
      let rows = store.tables[table] ?? [];
      for (const [op, c, v] of filters)
        rows = rows.filter((r) =>
          op === "eq"
            ? r[c] === v
            : op === "is"
              ? (r[c] ?? null) === v
              : op === "in"
                ? (v as unknown[]).includes(r[c])
                : op === "gte"
                  ? String(r[c]) >= String(v)
                  : String(r[c]) <= String(v),
        );
      return Promise.resolve({ data: rows, error: null }).then(ok);
    },
  };
  return q;
}
const fakeSb = () => ({
  from: query,
  storage: {
    from: () => ({
      upload: async (path: string, bytes: Uint8Array, o: { contentType: string }) => (
        store.uploads.push({ path, bytes, mime: o.contentType }),
        { error: null }
      ),
      download: async (path: string) => (
        store.downloads.push(path),
        { data: new Blob([store.png as Uint8Array<ArrayBuffer>]), error: null }
      ),
      createSignedUrl: async (p: string) => ({
        data: { signedUrl: `https://store.test/${p}?sig=1` },
        error: null,
      }),
      remove: async () => ({ error: null }),
    }),
  },
  rpc: async (fn: string, args: Record<string, unknown>) => {
    store.rpcs.push({ fn, args });
    if (fn === "mcp_report_page_get")
      return {
        data: {
          page: "field",
          scope: store.scope,
          job_number: "2810",
          job_name: "Lakeside Clinic",
          company: "ALP Construction",
          time_zone: "America/Manaus",
        },
        error: null,
      };
    return { data: null, error: null };
  },
});
vi.mock("./guard", async (orig) => ({
  ...(await orig<typeof import("./guard")>()),
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) =>
    fn(fakeSb()),
}));
vi.mock("./jobs", async (orig) => ({
  ...(await orig<typeof import("./jobs")>()),
  resolveJob: async () => ({
    job_id: JOB_ID,
    company_id: "c1",
    job_number: "2810",
    name: "Lakeside Clinic",
    scope: store.scope,
    company_name: "ALP",
  }),
  audit: async () => {},
  prefix: () => "",
}));
vi.mock("./tools/workflow-tools", async (orig) => ({
  ...(await orig<typeof import("./tools/workflow-tools")>()),
  namedOrSoleJob: async () => ({ job_number: "2810", company_id: "c1" }),
}));
vi.mock("./visible", async (orig) => ({
  ...(await orig<typeof import("./visible")>()),
  guide: (r: Record<string, unknown>, ...g: string[]) => ({ ...r, guidance: g }),
}));

import { dailyReportExport } from "./tools/superintendent-tools";

function png(w: number, h: number) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, body: Buffer) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(t), body]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(tb));
    return Buffer.concat([l, tb, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk(
        "IDAT",
        deflateSync(
          Buffer.concat(
            Array.from({ length: h }, () =>
              Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 90)]),
            ),
          ),
        ),
      ),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
type Out = {
  isError?: boolean;
  structuredContent: Record<string, unknown> & { no_daily_dates: string[]; download_url: string };
};
const call = async (a: Record<string, unknown>): Promise<Out> =>
  (dailyReportExport as unknown as { handler: (a: unknown, c: unknown) => Promise<Out> }).handler(
    a,
    { authInfo: { token: "t" } },
  );

beforeEach(() => {
  store.uploads = [];
  store.downloads = [];
  store.rpcs = [];
  store.scope = "full";
  store.png = png(64, 48);
  store.tables = {
    mcp_daily_reports: [
      {
        id: "d1",
        job_id: JOB_ID,
        report_date: "2026-11-03",
        weather: "Clear",
        manpower: "6 electricians",
        subs_on_site: "None",
        deliveries: "None",
        issues: "None",
        delays: "None",
        safety: "Toolbox talk",
        created_at: "2026-11-03T21:00:00Z",
        updated_at: "2026-11-03T21:00:00Z",
      },
    ],
    mcp_daily_work_lines: [
      {
        job_id: JOB_ID,
        daily_id: "d1",
        line_no: 1,
        work: "Track lighting corridor A",
        qty: 18,
        unit: "EA",
        crew: 2,
        hours: 6,
        sov_item: null,
        activity_id: null,
        pct_complete: null,
      },
    ],
    mcp_progress_photos: [
      {
        id: "p1",
        job_id: JOB_ID,
        daily_id: "d1",
        taken_on: "2026-11-03",
        area: "Corridor A",
        work: null,
        sov_item: null,
        activity_id: null,
        client_safe: false,
        storage_path: "c1/j/p1/progress.png",
        mime_type: "image/png",
        size_bytes: 5000,
        created_at: "2026-11-03T20:00:00Z",
      },
      {
        id: "p2",
        job_id: JOB_ID,
        daily_id: "d1",
        taken_on: "2026-11-03",
        area: "Corridor B",
        work: null,
        sov_item: null,
        activity_id: null,
        client_safe: false,
        storage_path: "c1/j/p2/progress.webp",
        mime_type: "image/webp",
        size_bytes: 5000,
        created_at: "2026-11-03T20:01:00Z",
      },
    ],
  };
});

describe("daily_report_export", () => {
  it("stores one PDF with the range's dailies and draws the photos it can, and says which it could not", async () => {
    const r = await call({ job_number: "2810", date_from: "2026-11-01", date_to: "2026-11-07" });
    expect(r.isError).toBeFalsy();
    expect(store.uploads).toHaveLength(1);
    expect(store.uploads[0].mime).toBe("application/pdf");
    const pdf = Buffer.from(store.uploads[0].bytes).toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect((pdf.match(/\/Subtype \/Image/g) ?? []).length).toBe(1);
    expect(store.downloads).toEqual(["c1/j/p1/progress.png"]);
    expect(r.structuredContent).toMatchObject({
      pdf: true,
      filename: "2810 Daily Reports 2026-11-01 to 2026-11-07.pdf",
      dailies_count: 1,
      photos_count: 2,
      photos_not_drawn: 1,
      attached: false,
      page_url: `https://app.meetathena.io/r/job/${JOB_ID}/daily-log?from=2026-11-01&to=2026-11-07`,
    });
    expect(r.structuredContent.no_daily_dates).toHaveLength(6);
    expect(r.structuredContent.download_url).toMatch(/^https:\/\/app\.meetathena\.io\/f\//);
    expect(store.rpcs.map((c) => c.fn)).toEqual(["mcp_report_page_get", "mcp_file_share_create"]);
  });

  it("gives superintendent access the printable page and makes no share link", async () => {
    store.scope = "super";
    const r = await call({
      job_number: "2810",
      date_from: "2026-11-01",
      date_to: "2026-11-07",
      photos: "none",
    });
    expect(store.uploads).toHaveLength(0);
    expect(r.structuredContent).toMatchObject({
      pdf: false,
      page_url: `https://app.meetathena.io/r/job/${JOB_ID}/daily-log?from=2026-11-01&to=2026-11-07&photos=none`,
    });
  });

  it("refuses a backwards or too-long range without making anything", async () => {
    await expect(
      call({ job_number: "2810", date_from: "2026-11-07", date_to: "2026-11-01" }),
    ).rejects.toThrow(/on or before.*Nothing was made/);
    await expect(
      call({ job_number: "2810", date_from: "2026-01-01", date_to: "2026-11-01" }),
    ).rejects.toThrow(/at most 93 days/);
    expect(store.uploads).toHaveLength(0);
  });
});
