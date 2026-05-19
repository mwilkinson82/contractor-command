import * as React from 'react'
import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface LoginNudgeProps {
  siteName?: string
  siteUrl?: string
  confirmationUrl?: string
  firstName?: string
}

const LoginNudgeEmail = ({
  siteName = 'Contractor Circle',
  siteUrl = 'https://app.alpcontractorcircle.com',
  confirmationUrl = 'https://app.alpcontractorcircle.com/welcome',
  firstName,
}: LoginNudgeProps) => {
  const name = firstName?.trim()
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <style>{`
          @font-face { font-family:'Instrument Serif'; font-style:normal; font-weight:400; font-display:swap; src:url(https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-2zI.ttf) format('truetype'); }
          @font-face { font-family:'JetBrains Mono'; font-style:normal; font-weight:500; font-display:swap; src:url(https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8-qxjPQ.ttf) format('truetype'); }
        `}</style>
      </Head>
      <Preview>Your seat at {siteName} is waiting — one click to step inside.</Preview>
      <Body style={main}>
        <Container style={container}>
          <div style={topRule} />
          <Section style={card}>
            <Text style={eyebrow}>ALP CONTRACTOR CIRCLE · QUICK NUDGE</Text>
            <Heading style={h1}>{name ? `${name}, your seat is waiting.` : 'Your seat is waiting.'}</Heading>
            <Text style={lede}>
              You're paid up, you're in the room — but you haven't set your password yet.
              One click and you're inside the portal: Vault, replays, AOS Engine, the
              whole thing.
            </Text>
            <Section style={ctaWrap}>
              <Button style={button} href={confirmationUrl}>Set your password</Button>
              <Text style={ctaNote}>
                Fresh link. Opens at{' '}
                <Link href={siteUrl} style={inlineLink}>app.alpcontractorcircle.com</Link>.
              </Text>
            </Section>
            <Text style={footer}>
              Already in? Ignore this — we won't nudge again. Stuck on the link? Reply and
              we'll send a fresh one.
            </Text>
          </Section>
          <Text style={signoff}>— Marshall &amp; the ALP team</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: LoginNudgeEmail,
  subject: (d: Record<string, any>) =>
    d?.firstName ? `${d.firstName}, your seat is waiting` : 'Your seat at the Circle is waiting',
  displayName: 'Login nudge (no password set)',
  previewData: {
    firstName: 'Cesar',
    siteName: 'Contractor Circle',
    siteUrl: 'https://app.alpcontractorcircle.com',
    confirmationUrl: 'https://app.alpcontractorcircle.com/welcome?token=preview',
  },
} satisfies TemplateEntry

const sansFamily = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const serifFamily = '"Instrument Serif", Georgia, serif'
const monoFamily = '"JetBrains Mono", "SFMono-Regular", Menlo, monospace'
const INK = '#1A1918', INK_SOFT = '#3a3937', MUTED = '#8E8B82'
const PAPER = '#F4F3EF', HAIRLINE = '#E2DED6', SIGNAL = '#E4573D'

const main = { backgroundColor: '#ffffff', fontFamily: sansFamily, margin: 0, padding: '32px 0' }
const container = { maxWidth: '560px', margin: '0 auto', padding: '0 16px' }
const topRule = { height: '2px', background: SIGNAL, width: '100%', marginBottom: '24px' }
const card = { backgroundColor: PAPER, border: `1px solid ${HAIRLINE}`, borderRadius: '20px', padding: '40px 36px' }
const eyebrow = { fontSize: '11px', letterSpacing: '0.22em', color: MUTED, margin: '0 0 18px', fontFamily: monoFamily }
const h1 = { fontSize: '34px', fontWeight: 400, color: INK, lineHeight: 1.1, margin: '0 0 16px', fontFamily: serifFamily, letterSpacing: '-0.01em' }
const lede = { fontSize: '16px', color: INK_SOFT, lineHeight: 1.55, margin: '0 0 28px', fontFamily: sansFamily }
const ctaWrap = { margin: '4px 0 8px' }
const button = { backgroundColor: INK, color: PAPER, fontSize: '13px', letterSpacing: '0.22em', textTransform: 'uppercase' as const, borderRadius: '999px', padding: '16px 28px', textDecoration: 'none', display: 'inline-block', fontWeight: 500, fontFamily: monoFamily }
const ctaNote = { fontSize: '12px', color: MUTED, margin: '14px 0 0', lineHeight: 1.5, fontFamily: sansFamily }
const inlineLink = { color: SIGNAL, textDecoration: 'underline' }
const footer = { fontSize: '12px', color: MUTED, margin: '24px 0 0', lineHeight: 1.55, fontFamily: sansFamily }
const signoff = { fontSize: '13px', color: INK, margin: '20px 4px 0', textAlign: 'center' as const, fontFamily: sansFamily }
