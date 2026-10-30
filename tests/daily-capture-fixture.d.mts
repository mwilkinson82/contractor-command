export const dailyFixture: Record<
  "company" | "job" | "otherJob" | "owner" | "super" | "contracts" | "outsider" | "pm",
  string
>;
export function installDailyCaptureFixture(
  query: (sql: string, args?: unknown[]) => Promise<{ rows: unknown[] }>,
): Promise<void>;
export function dailyLines(
  work?: string,
): {
  work: string;
  sov_item: string;
  activity_id: string;
  qty: number;
  unit: string;
  crew: number;
  hours: number;
  pct_complete: number;
}[];
export const captureSql: string;
export function captureArgs(
  request: string,
  day: string,
  work?: string,
  reviewedAt?: string,
  job?: string,
  confirmed?: boolean,
): unknown[];
export const legacySql: string;
