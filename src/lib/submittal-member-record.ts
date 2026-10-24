import type { SubmittalRecordPayload } from "./submittal-record-page";

export type MemberRecordCache = { stamp: string | null; payload: SubmittalRecordPayload };
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** A freshness shortcut or failed thumbnail must never decide a member's write permission. */
export async function loadMemberSubmittalRecord(
  rpc: Rpc,
  args: { _job: string; _number: string },
  previous: MemberRecordCache | undefined,
  sign: (record: SubmittalRecordPayload) => Promise<SubmittalRecordPayload>,
  fresh = false,
): Promise<MemberRecordCache> {
  const stampResult = fresh
    ? null
    : await rpc("mcp_submittal_record_stamp", args).catch(() => null);
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
  const read = await rpc("mcp_submittal_record_get", args);
  if (read.error || !read.data)
    throw new Error(read.error?.message ?? "The member record could not be read.");
  const payload = read.data as SubmittalRecordPayload;
  if (payload.job_id !== args._job || !payload.current?.id)
    throw new Error("The member record does not match this job.");
  return { stamp, payload: await sign(payload) };
}
