import * as React from 'react'
import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'
import { DISCORD_URL } from '../program'


interface CircleWelcomeProps {
  siteName?: string
  siteUrl?: string
  firstName?: string
  loginUrl?: string
  vaultUrl?: string
  callsUrl?: string
  replaysUrl?: string
  discordUrl?: string
}

const CircleWelcomeEmail = ({
  siteName = 'Contractor Circle',
  siteUrl = 'https://app.alpcontractorcircle.com',
  firstName,
  loginUrl,
  vaultUrl = 'https://app.alpcontractorcircle.com/vault',
  callsUrl = 'https://app.alpcontractorcircle.com/calls',
  replaysUrl = 'https://app.alpcontractorcircle.com/replays',
  discordUrl = DISCORD_URL,
}: CircleWelcomeProps) => {
  const name = firstName?.trim()
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <style>{`
          @font-face { font-family:'Instrument Serif'; font-style:normal; font-weight:400; font-display:swap; src:url(https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-2zI.ttf) format('truetype'); }
          @font-face { font-family:'JetBrains Mono'; font-style:normal; font-weight:500; font-display:swap; src:url(https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8-qxjPQ.ttf) format('truetype'); }
        `}</style>
      </Head>
      <Preview>Welcome to {siteName}. Here's how to step in.</Preview>
      <Body style={main}>
        <Container style={container}>
          <div style={topRule} />
          <Section style={card}>
            <Text style={eyebrow}>ALP CONTRACTOR CIRCLE · WELCOME</Text>
            <Heading style={h1}>
              {name ? `${name}, you're in.` : `You're in.`}
            </Heading>
            <Text style={lede}>
              Welcome to the Circle. Your seat is live, your access is on, and the
              room is open. Here's how to use the first 30 minutes well — then come
              back the rest of the week as you need it.
            </Text>

            <Section style={ctaWrap}>
              <Button style={button} href={loginUrl ?? siteUrl}>Enter the portal</Button>
              <Text style={ctaNote}>
                One click — no password to remember. The link signs you in and
                keeps you signed in on this device. If it ever expires, just
                request a new one from the login page.
              </Text>
            </Section>

            <Text style={sectionLabel}>START HERE</Text>
            <Text style={item}>
              <strong style={itemTitle}>1. The Vault</strong><br />
              SOPs, scripts, templates, contracts — the stuff that took ten years
              to build. <Link style={inlineLink} href={vaultUrl}>Open the Vault →</Link>
            </Text>
            <Text style={item}>
              <strong style={itemTitle}>2. Biweekly Calls</strong><br />
              Submit a topic if you've got pressure on something this week. We
              pick from real submissions, not a fixed agenda.{' '}
              <Link style={inlineLink} href={callsUrl}>Submit a topic →</Link>
            </Text>
            <Text style={item}>
              <strong style={itemTitle}>3. Replays</strong><br />
              Every past call, indexed. If something is bleeding right now,
              search there first.{' '}
              <Link style={inlineLink} href={replaysUrl}>Browse replays →</Link>
            </Text>
            <Text style={item}>
              <strong style={itemTitle}>4. Discord</strong><br />
              The day-to-day room. Wins, asks, fast feedback between calls.{' '}
              <Link style={inlineLink} href={discordUrl}>Join Discord →</Link>
            </Text>

            <Text style={footer}>
              <strong style={itemTitle}>Having trouble logging in?</strong> Send
              yourself a fresh magic link any time at{' '}
              <Link style={inlineLink} href="https://app.alpcontractorcircle.com/magic-link">
                app.alpcontractorcircle.com/magic-link
              </Link>
              . Type your email, click the link in your inbox, you're in.
              <br /><br />
              Anything else — hit reply. Goes straight to me.
            </Text>
          </Section>
          <Text style={signoff}>— Marshall &amp; the ALP team</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: CircleWelcomeEmail,
  subject: (d: Record<string, any>) =>
    d?.firstName ? `${d.firstName}, welcome to the Circle` : 'Welcome to the Contractor Circle',
  displayName: 'Circle welcome (new member)',
  previewData: {
    firstName: 'Justin',
    siteName: 'Contractor Circle',
    siteUrl: 'https://app.alpcontractorcircle.com',
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
const ctaWrap = { margin: '4px 0 24px' }
const button = { backgroundColor: INK, color: PAPER, fontSize: '13px', letterSpacing: '0.22em', textTransform: 'uppercase' as const, borderRadius: '999px', padding: '16px 28px', textDecoration: 'none', display: 'inline-block', fontWeight: 500, fontFamily: monoFamily }
const ctaNote = { fontSize: '12px', color: MUTED, margin: '14px 0 0', lineHeight: 1.5, fontFamily: sansFamily }
const sectionLabel = { fontSize: '11px', letterSpacing: '0.22em', color: MUTED, margin: '12px 0 14px', fontFamily: monoFamily, borderTop: `1px solid ${HAIRLINE}`, paddingTop: '20px' }
const item = { fontSize: '15px', color: INK_SOFT, lineHeight: 1.55, margin: '0 0 16px', fontFamily: sansFamily }
const itemTitle = { color: INK, fontFamily: sansFamily, fontSize: '15px' }
const inlineLink = { color: SIGNAL, textDecoration: 'underline' }
const footer = { fontSize: '13px', color: MUTED, margin: '24px 0 0', lineHeight: 1.55, fontFamily: sansFamily, borderTop: `1px solid ${HAIRLINE}`, paddingTop: '20px' }
const signoff = { fontSize: '13px', color: INK, margin: '20px 4px 0', textAlign: 'center' as const, fontFamily: sansFamily }
