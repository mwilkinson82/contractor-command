import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isUuid, jobHomePath } from "@/lib/report-pages";
import "./athena-brand.css";

export const ATHENA_BRAND_MARK = "/brand/athena/athena-mark-blue.svg";
export const ATHENA_FOOTER_WORDMARK = "/brand/athena/athena-wordmark-blue.svg";

function withToken(path: string, token?: string): string {
  return token ? `${path}?t=${encodeURIComponent(token)}` : path;
}

/** Project home for a saved job, or the morning brief when the page has no valid job. */
function homeHref(jobId: string | undefined, token?: string): string {
  return isUuid(jobId) ? withToken(jobHomePath(jobId), token) : "/today";
}

const companyNames = new Map<string, string | null>();

async function readCompanyName(jobId: string): Promise<string | null> {
  const j = await supabase.from("mcp_jobs").select("id,company_id").eq("id", jobId).maybeSingle();
  const job = j.error ? null : j.data;
  const companyId = job && job.id === jobId ? job.company_id : null;
  if (!companyId) return null;
  const c = await supabase
    .from("mcp_companies")
    .select("id,name")
    .eq("id", companyId)
    .maybeSingle();
  if (c.error || !c.data || c.data.id !== companyId) return null;
  const name = typeof c.data.name === "string" ? c.data.name.trim() : "";
  return name || null;
}

/**
 * The contractor's company name for a job, read in the browser through the same RLS-protected
 * job path the purchase order and payment pages use. Signed-out and token-only viewers get
 * nothing back, so the top bar then shows the Athena icon alone. Server renders show no name.
 */
export function useJobCompanyName(jobId: string | undefined, enabled = true): string | undefined {
  const [name, setName] = useState<string | null | undefined>(() =>
    jobId ? companyNames.get(jobId) : undefined,
  );
  useEffect(() => {
    if (!enabled || !isUuid(jobId)) return;
    if (companyNames.has(jobId)) {
      setName(companyNames.get(jobId));
      return;
    }
    let live = true;
    readCompanyName(jobId)
      .catch(() => null)
      .then((found) => {
        // A failed read is not cached, so signing in on the page can show the name next time.
        if (found) companyNames.set(jobId, found);
        if (live) setName(found);
      });
    return () => {
      live = false;
    };
  }, [jobId, enabled]);
  return enabled && name ? name : undefined;
}

/**
 * Top-left brand on every Athena web page: the small Athena icon, then the contractor's company
 * name in type. Never the contractor's uploaded logo, so two logos never sit side by side.
 */
export function AthenaBrand({
  jobId,
  token,
  company,
  href,
}: {
  jobId?: string;
  token?: string;
  /** Company name the page already has; when given, no extra read is made. */
  company?: string | null;
  href?: string;
}) {
  const given = company?.trim() || undefined;
  const fetched = useJobCompanyName(jobId, !given);
  return <BrandLink href={href ?? homeHref(jobId, token)} name={given ?? fetched} />;
}

function BrandLink({ href, name }: { href: string; name?: string }) {
  return (
    <a
      className="ath-brand"
      href={href}
      aria-label={name ? `Athena · ${name} · project home` : "Athena · project home"}
    >
      <img className="ath-brand-mark" src={ATHENA_BRAND_MARK} alt="" width={33} height={24} />
      {name ? (
        <>
          <span className="ath-brand-divider" aria-hidden="true" />
          <span className="ath-brand-name">{name}</span>
        </>
      ) : null}
    </a>
  );
}

/** Shared footer: the big Athena word bottom-left, with the page's way back home on the right. */
export function AthenaFooter({ jobId, token }: { jobId?: string; token?: string }) {
  return (
    <footer className="ath-footer">
      <img
        className="ath-footer-word"
        src={ATHENA_FOOTER_WORDMARK}
        alt="Athena"
        width={600}
        height={104}
      />
      <nav className="ath-footer-links" aria-label="Footer">
        {isUuid(jobId) ? <a href={homeHref(jobId, token)}>Project home</a> : null}
        <a href="/today">Morning brief</a>
      </nav>
    </footer>
  );
}
