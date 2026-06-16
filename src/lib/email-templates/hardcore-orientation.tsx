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
import type { TemplateEntry } from './registry'
import { DISCORD_URL } from '../program'

interface Props {
  firstName?: string
  siteUrl?: string
  discordUrl?: string
}

const DEFAULT_SITE = 'https://app.alpcontractorcircle.com'

const Email = ({
  firstName,
  siteUrl = DEFAULT_SITE,
  discordUrl = DISCORD_URL,
}: Props) => {
  const name = firstName?.trim()
  const headlineTop = name ? `${name},` : 'Welcome'
  const headlineBottom = name ? 'here\u2019s the whole room.' : 'here\u2019s the whole room.'

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
        Quick orientation \u2014 every room, tool, and replay you now have access to.
      </Preview>

      <Body style={main}>
        <Container style={container}>
          <div style={topRule} />

          <Section style={hero}>
            <Text style={eyebrow}>ALP \u00B7 ORIENTATION \u2014 HARDCORE ACCESS</Text>
            <Heading style={h1}>
              {headlineTop}
              <br />
              {headlineBottom}
            </Heading>
            <Text style={lede}>
              You\u2019re fully unlocked across everything ALP runs \u2014 every room, every
              replay, every tool. This note is the short tour so nothing important
              stays hidden behind a menu.
            </Text>
            <Section style={ctaWrap}>
              <Button style={primaryButton} href={siteUrl}>
                Open the portal
              </Button>
              <Text style={ctaNote}>
                Home base is{' '}
                <Link href={siteUrl} style={inlineLink}>
                  app.alpcontractorcircle.com
                </Link>
                .
              </Text>
            </Section>
          </Section>

          <Hr style={hairline} />

          <Section style={block}>
            <Text style={sectionLabel}>THE DAILY ROOM</Text>
            <Text style={colHead}>Hardcore.</Text>
            <Text style={colBody}>
              The daily live room. <strong>Power Hour</strong> every weekday at
              8:00 AM PT, <strong>Contractor School</strong> on Tuesdays, and
              <strong> Sales &amp; Marketing School</strong> on Wednesdays. The full
              calendar with Meet links and past recordings lives at{' '}
              <Link href={`${siteUrl}/hardcore`} style={inlineLink}>
                /hardcore
              </Link>
              . Drop in raw \u2014 cameras, questions, real deals.
            </Text>

            <div style={miniRule} />

            <Text style={colHead}>The Circle call.</Text>
            <Text style={colBody}>
              Bi-weekly Sundays at <strong>5:00 PM ET</strong> with Marshall. Bring
              one specific business issue; we work two or three live. Zoom info,
              upcoming dates, and replays are on{' '}
              <Link href={`${siteUrl}/calls`} style={inlineLink}>
                /calls
              </Link>
              .
            </Text>

            <div style={miniRule} />

            <Text style={colHead}>Discord.</Text>
            <Text style={colBody}>
              Where the room lives between sessions. Head to <strong>#welcome</strong>,
              read the pin, and drop a one-liner: who you are, what your company does,
              where you\u2019re at, and what you came here for.
            </Text>
            <Text style={colMeta}>
              <Link href={discordUrl} style={inlineLink}>
                {discordUrl.replace(/^https?:\/\//, '')}
              </Link>
            </Text>
          </Section>

          <Hr style={hairline} />

          <Section style={block}>
            <Text style={sectionLabel}>THE ENGINE</Text>

            <Text style={colHead}>Ask Marshall.</Text>
            <Text style={colBody}>
              Your private thinking partner, trained on the entire system. Paste a
              deal, a contract clause, a hiring problem, a margin issue \u2014 get
              Marshall\u2019s read in seconds. Live at{' '}
              <Link href={`${siteUrl}/ask`} style={inlineLink}>
                /ask
              </Link>
              .
            </Text>

            <div style={miniRule} />

            <Text style={colHead}>The Vault.</Text>
            <Text style={colBody}>
              Contracts, SOPs, scorecards, templates \u2014 the back-office library
              that took us years to build. Search and download from{' '}
              <Link href={`${siteUrl}/vault`} style={inlineLink}>
                /vault
              </Link>
              .
            </Text>

            <div style={miniRule} />

            <Text style={colHead}>Replays.</Text>
            <Text style={colBody}>
              Every past Circle call, Power Hour, Contractor School and S&amp;M
              School session, indexed and searchable at{' '}
              <Link href={`${siteUrl}/replays`} style={inlineLink}>
                /replays
              </Link>
              .
            </Text>

            <div style={miniRule} />

            <Text style={colHead}>AOS Command Tools.</Text>
            <Text style={colBody}>
              The operating system. <strong>Contract Readiness</strong>,{' '}
              <strong>Margin Leak</strong>, <strong>Estimate Throughput</strong>,{' '}
              <strong>SOP Priority</strong>, <strong>Owner Dependency</strong>,{' '}
              <strong>Growth Constraint</strong> \u2014 the analysis a consultant
              charges five figures for, in under five minutes. All on{' '}
              <Link href={`${siteUrl}/tools`} style={inlineLink}>
                /tools
              </Link>
              .
            </Text>

            <div style={miniRule} />

            <Text style={colHead}>AOS workspace.</Text>
            <Text style={colBody}>
              Your seat-based workspace for actually running the playbook (scorecards,
              rocks, L10s, accountability chart). You have unlimited workspaces and
              seats. Wire it up from{' '}
              <Link href={`${siteUrl}/aos`} style={inlineLink}>
                /aos
              </Link>
              .
            </Text>
          </Section>

          <Hr style={hairline} />

          <Section style={quoteBlock}>
            <Text style={quoteBody}>
              \u201CThe contractors who scale aren\u2019t more talented \u2014 they have
              access to the right information, the right room, and someone who\u2019s
              been in the trenches. That\u2019s what you\u2019re standing inside now.\u201D
            </Text>
            <Text style={quoteAttribution}>\u2014 Marshall Wilkinson</Text>
          </Section>

          <Hr style={hairline} />

          <Section style={block}>
            <Text style={sectionLabel}>FIRST 72 HOURS</Text>
            <Text style={foundingLine}>
              <strong>1.</strong> Sign in and bookmark{' '}
              <Link href={siteUrl} style={inlineLink}>
                app.alpcontractorcircle.com
              </Link>
              .
            </Text>
            <Text style={foundingLine}>
              <strong>2.</strong> Hop into Discord and post your one-liner in{' '}
              <strong>#welcome</strong>.
            </Text>
            <Text style={foundingLine}>
              <strong>3.</strong> Show up to the next Power Hour at{' '}
              <Link href={`${siteUrl}/hardcore`} style={inlineLink}>
                /hardcore
              </Link>{' '}
              \u2014 even just to listen.
            </Text>
            <Text style={foundingLine}>
              <strong>4.</strong> Open <strong>Ask Marshall</strong> and throw your
              most pressing problem at it. That\u2019s the fastest way to feel what
              this thing is.
            </Text>
          </Section>

          <Hr style={hairline} />

          <Section style={finalCta}>
            <Button style={primaryButton} href={siteUrl}>
              Step inside
            </Button>
            <Text style={ctaNote}>
              Anything missing or weird? Just reply to this email \u2014 it goes
              straight to Marshall.
            </Text>
          </Section>

          <Text style={signoff}>\u2014 Marshall &amp; the ALP team</Text>

          <Text style={footerMicro}>$2.5 BILLION IN CONSTRUCTION</Text>

          <Text style={footer}>
            You\u2019re getting this orientation because your ALP membership is
            active.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: Email,
  subject: 'Welcome inside \u2014 here\u2019s the whole room',
  displayName: 'Hardcore orientation',
  previewData: { firstName: 'Ervin' },
} satisfies TemplateEntry

export default Email

/* ---------- styles (mirrors invite.tsx) ---------- */

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

const main = { backgroundColor: PAPER, fontFamily: sansFamily, margin: 0, padding: '0' }
const container = { maxWidth: '600px', margin: '0 auto', padding: '40px 32px 48px', backgroundColor: PAPER }
const topRule = { height: '2px', background: SIGNAL, width: '40px', marginBottom: '32px' }
const hairline = { borderColor: HAIRLINE, borderTop: `1px solid ${HAIRLINE}`, margin: '40px 0' }
const miniRule = { height: '1px', background: HAIRLINE, width: '32px', margin: '22px 0' }
const hero = { margin: '0 0 8px' }
const eyebrow = { fontSize: '10.5px', letterSpacing: '0.28em', color: MUTED, margin: '0 0 22px', fontFamily: monoFamily, textTransform: 'uppercase' as const }
const h1 = { fontSize: '54px', fontWeight: 400, color: INK, lineHeight: 0.98, margin: '0 0 22px', fontFamily: serifFamily, letterSpacing: '-0.02em' }
const lede = { fontSize: '15.5px', color: INK_SOFT, lineHeight: 1.6, margin: '0 0 28px', fontFamily: sansFamily }
const ctaWrap = { margin: '0' }
const primaryButton = { backgroundColor: INK, color: '#F4F0E8', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase' as const, borderRadius: '999px', padding: '15px 28px', textDecoration: 'none', display: 'inline-block', fontWeight: 500, fontFamily: monoFamily }
const ctaNote = { fontSize: '12px', color: MUTED, margin: '14px 0 0', lineHeight: 1.5, fontFamily: sansFamily }
const inlineLink = { color: SIGNAL, textDecoration: 'underline' }
const block = { margin: '0' }
const sectionLabel = { fontSize: '10.5px', letterSpacing: '0.28em', color: SIGNAL, margin: '0 0 24px', fontFamily: monoFamily, fontWeight: 600, textTransform: 'uppercase' as const }
const colHead = { fontSize: '24px', fontWeight: 400, color: INK, margin: '0 0 10px', fontFamily: serifFamily, letterSpacing: '-0.01em', lineHeight: 1.15 }
const colBody = { fontSize: '14.5px', color: INK_SOFT, lineHeight: 1.65, margin: '0 0 10px', fontFamily: sansFamily, textAlign: 'justify' as const }
const colMeta = { fontSize: '11.5px', color: MUTED, letterSpacing: '0.04em', margin: '6px 0 0', fontFamily: monoFamily, lineHeight: 1.55 }
const quoteBlock = { borderLeft: `2px solid ${SIGNAL}`, paddingLeft: '20px', margin: '0' }
const quoteBody = { fontSize: '20px', color: INK, lineHeight: 1.45, margin: '0 0 14px', fontFamily: serifFamily, fontStyle: 'italic' as const, letterSpacing: '-0.005em' }
const quoteAttribution = { fontSize: '10.5px', letterSpacing: '0.24em', color: MUTED, margin: 0, fontFamily: monoFamily, fontWeight: 600, textTransform: 'uppercase' as const }
const foundingLine = { fontSize: '14.5px', color: INK_SOFT, lineHeight: 1.65, margin: '0 0 14px', fontFamily: sansFamily, textAlign: 'justify' as const }
const finalCta = { margin: '0' }
const signoff = { fontSize: '14px', color: INK, lineHeight: 1.6, margin: '36px 0 28px', fontFamily: serifFamily, fontStyle: 'italic' as const }
const footerMicro = { fontSize: '10px', letterSpacing: '0.32em', color: MUTED, margin: '0 0 18px', fontFamily: monoFamily, textTransform: 'uppercase' as const }
const footer = { fontSize: '11px', color: MUTED, lineHeight: 1.55, margin: '0', fontFamily: sansFamily }
