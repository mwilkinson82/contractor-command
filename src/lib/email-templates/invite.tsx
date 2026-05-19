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

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
  firstName?: string
  discordUrl?: string
  zoomUrl?: string
}

const DEFAULT_DISCORD = 'https://discord.gg/alpcontractorcircle'
const DEFAULT_ZOOM = 'https://us06web.zoom.us/j/0000000000'

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
  firstName,
  discordUrl = DEFAULT_DISCORD,
  zoomUrl = DEFAULT_ZOOM,
}: InviteEmailProps) => {
  const name = firstName?.trim()
  const headline = name ? `${name}, welcome to the Circle.` : 'Welcome to the Circle.'

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
      <Body style={main}>
        <Container style={container}>
          {/* Top accent rule */}
          <div style={topRule} />

          {/* HERO CARD */}
          <Section style={card}>
            <Text style={eyebrow}>FOUNDING MEMBER · ALP CONTRACTOR CIRCLE</Text>
            <Heading style={h1}>{headline}</Heading>
            <Text style={lede}>
              You just made a decision that will change the trajectory of your business.
              Here's everything you need to get started — and your first step is one click
              away.
            </Text>

            <Section style={ctaWrap}>
              <Button style={button} href={confirmationUrl}>
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

          {/* STEP 01 */}
          <Section style={stepCard}>
            <Text style={stepNumber}>STEP 01</Text>
            <Heading as="h2" style={stepTitle}>
              Join the Discord.
            </Heading>
            <Text style={stepBody}>
              This is where the room actually lives between calls. Head to{' '}
              <strong>#welcome</strong>, read the pin, and you'll get access to{' '}
              <strong>#general-chat</strong> and the private{' '}
              <strong>#circle-chat</strong> thread.
            </Text>
            <Text style={stepBody}>Drop a one-liner so the room knows who just walked in:</Text>
            <Text style={stepBullet}>
              · <strong>Who you are</strong> and what your company does
            </Text>
            <Text style={stepBullet}>
              · <strong>Where you're at</strong> in the business right now
            </Text>
            <Text style={stepBullet}>
              · <strong>What you came here for</strong>
            </Text>
            <Section style={stepCtaWrap}>
              <Button style={secondaryButton} href={discordUrl}>
                Open the Discord
              </Button>
            </Section>
          </Section>

          {/* STEP 02 */}
          <Section style={stepCard}>
            <Text style={stepNumber}>STEP 02</Text>
            <Heading as="h2" style={stepTitle}>
              Put the bi-weekly call on your calendar.
            </Heading>
            <Text style={stepBody}>
              Every other <strong>Sunday at 5:00 PM ET</strong> — group call with Marshall.
              Bring deals, questions, hiring problems, contract questions. Come ready to
              sit in the chair.
            </Text>
            <Text style={stepBody}>
              Zoom:{' '}
              <Link href={zoomUrl} style={inlineLink}>
                {zoomUrl.replace(/^https?:\/\//, '')}
              </Link>
            </Text>
          </Section>

          {/* STEP 03 */}
          <Section style={stepCard}>
            <Text style={stepNumber}>STEP 03</Text>
            <Heading as="h2" style={stepTitle}>
              Open the Engine.
            </Heading>
            <Text style={stepBody}>
              The portal is your operating system: the <strong>Vault</strong> (contracts,
              SOPs, scorecards), the full <strong>replay library</strong>, and the{' '}
              <strong>AOS Engine</strong> — AI tools trained on the operating system. Run a
              contract scan, draft an SOP, or build a hiring scorecard in under five minutes.
            </Text>
            <Section style={stepCtaWrap}>
              <Button style={secondaryButton} href={`${siteUrl}/tools`}>
                Open the portal
              </Button>
            </Section>
          </Section>

          {/* MEMBERSHIP INCLUDES */}
          <Section style={includesCard}>
            <Text style={includesLabel}>YOUR MEMBERSHIP INCLUDES</Text>
            <Text style={includeRow}>
              <span style={checkmark}>✓</span> Bi-weekly Sunday group calls with Marshall
            </Text>
            <Text style={includeRow}>
              <span style={checkmark}>✓</span> Monthly deal reviews
            </Text>
            <Text style={includeRow}>
              <span style={checkmark}>✓</span> Monthly bootcamp sessions
            </Text>
            <Text style={includeRow}>
              <span style={checkmark}>✓</span> Complete Vault — contracts, SOPs, scorecards
            </Text>
            <Text style={includeRow}>
              <span style={checkmark}>✓</span> AOS Engine — AI tools trained on the system
            </Text>
            <Text style={includeRow}>
              <span style={checkmark}>✓</span> Private Discord community
            </Text>
            <Text style={includeRow}>
              <span style={checkmark}>✓</span> Full replay library of past sessions
            </Text>
          </Section>

          {/* FOUNDING STATUS */}
          <Section style={card}>
            <Text style={sectionLabel}>WHAT FOUNDING MEMBER ACTUALLY MEANS</Text>

            <Heading as="h3" style={statusTitle}>
              Price locked. Forever.
            </Heading>
            <Text style={text}>
              You're grandfathered in at the founding rate. As the community grows and the
              price moves, your rate stays exactly where it is — for as long as your
              membership stays active.
            </Text>

            <Heading as="h3" style={statusTitle}>
              Limited spots. You got one.
            </Heading>
            <Text style={text}>
              Founding membership is capped. We're not filling seats — we're building a
              room of serious contractors who execute. You earned your spot.
            </Text>

            <Heading as="h3" style={statusTitle}>
              You're shaping what this becomes.
            </Heading>
            <Text style={text}>
              As a founding member, your feedback, your deals, your wins and your stuck
              points directly influence how the Circle evolves. This is your community as
              much as it is ours.
            </Text>
          </Section>

          {/* MARSHALL QUOTE */}
          <Section style={quoteCard}>
            <Text style={quoteLabel}>FROM MARSHALL</Text>
            <Text style={quoteBody}>
              "I've done over $2.5 billion in construction. I've seen what separates the
              contractors who scale from the ones who stay stuck. It's not talent. It's
              access — to the right information, the right room, and someone who's been
              in the trenches. That's what the Circle is. I'm glad you're in it."
            </Text>
            <Text style={quoteAttribution}>— Marshall Wilkinson, Founder of ALP</Text>
          </Section>

          {/* FINAL CTA */}
          <Section style={finalCtaWrap}>
            <Button style={button} href={confirmationUrl}>
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

          <Hr style={rule} />

          <Text style={signoff}>
            See you inside,
            <br />
            <strong>Marshall &amp; the ALP team</strong>
          </Text>

          <Text style={footer}>
            You're getting this because your membership at {siteName} is active. If you
            weren't expecting it, reply to this email and we'll sort it out.
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
const PAPER_DEEP = '#EDEAE2'
const HAIRLINE = '#E2DED6'
const SIGNAL = '#E4573D'

const main = {
  backgroundColor: '#ffffff',
  fontFamily: sansFamily,
  margin: 0,
  padding: '32px 0',
}
const container = {
  maxWidth: '600px',
  margin: '0 auto',
  padding: '0 16px',
}
const topRule = {
  height: '2px',
  background: SIGNAL,
  width: '100%',
  marginBottom: '24px',
}
const card = {
  backgroundColor: PAPER,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: '20px',
  padding: '40px 36px',
  marginBottom: '16px',
}
const eyebrow = {
  fontSize: '11px',
  letterSpacing: '0.22em',
  color: MUTED,
  margin: '0 0 18px',
  fontFamily: monoFamily,
}
const h1 = {
  fontSize: '40px',
  fontWeight: 400,
  color: INK,
  lineHeight: 1.05,
  margin: '0 0 18px',
  fontFamily: serifFamily,
  letterSpacing: '-0.01em',
}
const lede = {
  fontSize: '16px',
  color: INK_SOFT,
  lineHeight: 1.55,
  margin: '0 0 28px',
  fontFamily: sansFamily,
}
const ctaWrap = { margin: '4px 0 8px' }
const button = {
  backgroundColor: INK,
  color: PAPER,
  fontSize: '13px',
  letterSpacing: '0.22em',
  textTransform: 'uppercase' as const,
  borderRadius: '999px',
  padding: '16px 28px',
  textDecoration: 'none',
  display: 'inline-block',
  fontWeight: 500,
  fontFamily: monoFamily,
}
const secondaryButton = {
  backgroundColor: 'transparent',
  color: INK,
  fontSize: '12px',
  letterSpacing: '0.22em',
  textTransform: 'uppercase' as const,
  borderRadius: '999px',
  padding: '12px 22px',
  textDecoration: 'none',
  display: 'inline-block',
  fontWeight: 500,
  fontFamily: monoFamily,
  border: `1px solid ${INK}`,
}
const ctaNote = {
  fontSize: '12px',
  color: MUTED,
  margin: '14px 0 0',
  lineHeight: 1.5,
  fontFamily: sansFamily,
}
const inlineLink = { color: SIGNAL, textDecoration: 'underline' }
const rule = {
  borderColor: HAIRLINE,
  borderTop: `1px solid ${HAIRLINE}`,
  margin: '32px 0 24px',
}

/* step cards (nested paper) */
const stepCard = {
  backgroundColor: PAPER_DEEP,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: '16px',
  padding: '32px 30px',
  marginBottom: '16px',
}
const stepNumber = {
  fontSize: '11px',
  letterSpacing: '0.28em',
  color: SIGNAL,
  margin: '0 0 10px',
  fontFamily: monoFamily,
  fontWeight: 600,
}
const stepTitle = {
  fontSize: '26px',
  fontWeight: 400,
  color: INK,
  lineHeight: 1.15,
  margin: '0 0 14px',
  fontFamily: serifFamily,
  letterSpacing: '-0.01em',
}
const stepBody = {
  fontSize: '15px',
  color: INK_SOFT,
  lineHeight: 1.6,
  margin: '0 0 12px',
  fontFamily: sansFamily,
}
const stepBullet = {
  fontSize: '14px',
  color: INK,
  lineHeight: 1.6,
  margin: '0 0 6px',
  fontFamily: sansFamily,
}
const stepCtaWrap = { margin: '18px 0 0' }

/* membership-includes */
const includesCard = {
  backgroundColor: PAPER,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: '16px',
  padding: '28px 30px',
  marginBottom: '16px',
}
const includesLabel = {
  fontSize: '11px',
  letterSpacing: '0.22em',
  color: SIGNAL,
  margin: '0 0 16px',
  fontFamily: monoFamily,
  fontWeight: 600,
}
const includeRow = {
  fontSize: '14px',
  color: INK,
  lineHeight: 1.6,
  margin: '0 0 8px',
  fontFamily: sansFamily,
}
const checkmark = {
  color: SIGNAL,
  fontWeight: 600,
  marginRight: '8px',
}

/* status block */
const sectionLabel = {
  fontSize: '11px',
  letterSpacing: '0.22em',
  color: MUTED,
  margin: '0 0 18px',
  fontFamily: monoFamily,
}
const statusTitle = {
  fontSize: '20px',
  fontWeight: 400,
  color: INK,
  margin: '20px 0 8px',
  fontFamily: serifFamily,
  letterSpacing: '-0.01em',
  lineHeight: 1.2,
}
const text = {
  fontSize: '14px',
  color: INK_SOFT,
  lineHeight: 1.6,
  margin: '0 0 4px',
  fontFamily: sansFamily,
}

/* quote */
const quoteCard = {
  backgroundColor: PAPER,
  borderLeft: `3px solid ${SIGNAL}`,
  borderTop: `1px solid ${HAIRLINE}`,
  borderRight: `1px solid ${HAIRLINE}`,
  borderBottom: `1px solid ${HAIRLINE}`,
  borderRadius: '4px 16px 16px 4px',
  padding: '28px 30px',
  marginBottom: '16px',
}
const quoteLabel = {
  fontSize: '10px',
  letterSpacing: '0.28em',
  color: MUTED,
  margin: '0 0 14px',
  fontFamily: monoFamily,
  fontWeight: 600,
}
const quoteBody = {
  fontSize: '17px',
  color: INK,
  lineHeight: 1.5,
  margin: '0 0 16px',
  fontFamily: serifFamily,
  fontStyle: 'italic' as const,
}
const quoteAttribution = {
  fontSize: '12px',
  letterSpacing: '0.12em',
  color: SIGNAL,
  margin: 0,
  fontFamily: monoFamily,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
}

/* final CTA */
const finalCtaWrap = {
  textAlign: 'center' as const,
  margin: '24px 0 0',
}

const signoff = {
  fontSize: '15px',
  color: INK,
  lineHeight: 1.6,
  margin: '20px 4px 24px',
  fontFamily: sansFamily,
}
const footer = {
  fontSize: '11px',
  color: MUTED,
  lineHeight: 1.55,
  margin: '20px 4px 0',
  textAlign: 'center' as const,
  fontFamily: sansFamily,
}
