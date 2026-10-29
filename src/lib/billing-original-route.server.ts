import { z } from "zod";
import { supabaseForToken } from "./mcp/supabase";
import { FileRejected } from "./mcp/file-share";
import {
  readVerifiedCostReceipt,
  readVerifiedFinancialOriginal,
} from "./mcp/billing-original.server";

const uuid = z.string().uuid();
export async function handleBillingOriginalDownload(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i);
  if (!auth)
    return new Response("Authentication required.", {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  const url = new URL(request.url);
  const job = uuid.safeParse(url.searchParams.get("job"));
  const document = uuid.safeParse(url.searchParams.get("document"));
  const costRecordRaw = url.searchParams.get("cost_record");
  const costRecord = costRecordRaw === null ? null : uuid.safeParse(costRecordRaw);
  if (!job.success || !document.success || (costRecord && !costRecord.success))
    return new Response("Original unavailable.", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  try {
    const sb = supabaseForToken(auth[1]);
    const result = costRecord?.success
      ? await readVerifiedCostReceipt(sb, auth[1], job.data, costRecord.data, document.data)
      : await readVerifiedFinancialOriginal(sb, auth[1], job.data, document.data);
    return new Response(result.bytes as BodyInit, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof FileRejected && /over 10 MB/.test(error.message))
      return new Response("The original exceeds the 10 MiB limit and cannot be opened.", {
        status: 413,
        headers: { "cache-control": "no-store" },
      });
    return new Response("Original unavailable or could not be verified.", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
}
