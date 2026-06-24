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
import type { TemplateEntry } from './registry'

interface MagicLinkEmailProps {
  siteName?: string
  firstName?: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName = 'Contractor Circle',
  firstName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your sign-in link for {siteName} (expires in 1 hour)</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <Section style={emailStyles.card}>
          <Section style={emailStyles.headerBar}>
            <Text style={emailStyles.brandText}>{siteName}</Text>
          </Section>
          <Section style={emailStyles.body}>
            <Text style={emailStyles.eyebrow}>Secure sign-in</Text>
            <Heading style={emailStyles.h1}>
              {firstName ? `${firstName}, here's your sign-in link` : "Here's your sign-in link"}
            </Heading>
            <Text style={emailStyles.text}>
              You (or someone using your email) asked to sign in to {siteName}.
              Click the button below to open your portal. This link expires in
              about 1 hour and can only be used once.
            </Text>
            <Button style={emailStyles.button} href={confirmationUrl}>
              Sign in to {siteName}
            </Button>
            <Text style={{ ...emailStyles.footer, marginTop: '28px' }}>
              Open this email on the same device and browser you want to sign in
              with. If you requested more than one link, use the newest email —
              older links may already be expired. If you didn't request this
              link, you can safely ignore this email.
            </Text>
          </Section>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: MagicLinkEmail,
  subject: 'Your Contractor Circle sign-in link',
  displayName: 'Magic link sign-in',
  previewData: {
    siteName: 'Contractor Circle',
    firstName: 'Caleb',
    confirmationUrl: 'https://app.alpcontractorcircle.com/',
  },
} satisfies TemplateEntry

export default MagicLinkEmail
