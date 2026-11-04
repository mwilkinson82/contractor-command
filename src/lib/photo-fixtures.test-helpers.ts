/** Test-only JPEG builders with real marker structure (frame, tables, scan), optionally with EXIF. */
const seg = (marker: number, body: number[]) => [
  0xff,
  marker,
  ((body.length + 2) >> 8) & 0xff,
  (body.length + 2) & 0xff,
  ...body,
];

function exifApp1(opts: { make: string; model: string; date: string; gps?: boolean }): number[] {
  // Little-endian TIFF: IFD0 with Make, Model, ExifIFD pointer (+ GPS pointer), Exif IFD with DateTimeOriginal.
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const make = ascii(opts.make);
  const model = ascii(opts.model);
  const date = ascii(opts.date);
  const ifd0Count = opts.gps ? 4 : 3;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const makeAt = 8 + ifd0Size;
  const modelAt = makeAt + make.length;
  const exifAt = modelAt + model.length;
  const exifSize = 2 + 12 + 4;
  const dateAt = exifAt + exifSize;
  const entry = (tag: number, type: number, count: number, value: number[]) => [
    ...le16(tag),
    ...le16(type),
    ...le32(count),
    ...value,
  ];
  const tiff = [
    0x49,
    0x49,
    0x2a,
    0x00,
    ...le32(8),
    ...le16(ifd0Count),
    ...entry(0x010f, 2, make.length, le32(makeAt)),
    ...entry(0x0110, 2, model.length, le32(modelAt)),
    ...entry(0x8769, 4, 1, le32(exifAt)),
    ...(opts.gps ? entry(0x8825, 4, 1, le32(dateAt + date.length)) : []),
    ...le32(0),
    ...make,
    ...model,
    ...le16(1),
    ...entry(0x9003, 2, date.length, le32(dateAt)),
    ...le32(0),
    ...date,
  ];
  return seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
}

export function testJpeg(
  width: number,
  height: number,
  exif?: { make: string; model: string; date: string; gps?: boolean },
): Uint8Array<ArrayBuffer> {
  const app0 = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const dqt = seg(0xdb, [0, ...new Array(64).fill(1)]);
  const sof = seg(0xc0, [
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    1,
    1,
    0x11,
    0,
  ]);
  const dht = seg(0xc4, [0, 1, ...new Array(15).fill(0), 0]);
  const sos = seg(0xda, [1, 1, 0, 0, 0x3f, 0]);
  const scan = new Array(128).fill(0x2a);
  return Uint8Array.from([
    0xff,
    0xd8,
    ...(exif ? exifApp1(exif) : []),
    ...app0,
    ...dqt,
    ...sof,
    ...dht,
    ...sos,
    ...scan,
    0xff,
    0xd9,
  ]);
}

/** The shape of the broken 2810 file: JFIF header and quant tables, then bytes that are not JPEG structure. */
export function brokenJpeg(): Uint8Array<ArrayBuffer> {
  const app0 = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const dqt = seg(0xdb, [0, ...new Array(64).fill(1)]);
  return Uint8Array.from([
    0xff,
    0xd8,
    ...app0,
    ...dqt,
    ...dqt,
    0x11,
    0x22,
    ...new Array(2000).fill(0x33),
    0xff,
    0xd9,
  ]);
}
