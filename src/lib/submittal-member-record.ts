import type { SubmittalRecordPayload } from "./submittal-record-page";

export type MemberRecordCache = { stamp: string | null; payload: SubmittalRecordPayload };
type RpcResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
  status?: number;
};
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;

/** Only these fields may reach the console/support details; never log the response or session. */
export class MemberRecordLookupError extends Error {
  readonly diagnostic: { rpc: string; code: string; status: number | null; message: string };
  constructor(error: unknown, status?: number) {
    const source = error as { message?: unknown; code?: unknown } | null;
    const message = String(source?.message ?? "The member record could not be read.")
      .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL removed]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, "[token removed]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]")
      .slice(0, 400);
    super(message);
    this.name = "MemberRecordLookupError";
    this.diagnostic = {
      rpc: "mcp_submittal_record_get",
      code:
        typeof source?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(source.code)
          ? source.code
          : "CLIENT_ERROR",
      status: Number.isInteger(status) && status! >= 100 && status! <= 599 ? status! : null,
      message,
    };
  }
}

/** A freshness shortcut or failed thumbnail must never decide a member's write permission. */
export async function loadMemberSubmittalRecord(
  rpc: Rpc,
  args: { _job: string; _number: string },
  previous: MemberRecordCache | undefined,
  sign: (record: SubmittalRecordPayload) => Promise<SubmittalRecordPayload>,
  fresh = false,
): Promise<MemberRecordCache> {
  let stampResult: RpcResult | null = null;
  if (!fresh) {
    try {
      // Supabase returns a PromiseLike builder, not a Promise with .catch().
      stampResult = await rpc("mcp_submittal_record_stamp", args);
    } catch {
      // A freshness failure must still proceed to the authoritative member read.
    }
  }
  const stamp =
    !stampResult?.error && typeof stampResult?.data === "string" ? stampResult.data : null;
  if (
    !fresh &&
    previous &&
    previous.payload.read_only === false &&
    stamp !== null &&
    previous.stamp === stamp
  )
    return previous;
  let read: RpcResult;
  try {
    read = await rpc("mcp_submittal_record_get", args);
  } catch (error) {
    throw new MemberRecordLookupError(error);
  }
  if (read.error || !read.data) throw new MemberRecordLookupError(read.error, read.status);
  const payload = read.data as SubmittalRecordPayload;
  if (payload.job_id !== args._job || !payload.current?.id)
    throw new MemberRecordLookupError(
      { code: "INVALID_RECORD", message: "The member record does not match this job." },
      read.status,
    );
  return { stamp, payload: await sign(payload) };
}
