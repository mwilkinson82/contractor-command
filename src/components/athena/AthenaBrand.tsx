import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isUuid, jobHomePath } from "@/lib/report-pages";
import { companyBoardPath } from "@/lib/company-board";
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

type JobCompany = { id: string; name: string | null };
const jobCompanies = new Map<string, JobCompany>();

async function readJobCompany(jobId: string): Promise<JobCompany | null> {
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
  return { id: companyId, name: name || null };
}

/**
 * The job's company as a signed-in member sees it, read in the browser through the same RLS-protected job path the
 * purchase order and payment pages use. Signed-out and token-only viewers get nothing back, so the top bar then
 * shows no company link. Server renders read nothing.
 */
export function useJobCompany(jobId: string | undefined, enabled = true): JobCompany | undefined {
  const [found, setFound] = useState<JobCompany | null | undefined>(() =>
    jobId ? jobCompanies.get(jobId) : undefined,
  );
  useEffect(() => {
    if (!enabled || !isUuid(jobId)) return;
    if (jobCompanies.has(jobId)) {
      setFound(jobCompanies.get(jobId));
      return;
    }
    let live = true;
    readJobCompany(jobId)
      .catch(() => null)
      .then((hit) => {
        // A failed read is not cached, so signing in on the page can show the name next time.
        if (hit) jobCompanies.set(jobId, hit);
        if (live) setFound(hit);
      });
    return () => {
      live = false;
    };
  }, [jobId, enabled]);
  return enabled && found ? found : undefined;
}

/** The contractor's company name for a job, for signed-in members only. */
export function useJobCompanyName(jobId: string | undefined, enabled = true): string | undefined {
  return useJobCompany(jobId, enabled)?.name ?? undefined;
}

/**
 * Top-left brand on every Athena web page: the small Athena icon, then the contractor's company name in type. Never
 * the contractor's uploaded logo, so two logos never sit side by side. For a signed-in member on a job page, the
 * company name opens the company board (Nov 5 2026) and the icon still goes to project home.
 */
export function AthenaBrand({
  jobId,
  token,
  company,
  href,
}: {
  jobId?: string;
  token?: string;
  /** Company name the page already has; the member read then only adds the company board link. */
  company?: string | null;
  href?: string;
}) {
  const given = company?.trim() || undefined;
  const found = useJobCompany(jobId);
  const name = given ?? found?.name ?? undefined;
  const home = href ?? homeHref(jobId, token);
  if (found && name) return <SplitBrand home={home} name={name} board={companyBoardPath(found.id)} />;
  return <BrandLink href={home} name={name} />;
}

function SplitBrand({ home, name, board }: { home: string; name: string; board: string }) {
  return (
    <span className="ath-brand ath-brand-split">
      <a className="ath-brand-home" href={home} aria-label="Athena · project home">
        <img className="ath-brand-mark" src={ATHENA_BRAND_MARK} alt="" width={33} height={24} />
      </a>
      <span className="ath-brand-divider" aria-hidden="true" />
      <a className="ath-brand-name" href={board} title={`${name} company board`} aria-label={`${name} · company board`}>
        {name}
      </a>
    </span>
  );
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
