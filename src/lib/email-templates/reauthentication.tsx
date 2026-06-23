import * as React from 'react'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { emailStyles } from './_brand'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your verification code</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <Section style={emailStyles.card}>
          <Section style={emailStyles.headerBar}>
            <Text style={emailStyles.brandText}>ALP Contractor Circle</Text>
          </Section>
          <Section style={emailStyles.body}>
            <Text style={emailStyles.eyebrow}>Identity check</Text>
            <Heading style={emailStyles.h1}>Confirm reauthentication</Heading>
            <Text style={emailStyles.text}>Use the code below to confirm your identity:</Text>
            <Text style={emailStyles.codeBlock}>{token}</Text>
            <Text style={emailStyles.footer}>
              This code will expire shortly. If you didn't request this, you can
              safely ignore this email.
            </Text>
          </Section>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail
