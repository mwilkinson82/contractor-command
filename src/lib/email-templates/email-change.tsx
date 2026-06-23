import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { emailStyles } from './_brand'

interface EmailChangeEmailProps {
  siteName: string
  // oldEmail is the user's current address (HookData.OldEmail). For the
  // NEW-recipient half of a secure email_change fanout, `email` equals the
  // recipient (NEW), so the "from" line must render oldEmail to read
  // "from OLD to NEW" instead of "from NEW to NEW".
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email change for {siteName}</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <Section style={emailStyles.card}>
          <Section style={emailStyles.headerBar}>
            <Text style={emailStyles.brandText}>{siteName}</Text>
          </Section>
          <Section style={emailStyles.body}>
            <Text style={emailStyles.eyebrow}>Account security</Text>
            <Heading style={emailStyles.h1}>Confirm your email change</Heading>
            <Text style={emailStyles.text}>
              You requested to change your email address for {siteName} from{' '}
              <Link href={`mailto:${oldEmail}`} style={emailStyles.link}>
                {oldEmail}
              </Link>{' '}
              to{' '}
              <Link href={`mailto:${newEmail}`} style={emailStyles.link}>
                {newEmail}
              </Link>
              .
            </Text>
            <Text style={emailStyles.text}>
              Click the button below to confirm this change:
            </Text>
            <Button style={emailStyles.button} href={confirmationUrl}>
              Confirm email change
            </Button>
            <Text style={{ ...emailStyles.footer, marginTop: "28px" }}>
              If you didn't request this change, please secure your account
              immediately.
            </Text>
          </Section>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail
