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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email for {siteName}</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <Section style={emailStyles.card}>
          <Section style={emailStyles.headerBar}>
            <Text style={emailStyles.brandText}>{siteName}</Text>
          </Section>
          <Section style={emailStyles.body}>
            <Text style={emailStyles.eyebrow}>Confirm access</Text>
            <Heading style={emailStyles.h1}>Confirm your email</Heading>
            <Text style={emailStyles.text}>
              Thanks for signing up for{' '}
              <Link href={siteUrl} style={emailStyles.link}>
                <strong>{siteName}</strong>
              </Link>
              .
            </Text>
            <Text style={emailStyles.text}>
              Please confirm your email address (
              <Link href={`mailto:${recipient}`} style={emailStyles.link}>
                {recipient}
              </Link>
              ) by clicking the button below:
            </Text>
            <Button style={emailStyles.button} href={confirmationUrl}>
              Verify email
            </Button>
            <Text style={{ ...emailStyles.footer, marginTop: "28px" }}>
              If you didn't create an account, you can safely ignore this email.
            </Text>
          </Section>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail
