import React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { emailBrand, emailStyles } from "./_brand";
import type { TemplateEntry } from "./registry";
import { ContractorCircleEmailFooter, ContractorCircleEmailHeader } from "./_brand-components";

type DomainResult = { title: string; score: number; impact: string };
type RoadmapResult = { period: string; title: string; impact: string; route: string };

interface StateOfControlReportProps {
  senderName?: string;
  senderEmail?: string;
  note?: string;
  total?: number;
  maturityTitle?: string;
  maturityCopy?: string;
  primaryConstraint?: string;
  primaryImpact?: string;
  capacityGap?: string;
  annualCapacity?: string;
  revenueGoal?: string;
  limitingCapacity?: string;
  categories?: DomainResult[];
  roadmap?: RoadmapResult[];
  actions?: string[];
  generatedAt?: string;
}

const StateOfControlReportEmail = ({
  senderName,
  senderEmail,
  note,
  total = 0,
  maturityTitle = "State of Control",
  maturityCopy = "A current operating baseline.",
  primaryConstraint = "Primary constraint",
  primaryImpact = "Complete the assessment to identify the active constraint.",
  capacityGap = "$0",
  annualCapacity = "$0",
  revenueGoal = "$0",
  limitingCapacity = "Not identified",
  categories = [],
  roadmap = [],
  actions = [],
  generatedAt = "",
}: StateOfControlReportProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${total}/100 State of Control - ${primaryConstraint}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <ContractorCircleEmailHeader label="Operating report" />
        <Text style={eyebrow}>Professional contractor control</Text>
        <Heading style={h1}>State of Control</Heading>
        <Text style={intro}>
          A current operating diagnosis across company, project, and field control.
        </Text>
        <Text style={meta}>
          Shared by {senderName || senderEmail || "an ALP Contractor Circle member"}
          {generatedAt ? ` · ${generatedAt}` : ""}
        </Text>

        {note ? (
          <Section style={noteBox}>
            <Text style={noteText}>{note}</Text>
          </Section>
        ) : null}

        <Section style={scoreBox}>
          <Text style={darkLabel}>Control score</Text>
          <Text style={score}>
            {total}
            <span style={scoreOutOf}>/100</span>
          </Text>
          <Heading as="h2" style={scoreTitle}>
            {maturityTitle}
          </Heading>
          <Text style={scoreCopy}>{maturityCopy}</Text>
        </Section>

        <Section style={constraintBox}>
          <Text style={label}>Primary constraint</Text>
          <Heading as="h2" style={h2}>
            {primaryConstraint}
          </Heading>
          <Text style={bodyText}>{primaryImpact}</Text>
        </Section>

        <Section style={metricRow}>
          <Text style={metric}>
            <span style={metricLabel}>Revenue goal</span>
            <br />
            <strong>{revenueGoal}</strong>
          </Text>
          <Text style={metric}>
            <span style={metricLabel}>Annual capacity</span>
            <br />
            <strong>{annualCapacity}</strong>
          </Text>
          <Text style={metric}>
            <span style={metricLabel}>Capacity gap</span>
            <br />
            <strong style={{ color: emailBrand.signal }}>{capacityGap}</strong>
          </Text>
        </Section>
        <Text style={capacityNote}>
          Limiting capacity: <strong>{limitingCapacity}</strong>
        </Text>

        <Hr style={hr} />
        <Text style={label}>Control domains</Text>
        {categories.map((category) => (
          <Section key={category.title} style={domainRow}>
            <Text style={domainTitle}>
              {category.title}
              <span style={domainScore}>{category.score}/20</span>
            </Text>
            <Text style={domainImpact}>{category.impact}</Text>
          </Section>
        ))}

        <Hr style={hr} />
        <Text style={label}>Your 90-day roadmap</Text>
        {roadmap.map((item, index) => (
          <Section key={item.period} style={roadmapRow}>
            <Text style={roadmapPeriod}>
              {item.period} · {String(index + 1).padStart(2, "0")}
            </Text>
            <Heading as="h3" style={roadmapTitle}>
              {item.title}
            </Heading>
            <Text style={domainImpact}>{item.impact}</Text>
            <Text style={route}>{item.route}</Text>
          </Section>
        ))}

        <Hr style={hr} />
        <Text style={label}>Next 30 days</Text>
        {actions.map((action, index) => (
          <Text key={action} style={actionText}>
            <span style={actionNumber}>{String(index + 1).padStart(2, "0")}</span> {action}
          </Text>
        ))}

        <Section style={useBox}>
          <Heading as="h2" style={useTitle}>
            Use this as a management baseline.
          </Heading>
          <Text style={useCopy}>
            Save the diagnosis, assign an owner to the first action, review the active constraint
            weekly, and rerun the assessment in 90 days.
          </Text>
        </Section>

        <Hr style={hr} />
        <Text style={footer}>
          Generated in the ALP Contractor Circle Operator&apos;s Workbench. The State of Control is
          a management diagnosis, not an accounting statement.
        </Text>
        <ContractorCircleEmailFooter />
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: StateOfControlReportEmail,
  subject: (data: Record<string, unknown>) =>
    `State of Control - ${data?.total ?? 0}/100 - ${data?.primaryConstraint || "Operating report"}`,
  displayName: "State of Control report",
  previewData: {
    senderName: "Marshall Wilkinson",
    total: 45,
    maturityTitle: "Reactive Operator",
    maturityCopy: "Pieces exist, but the system is inconsistent.",
    primaryConstraint: "Cash Capacity Constraint",
    primaryImpact:
      "The company is limited by how much work it can carry before billing and collections return cash.",
    capacityGap: "$16,300,000",
    annualCapacity: "$8,700,000",
    revenueGoal: "$25,000,000",
    limitingCapacity: "Cash capacity",
    generatedAt: "July 14, 2026",
    categories: [
      {
        title: "AOS",
        score: 13,
        impact: "7/20 ownership gap. Accountability may still flow back to the owner.",
      },
      {
        title: "IOR",
        score: 0,
        impact: "20/20 visibility gap. Project margin exposure may not be visible soon enough.",
      },
    ],
    roadmap: [
      {
        period: "Month 1",
        title: "Economics",
        impact: "$16,300,000 annual capacity gap.",
        route: "Economics Engine -> Cash Conversion Snapshot",
      },
    ],
    actions: ["Complete the Cash Conversion Snapshot.", "Reduce AR over 60 before adding backlog."],
  },
} satisfies TemplateEntry;

const main = { backgroundColor: emailBrand.cream, fontFamily: emailBrand.sans, padding: "32px 0" };
const container = {
  backgroundColor: emailBrand.workSurface,
  border: `1px solid ${emailBrand.paperEdge}`,
  borderRadius: "12px",
  padding: "30px",
  maxWidth: "660px",
};
const eyebrow = {
  fontSize: "10px",
  letterSpacing: "0.2em",
  color: emailBrand.signal,
  margin: "0 0 8px",
  fontWeight: 700 as const,
  textTransform: "uppercase" as const,
};
const h1 = {
  fontSize: "32px",
  fontWeight: 600 as const,
  color: emailBrand.ink,
  margin: "0 0 8px",
  lineHeight: 1.1,
};
const intro = { fontSize: "14px", color: emailBrand.ink, margin: "0 0 5px", lineHeight: 1.5 };
const meta = { fontSize: "11px", color: emailBrand.muted, margin: "0 0 22px" };
const noteBox = emailStyles.inset;
const noteText = { fontSize: "13px", color: emailBrand.ink, margin: 0, lineHeight: 1.5 };
const scoreBox = {
  backgroundColor: emailBrand.ink,
  borderRadius: "12px",
  padding: "22px",
  marginTop: "18px",
};
const darkLabel = {
  fontSize: "9px",
  letterSpacing: "0.18em",
  color: emailBrand.signal,
  margin: 0,
  textTransform: "uppercase" as const,
};
const score = {
  fontSize: "52px",
  lineHeight: 1,
  color: emailBrand.cream,
  margin: "14px 0 8px",
  fontWeight: 500 as const,
};
const scoreOutOf = { fontSize: "12px", color: "#aaa49a" };
const scoreTitle = {
  fontSize: "22px",
  color: emailBrand.cream,
  margin: "0 0 5px",
  lineHeight: 1.2,
};
const scoreCopy = { fontSize: "12px", color: "#c8c1b7", margin: 0, lineHeight: 1.5 };
const constraintBox = {
  border: `1px solid ${emailBrand.paperEdge}`,
  borderRadius: "12px",
  padding: "20px",
  marginTop: "14px",
};
const label = {
  fontSize: "9px",
  letterSpacing: "0.18em",
  color: emailBrand.muted,
  margin: "0 0 8px",
  fontWeight: 700 as const,
  textTransform: "uppercase" as const,
};
const h2 = { fontSize: "22px", color: emailBrand.ink, margin: "0 0 8px", lineHeight: 1.2 };
const bodyText = { fontSize: "12.5px", color: emailBrand.muted, margin: 0, lineHeight: 1.55 };
const metricRow = { display: "flex", gap: "8px", marginTop: "14px" };
const metric = {
  flex: 1,
  border: `1px solid ${emailBrand.paperEdge}`,
  borderRadius: "9px",
  padding: "12px",
  fontSize: "14px",
  color: emailBrand.ink,
  margin: 0,
  lineHeight: 1.5,
};
const metricLabel = {
  fontSize: "8px",
  letterSpacing: "0.13em",
  color: emailBrand.muted,
  textTransform: "uppercase" as const,
};
const capacityNote = { fontSize: "11px", color: emailBrand.muted, margin: "9px 0 0" };
const hr = { borderColor: emailBrand.paperEdge, margin: "24px 0" };
const domainRow = {
  border: `1px solid ${emailBrand.paperEdge}`,
  borderRadius: "9px",
  padding: "13px",
  marginBottom: "8px",
};
const domainTitle = {
  fontSize: "15px",
  color: emailBrand.ink,
  margin: "0 0 5px",
  fontWeight: 650 as const,
};
const domainScore = { float: "right" as const, fontSize: "11px", color: emailBrand.signal };
const domainImpact = { fontSize: "11px", color: emailBrand.muted, margin: 0, lineHeight: 1.5 };
const roadmapRow = {
  borderLeft: `3px solid ${emailBrand.signal}`,
  backgroundColor: "#f4efe7",
  padding: "14px 16px",
  marginBottom: "10px",
};
const roadmapPeriod = {
  fontSize: "8px",
  letterSpacing: "0.16em",
  color: emailBrand.muted,
  margin: "0 0 6px",
  textTransform: "uppercase" as const,
};
const roadmapTitle = { fontSize: "18px", color: emailBrand.ink, margin: "0 0 6px" };
const route = {
  fontSize: "10px",
  color: emailBrand.ink,
  margin: "8px 0 0",
  fontWeight: 600 as const,
};
const actionText = { fontSize: "12px", color: emailBrand.ink, margin: "0 0 10px", lineHeight: 1.5 };
const actionNumber = { color: emailBrand.signal, fontSize: "10px", fontWeight: 700 as const };
const useBox = {
  backgroundColor: emailBrand.ink,
  borderRadius: "12px",
  padding: "20px",
  marginTop: "22px",
};
const useTitle = { fontSize: "19px", color: emailBrand.cream, margin: "0 0 8px" };
const useCopy = { fontSize: "12px", color: "#c8c1b7", margin: 0, lineHeight: 1.55 };
const footer = { fontSize: "10px", color: emailBrand.muted, margin: 0, lineHeight: 1.5 };
