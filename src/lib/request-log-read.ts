import type { RequestKind, RequestLogPayload } from "./mcp/request-log";

type Result = {
  data: RequestLogPayload | null;
  error: { code?: string; message?: string } | null;
  status?: number;
};
export type RequestLogRpc = (name: string, args: Record<string, unknown>) => PromiseLike<Result>;
export const REQUEST_READ_TIMEOUT_MS = 15000;

export async function boundedRequestRead<T>(
  work: () => PromiseLike<T>,
  ms = REQUEST_READ_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => await work())(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Loading the request log timed out. Please retry.")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Match the installed SDK's PromiseLike contract; every read has a bounded wait. */
export async function readRequestLog(
  rpc: RequestLogRpc,
  jobId: string,
  kind: RequestKind,
  ms = REQUEST_READ_TIMEOUT_MS,
): Promise<RequestLogPayload> {
  return boundedRequestRead(async () => {
    const result = await rpc("mcp_request_rows", { _job: jobId, _kind: kind });
    if (
      result.error ||
      !result.data ||
      result.data.job_id !== jobId ||
      !Array.isArray(result.data.records)
    )
      throw new Error(
        "This account could not load the request log. Retry or use the account connected to Athena in your chat.",
      );
    return result.data;
  }, ms);
}
