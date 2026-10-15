import { EmailSection } from "./_responsive";
import { responsiveEmail, ResponsiveEmailHead } from "./_responsive";
import type { ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { emailBrand, emailStyles } from "./_brand";
import { ContractorCircleEmailFooter, ContractorCircleEmailHeader } from "./_brand-components";

interface TransactionalEmailProps {
  preview: string;
  label: string;
  title: string;
  children: ReactNode;
  actionLabel?: string;
  actionUrl?: string;
  code?: string;
  verificationEmail?: string;
  footer: ReactNode;
}

export function TransactionalEmail({
  preview,
  label,
  title,
  children,
  actionLabel,
  actionUrl,
  code,
  verificationEmail,
  footer,
}: TransactionalEmailProps) {
  return (
    <Html lang="en" dir="ltr">
      <ResponsiveEmailHead />
      <Preview>{preview}</Preview>
      <Body style={responsiveEmail.main}>
        <Container style={responsiveEmail.container}>
          <EmailSection style={responsiveEmail.card}>
            <ContractorCircleEmailHeader label={label} />
            <EmailSection style={responsiveEmail.body}>
              <Text style={emailStyles.eyebrow}>Contractor Circle / Secure access</Text>
              <Heading style={emailStyles.h1}>{title}</Heading>
              <Text style={emailStyles.text}>{children}</Text>
              {verificationEmail && (
                <EmailSection style={{ backgroundColor: "#F7F2EA", padding: 16, marginBottom: 24 }}>
                  <Text
                    style={{ fontSize: 10, letterSpacing: "1.5px", color: "#6B6259", margin: 0 }}
                  >
                    EMAIL TO CONFIRM
                  </Text>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      lineHeight: "25px",
                      margin: "14px 0 0",
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                    }}
                  >
                    {verificationEmail}
                  </Text>
                </EmailSection>
              )}
              {code && <Text style={emailStyles.codeBlock}>{code}</Text>}
              {actionLabel && actionUrl && (
                <Button style={responsiveEmail.button} href={actionUrl}>
                  {actionLabel}
                </Button>
              )}
              <Text style={transactionalStyles.footer}>{footer}</Text>
            </EmailSection>
            <ContractorCircleEmailFooter />
          </EmailSection>
        </Container>
      </Body>
    </Html>
  );
}

export const transactionalLinkStyle = {
  color: emailBrand.signal,
  fontWeight: 600,
  textDecoration: "underline",
} as const;

const transactionalStyles = {
  footer: {
    ...emailStyles.footer,
    borderTop: `1px solid ${emailBrand.paperEdge}`,
    margin: "28px 0 0",
    paddingTop: "18px",
  },
} as const;
