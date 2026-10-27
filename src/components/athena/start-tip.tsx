import {
  CONNECTOR_ROUTE,
  COST_CODE_ASK,
  COST_CODE_ROUTE,
  DOCUMENT_ASK,
  DOCUMENT_ROUTE,
  MEMORY_BONUS,
  MEMORY_WAIT,
  NAVIGATION_LINE,
  START_BACKUP,
  START_EXAMPLES,
  START_HABIT,
  START_HEADLINE,
  START_HOSTS,
  START_POINTS,
} from "@/lib/athena-start-copy";
import { onboardingCss } from "@/lib/mcp/cards/onboarding-style";
import { BLUE, GRAY, NAVY, WHITE } from "@/lib/mcp/cards/palette";

/** The existing connection handoff: one useful next step, then optional details. */
export function AthenaStartTip() {
  return (
    <section
      data-testid="athena-start-tip"
      data-presentation="onboarding"
      className="card"
      style={{
        maxWidth: 640,
        overflow: "hidden",
        background: WHITE,
        color: NAVY,
        font: "15px/1.5 system-ui, sans-serif",
      }}
    >
      <style>{onboardingCss}</style>
      <header>
        <p className="mark">Athena · Start here</p>
        <h1>{START_HEADLINE}</h1>
        <p className="job">{START_HOSTS}</p>
      </header>
      <div className="body">
        <section className="framed">
          <h2>One useful first step</h2>
          <p style={{ margin: 0 }}>
            In your connected chat, say <strong>“Start a job”</strong> or{" "}
            <strong>“Show my job list.”</strong>
          </p>
        </section>
        <h2>Try asking</h2>
        <div aria-label="Example requests">
          {START_EXAMPLES.map((ask) => (
            <span key={ask} className="chip">
              {ask}
            </span>
          ))}
        </div>
        <p style={{ margin: "10px 0 16px" }}>{START_POINTS[0]}</p>
        <details style={{ borderTop: `1px solid ${GRAY}33`, padding: "12px 0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 650, color: BLUE }}>
            Bring existing documents and cost codes
          </summary>
          <p>{DOCUMENT_ASK}</p>
          <p>{DOCUMENT_ROUTE}</p>
          <p>{CONNECTOR_ROUTE}</p>
          <p>
            <strong>{COST_CODE_ASK}</strong>
          </p>
          <p>{COST_CODE_ROUTE}</p>
          <p>
            You can begin without every file. Name an already supplied file so Athena can use the
            saved source before asking for another upload.
          </p>
        </details>
        <details style={{ borderTop: `1px solid ${GRAY}33`, padding: "12px 0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 650 }}>
            Using your connected chat
          </summary>
          <p>{START_HABIT}</p>
          <p>{START_BACKUP}</p>
          <p>{MEMORY_BONUS}</p>
          <p>{MEMORY_WAIT}</p>
        </details>
        <p style={{ margin: "8px 0 0", color: GRAY, fontSize: 13 }}>{NAVIGATION_LINE}</p>
      </div>
    </section>
  );
}
