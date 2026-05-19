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

import { nextOfKind, DISCORD_URL } from '../program'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
  firstName?: string
  discordUrl?: string
  /** Optional overrides; defaults pulled from `src/lib/program.ts` so the
   *  email and the in-app Calls page can never drift apart. */
  zoomUrl?: string
  zoomId?: string
  zoomPasscode?: string
}

const DEFAULT_DISCORD = DISCORD_URL
const LOGO_URL = 'https://qcbbjjjxcacrscfhgfmf.supabase.co/storage/v1/object/public/email-assets/contractor-circle-logo.png'

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
  firstName,
  discordUrl = DEFAULT_DISCORD,
  zoomUrl,
  zoomId,
  zoomPasscode,
}: InviteEmailProps) => {
  const name = firstName?.trim()
  // Single source of truth for the call info: the live program.
  const upcoming = nextOfKind('Biweekly Call')
  const zUrl = zoomUrl ?? upcoming?.zoomUrl ?? ''
  const zId = zoomId ?? upcoming?.zoomId ?? ''
  const zPass = zoomPasscode ?? upcoming?.passcode ?? ''

  // Hero headline — login-style serif with a hard break.
  const headlineTop = name ? `${name},` : 'Welcome'
  const headlineBottom = name ? 'welcome inside.' : 'inside.'

  return (
    <Html lang="en" dir="ltr">
      <Head>
        <style>{`
          @font-face {
            font-family: 'Instrument Serif';
            font-style: normal;
            font-weight: 400;
            font-display: swap;
            src: url(https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-2zI.ttf) format('truetype');
          }
          @font-face {
            font-family: 'Instrument Serif';
            font-style: italic;
            font-weight: 400;
            font-display: swap;
            src: url(https://fonts.gstatic.com/s/instrumentserif/v5/jizDRFtNs2ka5fXjeivQ4LroWlx-zCJ3oneg.ttf) format('truetype');
          }
          @font-face {
            font-family: 'JetBrains Mono';
            font-style: normal;
            font-weight: 500;
            font-display: swap;
            src: url(https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8-qxjPQ.ttf) format('truetype');
          }
        `}</style>
      </Head>
      <Preview>
        Your seat at the Contractor Circle is live. Set your password, then come inside.
      </Preview>

      {/* One paper. End to end. */}
      <Body style={main}>
        <Container style={container}>
          {/* Orange hairline */}
          <div style={topRule} />

          {/* HERO */}
          <Section style={hero}>
            <Text style={eyebrow}>ALP · CONTRACTOR CIRCLE — FOUNDING MEMBER</Text>
            <Heading style={h1}>
              {headlineTop}
              <br />
              {headlineBottom}
            </Heading>
            <Text style={lede}>
              You just made a decision that will change the trajectory of your business.
              What's below isn't a checklist — it's everything the room actually is, and
              the one click that opens the door.
            </Text>

            <Section style={ctaWrap}>
              <Button style={primaryButton} href={confirmationUrl}>
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
          </Section>

          <Hr style={hairline} />

          {/* WHAT YOU ACTUALLY GET — three justified columns of prose */}
          <Section style={block}>
            <Text style={sectionLabel}>WHAT YOU ACTUALLY GET</Text>

            {/* Column 1 — The room */}
            <Text style={colHead}>The room.</Text>
            <Text style={colBody}>
              Bi-weekly Sundays, <strong>5:00 PM ET</strong>, with Marshall. Members
              bring one specific business issue; we work two or three of them live.
              Monthly deal reviews and monthly bootcamps on top of that. Bring deals,
              hiring problems, contract questions — come ready to sit in the chair.
            </Text>
            {zUrl && (
              <Text style={colMeta}>
                Zoom &middot;{' '}
                <Link href={zUrl} style={inlineLink}>
                  {zUrl.replace(/^https?:\/\//, '').split('?')[0]}
                </Link>
                {zId ? <> &nbsp;·&nbsp; ID {zId}</> : null}
                {zPass ? <> &nbsp;·&nbsp; Passcode {zPass}</> : null}
              </Text>
            )}

            <div style={miniRule} />

            {/* Column 2 — The Discord */}
            <Text style={colHead}>The Discord.</Text>
            <Text style={colBody}>
              Where the room actually lives between calls. Head to{' '}
              <strong>#welcome</strong>, read the pin, then drop a one-liner so the
              room knows who just walked in — who you are and what your company does,
              where you're at in the business, and what you came here for.
            </Text>
            <Text style={colMeta}>
              <Link href={discordUrl} style={inlineLink}>
                {discordUrl.replace(/^https?:\/\//, '')}
              </Link>
            </Text>

            <div style={miniRule} />

            {/* Column 3 — The Engine */}
            <Text style={colHead}>The Engine.</Text>
            <Text style={colBody}>
              The portal is your operating system, not a dashboard.{' '}
              <strong>Ask Marshall</strong> is your private thinking partner, trained
              on the whole system — paste a deal, a contract clause, a hiring problem
              and get Marshall's read. The <strong>Vault</strong> holds contracts,
              SOPs, scorecards. The <strong>Replay library</strong> covers every past
              session. And the <strong>AOS Command Tools</strong> — Contract
              Readiness, Margin Leak, Estimate Throughput, SOP Priority, Owner
              Dependency, Growth Constraint — run the analysis a consultant would
              charge five figures for, in under five minutes.
            </Text>
            <Text style={colMeta}>
              <Link href={`${siteUrl}/tools`} style={inlineLink}>
                Open the portal
              </Link>
            </Text>
          </Section>

          <Hr style={hairline} />

          {/* MARSHALL PULL-QUOTE — no card, just a left rule and the type */}
          <Section style={quoteBlock}>
            <Text style={quoteBody}>
              "I've done over $2.5 billion in construction. I've seen what separates
              the contractors who scale from the ones who stay stuck. It's not
              talent. It's access — to the right information, the right room, and
              someone who's been in the trenches. That's what the Circle is."
            </Text>
            <Text style={quoteAttribution}>— Marshall Wilkinson, Founder of ALP</Text>
          </Section>

          <Hr style={hairline} />

          {/* WHAT FOUNDING MEAN — three tight one-liners, justified prose */}
          <Section style={block}>
            <Text style={sectionLabel}>WHAT FOUNDING MEMBER MEANS</Text>
            <Text style={foundingLine}>
              <strong>Price locked. Forever.</strong> You're grandfathered in at the
              founding rate for as long as your membership stays active — the price
              moves, yours doesn't.
            </Text>
            <Text style={foundingLine}>
              <strong>Seats capped.</strong> Founding membership is limited. We're
              not filling seats, we're building a room of serious contractors who
              execute. You earned yours.
            </Text>
            <Text style={foundingLine}>
              <strong>You shape what this becomes.</strong> Your feedback, your
              deals, your wins and your stuck points directly influence how the
              Circle evolves. This is your community as much as ours.
            </Text>
          </Section>

          <Hr style={hairline} />

          {/* FINAL CTA */}
          <Section style={finalCta}>
            <Button style={primaryButton} href={confirmationUrl}>
              Set your password
            </Button>
            <Text style={ctaNote}>
              Bookmark{' '}
              <Link href={siteUrl} style={inlineLink}>
                app.alpcontractorcircle.com
              </Link>{' '}
              — that's home from now on.
            </Text>
          </Section>

          <Text style={signoff}>
            — Marshall &amp; the ALP team
          </Text>

          <Text style={footerMicro}>$2.5 BILLION IN CONSTRUCTION</Text>

          <Text style={footer}>
            You're getting this because your membership at {siteName} is active. If
            you weren't expecting it, reply and we'll sort it out.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default InviteEmail

/* ---------- styles ---------- */

const sansFamily =
  '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif'
const serifFamily = '"Instrument Serif", Georgia, "Times New Roman", serif'
const monoFamily = '"JetBrains Mono", "SFMono-Regular", Menlo, monospace'

const INK = '#1A1918'
const INK_SOFT = '#3a3937'
const MUTED = '#8E8B82'
const PAPER = '#F4F3EF'
const HAIRLINE = '#D9D4C8'
const SIGNAL = '#E4573D'

const main = {
  backgroundColor: PAPER,
  fontFamily: sansFamily,
  margin: 0,
  padding: '0',
}
const container = {
  maxWidth: '600px',
  margin: '0 auto',
  padding: '40px 32px 48px',
  backgroundColor: PAPER,
}
const topRule = {
  height: '2px',
  background: SIGNAL,
  width: '40px',
  marginBottom: '32px',
}
const hairline = {
  borderColor: HAIRLINE,
  borderTop: `1px solid ${HAIRLINE}`,
  margin: '40px 0',
}
const miniRule = {
  height: '1px',
  background: HAIRLINE,
  width: '32px',
  margin: '22px 0',
}

const hero = { margin: '0 0 8px' }
const eyebrow = {
  fontSize: '10.5px',
  letterSpacing: '0.28em',
  color: MUTED,
  margin: '0 0 22px',
  fontFamily: monoFamily,
  textTransform: 'uppercase' as const,
}
const h1 = {
  fontSize: '54px',
  fontWeight: 400,
  color: INK,
  lineHeight: 0.98,
  margin: '0 0 22px',
  fontFamily: serifFamily,
  letterSpacing: '-0.02em',
}
const lede = {
  fontSize: '15.5px',
  color: INK_SOFT,
  lineHeight: 1.6,
  margin: '0 0 28px',
  fontFamily: sansFamily,
}
const ctaWrap = { margin: '0' }
const primaryButton = {
  backgroundColor: INK,
  color: '#F4F0E8',
  fontSize: '12px',
  letterSpacing: '0.24em',
  textTransform: 'uppercase' as const,
  borderRadius: '999px',
  padding: '15px 28px',
  textDecoration: 'none',
  display: 'inline-block',
  fontWeight: 500,
  fontFamily: monoFamily,
}
const ctaNote = {
  fontSize: '12px',
  color: MUTED,
  margin: '14px 0 0',
  lineHeight: 1.5,
  fontFamily: sansFamily,
}
const inlineLink = { color: SIGNAL, textDecoration: 'underline' }

const block = { margin: '0' }
const sectionLabel = {
  fontSize: '10.5px',
  letterSpacing: '0.28em',
  color: SIGNAL,
  margin: '0 0 24px',
  fontFamily: monoFamily,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
}
const colHead = {
  fontSize: '24px',
  fontWeight: 400,
  color: INK,
  margin: '0 0 10px',
  fontFamily: serifFamily,
  letterSpacing: '-0.01em',
  lineHeight: 1.15,
}
const colBody = {
  fontSize: '14.5px',
  color: INK_SOFT,
  lineHeight: 1.65,
  margin: '0 0 10px',
  fontFamily: sansFamily,
  textAlign: 'justify' as const,
}
const colMeta = {
  fontSize: '11.5px',
  color: MUTED,
  letterSpacing: '0.04em',
  margin: '6px 0 0',
  fontFamily: monoFamily,
  lineHeight: 1.55,
}

const quoteBlock = {
  borderLeft: `2px solid ${SIGNAL}`,
  paddingLeft: '20px',
  margin: '0',
}
const quoteBody = {
  fontSize: '20px',
  color: INK,
  lineHeight: 1.45,
  margin: '0 0 14px',
  fontFamily: serifFamily,
  fontStyle: 'italic' as const,
  letterSpacing: '-0.005em',
}
const quoteAttribution = {
  fontSize: '10.5px',
  letterSpacing: '0.24em',
  color: MUTED,
  margin: 0,
  fontFamily: monoFamily,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
}

const foundingLine = {
  fontSize: '14.5px',
  color: INK_SOFT,
  lineHeight: 1.65,
  margin: '0 0 14px',
  fontFamily: sansFamily,
  textAlign: 'justify' as const,
}

const finalCta = { margin: '0' }

const signoff = {
  fontSize: '14px',
  color: INK,
  lineHeight: 1.6,
  margin: '36px 0 28px',
  fontFamily: serifFamily,
  fontStyle: 'italic' as const,
}
const footerMicro = {
  fontSize: '10px',
  letterSpacing: '0.32em',
  color: MUTED,
  margin: '0 0 18px',
  fontFamily: monoFamily,
  textTransform: 'uppercase' as const,
}
const footer = {
  fontSize: '11px',
  color: MUTED,
  lineHeight: 1.55,
  margin: '0',
  fontFamily: sansFamily,
}
