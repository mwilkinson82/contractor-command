import { EmailSection } from "./_responsive";
import type { ReactNode } from "react";
import { Column, Img, Row, Section, Text } from "@react-email/components";
import { contractorCircleBrand } from "@/lib/contractor-circle-brand";

/** Fluid table structure and modest default padding work even without media queries. */
export function ContractorCircleEmailHeader({
  label = "Member communication",
  inverse = false,
}: {
  label?: string;
  inverse?: boolean;
}) {
  return (
    <EmailSection style={{ ...styles.header, ...(inverse ? { backgroundColor: "#1C1A17" } : {}) }}>
      <Img
        src={inverse ? contractorCircleBrand.emailMarkInverse : contractorCircleBrand.emailMark}
        width="280"
        alt="Contractor Circle by ALP"
        style={{ display: "block", width: "100%", maxWidth: 280, height: "auto" }}
      />
      <Text style={{ ...styles.label, ...(inverse ? { color: "#F7F2EA" } : {}) }}>{label}</Text>
    </EmailSection>
  );
}
export function ContractorCircleEmailFooter({ children }: { children?: ReactNode }) {
  return (
    <EmailSection style={styles.footer}>
      <Text style={styles.footerLine}>{children ?? "Build the company behind the projects."}</Text>
      <Text style={styles.label}>AN ALP COMMUNITY</Text>
    </EmailSection>
  );
}
const styles = {
  header: {
    backgroundColor: "#F7F2EA",
    borderTop: `5px solid ${contractorCircleBrand.emailAccent}`,
    padding: "26px 16px 20px",
    width: "100%",
    tableLayout: "fixed",
  },
  wordmark: {
    color: "#1C1A17",
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 17,
    fontWeight: 800,
    letterSpacing: "-0.5px",
    lineHeight: "18px",
    margin: 0,
  },
  by: {
    color: "#1C1A17",
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 11,
    lineHeight: "14px",
    margin: "5px 0 0",
  },
  label: {
    color: "#6B6259",
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 10,
    lineHeight: "17px",
    letterSpacing: "1.35px",
    textTransform: "uppercase",
    margin: "18px 0 0",
    overflowWrap: "anywhere",
  },
  footer: { backgroundColor: "#F7F2EA", padding: "28px 16px", width: "100%", tableLayout: "fixed" },
  footerLine: {
    color: "#1C1A17",
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: "20px",
    margin: 0,
    overflowWrap: "anywhere",
  },
} as const;
