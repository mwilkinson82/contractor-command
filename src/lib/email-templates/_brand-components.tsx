import type { ReactNode } from "react";
import { Column, Img, Row, Section, Text } from "@react-email/components";
import { emailBrand } from "./_brand";

const APP_ORIGIN = "https://app.alpcontractorcircle.com";
const HORIZONTAL_LOGO_URL = `${APP_ORIGIN}/email/contractor-circle-horizontal.png`;
const MARK_LOGO_URL = `${APP_ORIGIN}/email/contractor-circle-mark.png`;

interface ContractorCircleEmailHeaderProps {
  label?: string;
}

export function ContractorCircleEmailHeader({
  label = "Member communication",
}: ContractorCircleEmailHeaderProps) {
  return (
    <Section style={styles.header}>
      <Row>
        <Column>
          <Img
            src={HORIZONTAL_LOGO_URL}
            width="224"
            height="80"
            alt="Contractor Circle"
            style={styles.wordmark}
          />
        </Column>
        <Column align="right" style={styles.labelColumn}>
          <Text style={styles.label}>{label}</Text>
        </Column>
      </Row>
    </Section>
  );
}

interface ContractorCircleEmailFooterProps {
  children?: ReactNode;
}

export function ContractorCircleEmailFooter({ children }: ContractorCircleEmailFooterProps) {
  return (
    <Section style={styles.footer}>
      <Row>
        <Column style={styles.markColumn}>
          <Img src={MARK_LOGO_URL} width="38" height="38" alt="" style={styles.mark} />
        </Column>
        <Column>
          <Text style={styles.footerBrand}>Contractor Circle</Text>
          <Text style={styles.footerLine}>
            {children ?? "Build the company behind the projects."}
          </Text>
        </Column>
        <Column align="right" style={styles.alpColumn}>
          <Text style={styles.alp}>AN ALP COMMUNITY</Text>
        </Column>
      </Row>
    </Section>
  );
}

const styles = {
  header: {
    backgroundColor: "#EDE7DC",
    borderBottom: `1px solid ${emailBrand.paperEdge}`,
    padding: "12px 24px",
  },
  wordmark: {
    display: "block",
    height: "80px",
    objectFit: "contain" as const,
    width: "224px",
  },
  labelColumn: {
    paddingLeft: "12px",
    width: "170px",
  },
  label: {
    color: emailBrand.muted,
    fontFamily: emailBrand.mono,
    fontSize: "8px",
    fontWeight: 700,
    letterSpacing: "0.16em",
    lineHeight: 1.4,
    margin: 0,
    textTransform: "uppercase" as const,
  },
  footer: {
    backgroundColor: "#171310",
    borderTop: `3px solid ${emailBrand.signal}`,
    padding: "20px 24px",
  },
  markColumn: {
    width: "50px",
  },
  mark: {
    display: "block",
  },
  footerBrand: {
    color: "#FAF7F0",
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: "15px",
    fontWeight: 600,
    lineHeight: 1.2,
    margin: "0 0 3px",
  },
  footerLine: {
    color: "#B7AFA3",
    fontSize: "10px",
    lineHeight: 1.4,
    margin: 0,
  },
  alpColumn: {
    paddingLeft: "12px",
    width: "150px",
  },
  alp: {
    color: "#B7AFA3",
    fontFamily: emailBrand.mono,
    fontSize: "7.5px",
    fontWeight: 700,
    letterSpacing: "0.14em",
    lineHeight: 1.4,
    margin: 0,
  },
} as const;
