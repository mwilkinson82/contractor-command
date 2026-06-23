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
    <Preview>You've been invited to join {siteName}</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <Section style={emailStyles.card}>
          <Section style={emailStyles.headerBar}>
            <Text style={emailStyles.brandText}>{siteName}</Text>
          </Section>
          <Section style={emailStyles.body}>
            <Text style={emailStyles.eyebrow}>Portal invitation</Text>
            <Heading style={emailStyles.h1}>You've been invited</Heading>
            <Text style={emailStyles.text}>
              You've been invited to join{' '}
              <Link href={siteUrl} style={emailStyles.link}>
                <strong>{siteName}</strong>
              </Link>
              . Click the button below to accept the invitation and create your
              account.
            </Text>
            <Button style={emailStyles.button} href={confirmationUrl}>
              Accept invitation
            </Button>
            <Text style={{ ...emailStyles.footer, marginTop: "28px" }}>
              If you weren't expecting this invitation, you can safely ignore this
              email.
            </Text>
          </Section>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail
