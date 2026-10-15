import { Head, Section, Row, Column } from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
export const responsiveEmail = {
  main: {
    backgroundColor: "#E8E3DB",
    fontFamily: "Arial, Helvetica, sans-serif",
    margin: 0,
    padding: 0,
    width: "100%",
  },
  container: {
    width: "100%",
    maxWidth: "600px",
    margin: "0 auto",
    padding: 0,
    tableLayout: "fixed",
    overflowWrap: "anywhere",
    wordWrap: "break-word",
  },
  card: {
    backgroundColor: "#FFFFFF",
    border: 0,
    borderRadius: 0,
    width: "100%",
    tableLayout: "fixed",
  },
  body: { padding: "28px 16px 32px", width: "100%", tableLayout: "fixed" },
  button: {
    backgroundColor: "#F76A16",
    color: "#1C1A17",
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 15,
    lineHeight: "22px",
    fontWeight: 700,
    textDecoration: "none",
    padding: "14px 12px",
    borderRadius: 4,
    display: "block",
    textAlign: "center",
    boxSizing: "border-box",
    maxWidth: "100%",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
} as const;
export function ResponsiveEmailHead() {
  return (
    <Head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="x-apple-disable-message-reformatting" />
      <style>{`html,body{margin:0!important;padding:0!important;width:100%!important}table{border-collapse:collapse}td{overflow-wrap:break-word;word-wrap:break-word}img{max-width:100%;border:0}a{overflow-wrap:anywhere;word-break:break-word}`}</style>
    </Head>
  );
}

/** Cell padding survives collapsed tables in email clients; table padding does not. */
export function EmailSection({ style, children }: { style?: CSSProperties; children?: ReactNode }) {
  return (
    <Section
      style={{ width: "100%", tableLayout: "fixed", backgroundColor: style?.backgroundColor }}
    >
      <Row style={{ width: "100%", tableLayout: "fixed" }}>
        <Column style={{ overflowWrap: "anywhere", wordBreak: "break-word", ...style }}>
          {children}
        </Column>
      </Row>
    </Section>
  );
}
