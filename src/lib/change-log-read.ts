import type { ChangeLogPayload } from "./mcp/change-orders";
import { boundedRequestRead } from "./request-log-read";
export type ChangeLogRpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: ChangeLogPayload | null; error: unknown }>;
export async function readChangeLog(rpc: ChangeLogRpc, job: string): Promise<ChangeLogPayload> {
  return boundedRequestRead(async () => {
    const { data, error } = await rpc("mcp_change_rows", { _job: job });
    if (error || !data || data.job_id !== job || !Array.isArray(data.records))
      throw new Error(
        "This account could not load the change-order log. Retry with the account connected to Athena.",
      );
    return data;
  });
}
