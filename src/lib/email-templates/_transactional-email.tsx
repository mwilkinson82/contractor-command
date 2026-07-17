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
  footer,
}: TransactionalEmailProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Section style={emailStyles.card}>
            <ContractorCircleEmailHeader label={label} />
            <Section style={emailStyles.body}>
              <Text style={emailStyles.eyebrow}>Contractor Circle / Secure access</Text>
              <Heading style={emailStyles.h1}>{title}</Heading>
              <Text style={emailStyles.text}>{children}</Text>
              {code && <Text style={emailStyles.codeBlock}>{code}</Text>}
              {actionLabel && actionUrl && (
                <Button style={emailStyles.button} href={actionUrl}>
                  {actionLabel}
                </Button>
              )}
              <Text style={transactionalStyles.footer}>{footer}</Text>
            </Section>
            <ContractorCircleEmailFooter />
          </Section>
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
