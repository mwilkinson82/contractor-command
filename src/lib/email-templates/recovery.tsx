import * as React from 'react'

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
} from '@react-email/components'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your password for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={card}>
          <Text style={eyebrow}>ALP CONTRACTOR CIRCLE</Text>
          <Heading style={h1}>Reset your password</Heading>
          <Text style={text}>
            We received a request to reset the password on your Command Center
            account. Click below to choose a new one.
          </Text>
          <Button style={button} href={confirmationUrl}>
            Reset password
          </Button>
          <Text style={footer}>
            If you didn't request this, you can ignore this email — your password
            won't change.
          </Text>
        </Section>
        <Text style={signoff}>— The ALP Contractor Circle team</Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif',
  padding: '40px 0',
}
const container = { maxWidth: '520px', margin: '0 auto', padding: '0 24px' }
const card = {
  backgroundColor: '#FCFBF9',
  border: '1px solid #E2DED6',
  borderRadius: '20px',
  padding: '36px 32px',
}
const eyebrow = {
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  fontSize: '11px',
  letterSpacing: '0.18em',
  color: '#8E8B82',
  margin: '0 0 18px',
}
const h1 = {
  fontFamily: '"Instrument Serif", Georgia, serif',
  fontSize: '32px',
  fontWeight: 400 as const,
  color: '#1A1918',
  letterSpacing: '-0.01em',
  margin: '0 0 18px',
  lineHeight: '1.15',
}
const text = {
  fontSize: '15px',
  color: '#3a3936',
  lineHeight: '1.55',
  margin: '0 0 24px',
}
const button = {
  backgroundColor: '#1A1918',
  color: '#F4F3EF',
  fontSize: '14px',
  fontWeight: 500 as const,
  borderRadius: '12px',
  padding: '13px 22px',
  textDecoration: 'none',
  display: 'inline-block',
}
const footer = {
  fontSize: '12px',
  color: '#8E8B82',
  margin: '28px 0 0',
  lineHeight: '1.5',
}
const signoff = {
  fontSize: '12px',
  color: '#8E8B82',
  margin: '20px 0 0',
  textAlign: 'center' as const,
}
