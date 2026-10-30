import type { ReactNode } from "react";
import "./accounting-workspace.css";

/** Presentation only. Access, evidence and all financial calculations stay with each page. */
export function AccountingWorkspace({
  jobId,
  title,
  description,
  children,
  className = "",
}: {
  jobId: string;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <main className={`accounting-workspace ${className}`}>
      <div className="af-wrap">
        <nav className="af-top" aria-label="Project navigation">
          <a href={`/r/job/${jobId}/home`}>← Project home</a>
          <span>Athena · Accounting</span>
        </nav>
        <header className="af-header">
          <h1>{title}</h1>
          {description && <div className="af-description">{description}</div>}
        </header>
        <div className="af-content">{children}</div>
      </div>
    </main>
  );
}
