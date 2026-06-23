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

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your login link for {siteName}</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <Section style={emailStyles.card}>
          <Section style={emailStyles.headerBar}>
            <Text style={emailStyles.brandText}>{siteName}</Text>
          </Section>
          <Section style={emailStyles.body}>
            <Text style={emailStyles.eyebrow}>Secure access</Text>
            <Heading style={emailStyles.h1}>Your login link</Heading>
            <Text style={emailStyles.text}>
              Click the button below to log in to {siteName}. This link will expire
              shortly.
            </Text>
            <Button style={emailStyles.button} href={confirmationUrl}>
              Log in
            </Button>
            <Text style={{ ...emailStyles.footer, marginTop: "28px" }}>
              If you didn't request this link, you can safely ignore this email.
            </Text>
          </Section>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail
