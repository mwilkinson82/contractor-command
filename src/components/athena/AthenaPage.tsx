import type { ReactNode } from "react";
import { plainLabel, rowPlain } from "@/lib/mcp/plain-label";
import { cellClass } from "@/lib/mcp/cards/card-style";
import { isAlertLevel } from "@/lib/mcp/cards/palette";
import type { CardModel, CardRow, CardSection } from "@/lib/mcp/cards/model";
import { jobHomePath } from "@/lib/report-pages";
import "./athena-page.css";

/** Project home and morning brief links, kept on the board token when the page was opened with one. */
export function AthenaPageNav({ jobId, token }: { jobId?: string; token?: string }) {
  return (
    <nav className="ath-page-nav" aria-label="Project navigation">
      {jobId ? (
        <a href={`${jobHomePath(jobId)}${token ? `?t=${encodeURIComponent(token)}` : ""}`}>
          Project home
        </a>
      ) : null}
      <a href="/today">Morning brief</a>
    </nav>
  );
}

/**
 * Shared shell for Athena's web pages: full width on desktop, tablet tables at real width,
 * phone tables stacked into labelled cards (athena-page.css).
 */
export function AthenaPage({
  jobId,
  token,
  account,
  children,
}: {
  jobId?: string;
  token?: string;
  account?: string | null;
  children: ReactNode;
}) {
  return (
    <main className="ath-page">
      <div className="ath-page-wrap">
        <div className="ath-page-top">
          <span className="ath-page-mark">Athena</span>
          <div className="ath-page-nav">
            {account ? <span className="ath-page-account" role="status">Browser account: {account}</span> : null}
            <AthenaPageNav jobId={jobId} token={token} />
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

function cellText(value: string): string {
  if (!value.trim()) return "";
  const shown = plainLabel(value);
  return shown.refId && shown.label === "Item" ? "" : shown.label;
}

function flagLabel(flag: CardRow["flag"]): string | null {
  if (flag === "delay") return "Delay";
  if (flag === "overdue") return "Overdue";
  if (flag === "risk") return "Risk";
  return null;
}

function RowLink({ row, text }: { row: CardRow; text: string }) {
  const view = rowPlain(row);
  const label = text || view.label;
  return (
    <span data-id={view.refId ?? undefined}>
      {view.href ? <a href={view.href}>{label}</a> : label}
      {view.secondary ? <span className="ath-page-ref">{view.secondary}</span> : null}
    </span>
  );
}

/** A table whose only row is a message ("No RFIs on this job yet.") reads as an empty state, not a row. */
function emptyMessage(section: CardSection): string | null {
  if (section.rows.length !== 1) return null;
  const [row] = section.rows;
  if (row.href || row.flag) return null;
  const filled = row.cells.filter((cell) => cell.trim());
  return filled.length === 1 && row.cells[0].trim() ? row.cells[0] : null;
}

function TableSection({ section }: { section: CardSection }) {
  const empty = emptyMessage(section);
  if (empty) return <p className="ath-page-empty">{empty}</p>;
  const width = Math.max(section.columns?.length ?? 0, ...section.rows.map((r) => r.cells.length), 1);
  const columns = Array.from({ length: width }, (_, i) => section.columns?.[i] ?? "");
  return (
    <div className="ath-page-table-wrap" tabIndex={0} role="region" aria-label={section.heading}>
      <table className="ath-page-table">
        <thead>
          <tr>
            {columns.map((label, i) => (
              <th key={i} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row, r) => {
            const flag = isAlertLevel(row.flag) ? flagLabel(row.flag) : null;
            return (
              <tr key={r} data-alert={flag ? row.flag ?? undefined : undefined}>
                {columns.map((label, i) => {
                  const text = cellText(row.cells[i] ?? "");
                  const kind = cellClass(text);
                  const cls = !text && i > 0 ? "is-blank" : kind ? `is-${kind}` : undefined;
                  return (
                    <td key={i} className={cls} data-label={label || undefined}>
                      {i === 0 && flag ? <span className="ath-page-flag">{flag}</span> : null}
                      {i === (row.linkCell ?? 0) ? <RowLink row={row} text={text} /> : text}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ListSection({ section }: { section: CardSection }) {
  return (
    <ul>
      {section.rows.map((row, r) => (
        <li key={r} className={row.tone === "literal" ? "ath-page-literal" : undefined}>
          {isAlertLevel(row.flag) ? <span className="ath-page-flag">{flagLabel(row.flag)}</span> : null}
          {row.tone === "literal" ? (
            row.cells.join("\n")
          ) : row.raw ? (
            row.cells.filter(Boolean).join(" · ")
          ) : (
            <RowLink row={row} text="" />
          )}
        </li>
      ))}
    </ul>
  );
}

function LinkSection({ section }: { section: CardSection }) {
  return (
    <ul className="ath-page-links">
      {section.rows.map((row, r) => (
        <li key={r}>
          <RowLink row={row} text={rowPlain(row).label} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The same CardModel the chat card shows, laid out as a web page. `skip` drops sections that only
 * make sense inside chat (for example the link back to this very page).
 */
export function CardModelPage({
  card,
  filters,
  skip = [],
  footer,
}: {
  card: CardModel;
  filters?: ReactNode;
  skip?: string[];
  footer?: ReactNode;
}) {
  const sections = (card.sections ?? []).filter((s) => !skip.includes(s.heading));
  const alerts = (card.alerts ?? []).filter((a) => isAlertLevel(a.level));
  return (
    <>
      <header className="ath-page-head">
        <div>
          <h1>{card.title}</h1>
          {card.job ? <p className="ath-page-sub">{card.job}</p> : null}
        </div>
        {filters ? <div className="ath-page-filters">{filters}</div> : null}
      </header>
      <div className="ath-page-content">
        {card.kpis?.length ? (
          <dl className="ath-page-kpis">
            {card.kpis.map((kpi) => (
              <div
                key={kpi.label}
                className="ath-page-kpi"
                data-alert={isAlertLevel(kpi.flag) && kpi.value !== "0" ? kpi.flag! : undefined}
              >
                <dt>{kpi.label}</dt>
                <dd>{kpi.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {alerts.map((alert, i) => (
          <div key={i} className="ath-page-alert" role="note">
            <strong>{flagLabel(alert.level)}</strong>
            {alert.text}
          </div>
        ))}
        {card.ask?.prompt ? (
          <section className="ath-page-panel">
            <h2>This question</h2>
            <p>{card.ask.prompt}</p>
          </section>
        ) : null}
        {sections.map((section, i) => (
          <section key={`${section.heading}-${i}`} className="ath-page-panel">
            <h2>{section.heading}</h2>
            {!section.rows.length ? (
              <p className="ath-page-empty">Nothing here yet.</p>
            ) : section.kind === "table" ? (
              <TableSection section={section} />
            ) : section.kind === "chips" ? (
              <LinkSection section={section} />
            ) : (
              <ListSection section={section} />
            )}
          </section>
        ))}
        {card.next_move ? (
          <p className="ath-page-next">
            <strong>Next move:</strong> {card.next_move}
          </p>
        ) : null}
      </div>
      {footer ?? <p className="ath-page-foot">Private to your company · Athena powered by ALP</p>}
    </>
  );
}
