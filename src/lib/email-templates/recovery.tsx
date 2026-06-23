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
import { emailStyles } from './_brand'

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
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <Section style={emailStyles.card}>
          <Section style={emailStyles.headerBar}>
            <Text style={emailStyles.brandText}>{siteName}</Text>
          </Section>
          <Section style={emailStyles.body}>
            <Text style={emailStyles.eyebrow}>Password reset</Text>
            <Heading style={emailStyles.h1}>Reset your password</Heading>
            <Text style={emailStyles.text}>
              We received a request to reset your password for {siteName}. Click
              the button below to choose a new password.
            </Text>
            <Button style={emailStyles.button} href={confirmationUrl}>
              Reset password
            </Button>
            <Text style={{ ...emailStyles.footer, marginTop: "28px" }}>
              If you didn't request a password reset, you can safely ignore this
              email. Your password will not be changed.
            </Text>
          </Section>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail
