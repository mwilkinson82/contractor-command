import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Contractor Circle portal is ready — set your password to step inside.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={card}>
          <Text style={eyebrow}>ALP CONTRACTOR CIRCLE / MEMBER ACCESS</Text>
          <Heading style={h1}>Welcome to the Circle.</Heading>
          <Text style={lede}>
            You're in. Your seat at <strong>{siteName}</strong> is live and your portal
            account is waiting on one final step — set your password.
          </Text>

          <Section style={ctaWrap}>
            <Button style={button} href={confirmationUrl}>
              Set your password
            </Button>
            <Text style={ctaNote}>
              One-time link. Opens your portal at{' '}
              <Link href={siteUrl} style={inlineLink}>
                app.alpcontractorcircle.com
              </Link>
              .
            </Text>
          </Section>

          <Hr style={rule} />

          <Text style={sectionLabel}>WHAT'S INSIDE</Text>
          <Text style={bullet}>
            <strong>The Vault</strong> — contracts, SOPs, scorecards, and the live tool
            library built for owner-operators.
          </Text>
          <Text style={bullet}>
            <strong>Weekly Calls</strong> — submit topics, get on the docket, watch the
            replays.
          </Text>
          <Text style={bullet}>
            <strong>The Engine</strong> — AI tools trained on the operating system —
            contract scans, SOP drafts, hiring scorecards, and more.
          </Text>

          <Hr style={rule} />

          <Text style={smallHeading}>A few notes before you click</Text>
          <Text style={text}>
            • Use this exact email address to log in — that's how your membership is
            tied to your account.
            <br />
            • Bookmark{' '}
            <Link href={siteUrl} style={inlineLink}>
              app.alpcontractorcircle.com
            </Link>
            . That's home from now on.
            <br />
            • If this link expires, just hit <em>Forgot password</em> on the login page
            and we'll send a fresh one.
          </Text>

          <Text style={signoff}>
            See you inside,
            <br />
            <strong>Marshall &amp; the ALP team</strong>
          </Text>
        </Section>

        <Text style={footer}>
          You're getting this because your membership at {siteName} is active. If you
          weren't expecting it, reply to this email and we'll sort it out.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif',
  margin: 0,
  padding: '32px 0',
}
const container = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '0 16px',
}
const card = {
  backgroundColor: '#F4F3EF',
  border: '1px solid #E2DED6',
  borderRadius: '20px',
  padding: '40px 36px',
}
const eyebrow = {
  fontSize: '11px',
  letterSpacing: '0.22em',
  color: '#8E8B82',
  margin: '0 0 18px',
  fontFamily:
    '"JetBrains Mono", "SFMono-Regular", Menlo, monospace',
}
const h1 = {
  fontSize: '36px',
  fontWeight: 400,
  color: '#1A1918',
  lineHeight: 1.1,
  margin: '0 0 16px',
  fontFamily: '"Instrument Serif", Georgia, "Times New Roman", serif',
  letterSpacing: '-0.01em',
}
const lede = {
  fontSize: '16px',
  color: '#3a3937',
  lineHeight: 1.55,
  margin: '0 0 28px',
}
const ctaWrap = { margin: '4px 0 8px' }
const button = {
  backgroundColor: '#1A1918',
  color: '#F4F3EF',
  fontSize: '13px',
  letterSpacing: '0.22em',
  textTransform: 'uppercase' as const,
  borderRadius: '999px',
  padding: '16px 28px',
  textDecoration: 'none',
  display: 'inline-block',
  fontWeight: 500,
}
const ctaNote = {
  fontSize: '12px',
  color: '#8E8B82',
  margin: '14px 0 0',
  lineHeight: 1.5,
}
const inlineLink = { color: '#E4573D', textDecoration: 'underline' }
const rule = {
  borderColor: '#E2DED6',
  borderTop: '1px solid #E2DED6',
  margin: '32px 0 24px',
}
const sectionLabel = {
  fontSize: '11px',
  letterSpacing: '0.22em',
  color: '#8E8B82',
  margin: '0 0 14px',
  fontFamily:
    '"JetBrains Mono", "SFMono-Regular", Menlo, monospace',
}
const bullet = {
  fontSize: '14px',
  color: '#1A1918',
  lineHeight: 1.6,
  margin: '0 0 12px',
}
const smallHeading = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#1A1918',
  margin: '0 0 10px',
}
const text = {
  fontSize: '14px',
  color: '#3a3937',
  lineHeight: 1.6,
  margin: '0 0 24px',
}
const signoff = {
  fontSize: '14px',
  color: '#1A1918',
  lineHeight: 1.6,
  margin: '24px 0 0',
}
const footer = {
  fontSize: '11px',
  color: '#8E8B82',
  lineHeight: 1.55,
  margin: '20px 4px 0',
  textAlign: 'center' as const,
}
