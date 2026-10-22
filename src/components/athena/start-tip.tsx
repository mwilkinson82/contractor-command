import { START_EXAMPLES, START_HEADLINE, START_HOSTS, START_NEXT, START_WHY } from "@/lib/athena-start-copy";
import { BLUE, GRAY, NAVY, WHITE } from "@/lib/mcp/cards/palette";

/** Athena-branded start tip. Navy, blue, and gray. No alert red. */
export function AthenaStartTip() {
  return (
    <section
      data-testid="athena-start-tip"
      style={{
        maxWidth: 640,
        border: `1px solid ${GRAY}`,
        borderRadius: 14,
        overflow: "hidden",
        background: WHITE,
        color: NAVY,
        font: "15px/1.45 system-ui, sans-serif",
      }}
    >
      <header style={{ background: NAVY, color: WHITE, padding: "16px 18px" }}>
        <p style={{ margin: "0 0 6px", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase" }}>Athena</p>
        <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.25 }}>{START_HEADLINE}</h2>
        <p style={{ margin: "6px 0 0", opacity: 0.9 }}>{START_HOSTS}</p>
      </header>
      <div style={{ padding: "16px 18px" }}>
        <p
          style={{
            display: "inline-block",
            margin: "0 0 10px",
            padding: "3px 8px",
            borderRadius: 999,
            background: BLUE,
            color: WHITE,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Start here
        </p>
        <p style={{ margin: 0 }}>{START_WHY}</p>
        <h3 style={{ margin: "16px 0 8px", fontSize: 14 }}>Try one</h3>
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {START_EXAMPLES.map((ask) => (
            <li key={ask} style={{ margin: "8px 0", padding: "8px 12px", borderLeft: `4px solid ${BLUE}` }}>
              {ask}
            </li>
          ))}
        </ul>
        <p style={{ margin: "14px 0 0", fontWeight: 700 }}>{START_NEXT}</p>
      </div>
    </section>
  );
}
