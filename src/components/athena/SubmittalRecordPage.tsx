import { useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  renderSubmittalRecordBody,
  submittalRecordPath,
  submittalRecordFile,
  submittalPackageTarget,
  type SubmittalRecordPayload,
} from "@/lib/submittal-record-page";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { openSubmittalRecord } from "@/lib/board-link.functions";
import { boardReturnForVisit } from "@/lib/board-sign-in";
import { BoardSignIn } from "@/components/athena/BoardSignIn";
import { REFRESH_MS, usePageVisible } from "@/components/athena/ReportPage";
import { SUBMITTAL_BUCKET } from "@/lib/mcp/submittal-package";
import { SubmittalPieceUpload } from "./SubmittalPieceUpload";

type Rpc = (
  f: string,
  a: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = (f: string, a: Record<string, unknown>) => (supabase.rpc as unknown as Rpc)(f, a);

type Cached = { stamp: string | null; payload: SubmittalRecordPayload };

/** Members sign each stored file with their own session; the storage policy decides what they may read. */
async function withMemberUrls(payload: SubmittalRecordPayload): Promise<SubmittalRecordPayload> {
  const sign = async (fileRef: string | null) => {
    const file = submittalRecordFile(payload, fileRef);
    if (!file) return null;
    const signed = await supabase.storage.from(file.bucket).createSignedUrl(file.path, 3600);
    return signed.data?.signedUrl ?? null;
  };
  const packages = await Promise.all(
    (payload.packages ?? []).map(async (p) => ({
      ...p,
      url: p.revoked_at ? null : await sign(`${SUBMITTAL_BUCKET}/${p.path}`),
    })),
  );
  const items = await Promise.all(
    (payload.current.package_items ?? []).map(async (item) => ({
      ...item,
      url: await sign(item.file_ref ?? null),
    })),
  );
  return { ...payload, packages, current: { ...payload.current, package_items: items } };
}

// The submittal record. A valid board token (the same one that opens the submittal log) works without a session.
// A missing or stale token shows the email-code sign-in and returns to this same address.
export function SubmittalRecordView({
  jobId,
  number,
  token,
  packageId,
}: {
  jobId: string;
  number: string;
  token?: string;
  packageId?: string;
}) {
  const openLink = useServerFn(openSubmittalRecord);
  const { session, loading: authLoading } = useAuth();
  const visible = usePageVisible();
  const qc = useQueryClient();
  const key = ["athena-submittal-record", jobId, number, session?.user?.id ?? null] as const;
  const args = { _job: jobId, _number: number };
  const q = useQuery({
    queryKey: key,
    enabled: !authLoading && !!session,
    refetchInterval: visible ? REFRESH_MS : false,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<Cached> => {
      const prev = qc.getQueryData<Cached>(key);
      const st = await rpc("mcp_submittal_record_stamp", args);
      if (st.error) throw new Error(st.error.message);
      const stamp = typeof st.data === "string" ? st.data : null;
      if (prev && stamp !== null && prev.stamp === stamp) return prev;
      const { data, error } = await rpc("mcp_submittal_record_get", args);
      if (error) throw new Error(error.message);
      return { stamp, payload: await withMemberUrls(data as SubmittalRecordPayload) };
    },
    retry: false,
  });
  const linked = useQuery({
    queryKey: ["athena-submittal-record-link", token ?? "", jobId, number],
    enabled: !authLoading && !!token,
    refetchInterval: visible ? REFRESH_MS : false,
    refetchIntervalInBackground: false,
    queryFn: () => openLink({ data: { token: token!, jobId, number } }),
    retry: false,
  });
  const memberPayload = session && !q.error ? q.data?.payload : undefined;
  const payload =
    memberPayload ??
    (!linked.error && linked.data?.status === "ok"
      ? (JSON.parse(linked.data.payload) as SubmittalRecordPayload)
      : undefined);
  const html = useMemo(() => {
    const body = payload ? renderSubmittalRecordBody(payload) : "";
    if (!token || !body) return body;
    const tokenQuery = `t=${encodeURIComponent(token)}`;
    return body.replace(
      /href="(\/r\/job\/[0-9a-f-]{36}\/[a-z]+)(?:\?[^"#]*)?"/g,
      (_match, path: string) => `href="${path}?${tokenQuery}"`,
    );
  }, [payload, token]);
  const packageTarget = payload ? submittalPackageTarget(payload, packageId) : null;
  const hasPayload = !!payload;
  useEffect(() => {
    if (packageTarget) window.location.replace(packageTarget);
  }, [packageTarget]);
  useEffect(() => {
    if (
      hasPayload &&
      (window.location.hash === "#upload" ||
        new URLSearchParams(window.location.search).get("upload") === "1")
    )
      document.getElementById("upload")?.scrollIntoView();
  }, [hasPayload]);
  const location =
    typeof window === "undefined"
      ? undefined
      : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const returnTo =
    boardReturnForVisit("submittals", jobId, location) ?? submittalRecordPath(jobId, number);
  if (authLoading || (!payload && ((session && q.isLoading) || (token && linked.isLoading))))
    return <div style={{ padding: 32, color: "#6B7280" }}>Loading…</div>;
  if (payload) {
    return (
      <div style={{ background: "#F3F4F6", minHeight: "100%" }}>
        {packageId && !packageTarget ? (
          <p role="status" style={{ padding: "16px 24px", color: "#6B7280" }}>
            That package could not be opened. The submittal record and its available files are
            below.
          </p>
        ) : null}
        <div dangerouslySetInnerHTML={{ __html: html }} />
        <section
          id="upload"
          style={{
            maxWidth: 1068,
            margin: "0 auto 24px",
            padding: 20,
            background: "#FFFFFF",
            color: "#1E3A5F",
            border: "1px solid #D1D5DB",
            borderRadius: 12,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
            Upload a package piece
          </h2>
          {memberPayload?.read_only === false ? (
            <SubmittalPieceUpload
              payload={memberPayload}
              onSaved={() => {
                void q.refetch();
                if (token) void linked.refetch();
              }}
            />
          ) : !session ? (
            <>
              <p style={{ marginBottom: 12 }}>
                Sign in with your job account to upload. This board link remains read only.
              </p>
              <BoardSignIn returnTo={returnTo} />
            </>
          ) : (
            <p>Full job access is required to upload a piece. This view remains read only.</p>
          )}
        </section>
      </div>
    );
  }
  return <BoardSignIn returnTo={returnTo} />;
}
