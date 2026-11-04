import type { ReactNode } from "react";
import { AthenaBrand, AthenaFooter } from "./AthenaBrand";
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
        <div className="af-top">
          <AthenaBrand jobId={jobId} />
          <nav aria-label="Project navigation">
            <a href={`/r/job/${jobId}/home`}>← Project home</a>
          </nav>
        </div>
        <header className="af-header">
          <h1>{title}</h1>
          {description && <div className="af-description">{description}</div>}
        </header>
        <div className="af-content">{children}</div>
        <AthenaFooter jobId={jobId} />
      </div>
    </main>
  );
}
