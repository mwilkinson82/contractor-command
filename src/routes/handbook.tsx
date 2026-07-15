import { createFileRoute } from "@tanstack/react-router";
import "@/styles/handbook.css";
import bulldozerHero from "@/assets/handbook/bulldozer-hero.webp";

import HeroSection from "@/components/handbook/HeroSection";
import TableOfContents from "@/components/handbook/TableOfContents";
import PartHeader from "@/components/handbook/PartHeader";
import Dedication from "@/components/handbook/content/Dedication";
import Foreword from "@/components/handbook/content/Foreword";
import HowToUse from "@/components/handbook/content/HowToUse";
import Volume2Intro from "@/components/handbook/content/Volume2Intro";
import Chapter1 from "@/components/handbook/content/Chapter1";
import Chapter2 from "@/components/handbook/content/Chapter2";
import Chapter3 from "@/components/handbook/content/Chapter3";
import Chapter4 from "@/components/handbook/content/Chapter4";
import Chapter5 from "@/components/handbook/content/Chapter5";
import Chapter6 from "@/components/handbook/content/Chapter6";
import Chapter7 from "@/components/handbook/content/Chapter7";
import Chapter8 from "@/components/handbook/content/Chapter8";
import Chapter9 from "@/components/handbook/content/Chapter9";
import Chapter10 from "@/components/handbook/content/Chapter10";
import Chapter11 from "@/components/handbook/content/Chapter11";
import Chapter12 from "@/components/handbook/content/Chapter12";
import Chapter13 from "@/components/handbook/content/Chapter13";
import Chapter14 from "@/components/handbook/content/Chapter14";
import Chapter15 from "@/components/handbook/content/Chapter15";
import Chapter16 from "@/components/handbook/content/Chapter16";
import Chapter17 from "@/components/handbook/content/Chapter17";
import Chapter18 from "@/components/handbook/content/Chapter18";
import Chapter19 from "@/components/handbook/content/Chapter19";
import Chapter20 from "@/components/handbook/content/Chapter20";
import Chapter21 from "@/components/handbook/content/Chapter21";
import Chapter22 from "@/components/handbook/content/Chapter22";
import Chapter23 from "@/components/handbook/content/Chapter23";
import Chapter24 from "@/components/handbook/content/Chapter24";
import Chapter25 from "@/components/handbook/content/Chapter25";
import Chapter26 from "@/components/handbook/content/Chapter26";
import Chapter27 from "@/components/handbook/content/Chapter27";
import Chapter28 from "@/components/handbook/content/Chapter28";
import Chapter29 from "@/components/handbook/content/Chapter29";
import Chapter30 from "@/components/handbook/content/Chapter30";
import Chapter31 from "@/components/handbook/content/Chapter31";
import Chapter32 from "@/components/handbook/content/Chapter32";
import ProfessionalContractorFieldGuide from "@/components/handbook/content/ProfessionalContractorFieldGuide";
import FinalChapter from "@/components/handbook/content/FinalChapter";
import ReadingProgress from "@/components/handbook/ReadingProgress";
import FloatingTOC from "@/components/handbook/FloatingTOC";
import { HandbookMobileMenu } from "@/components/handbook/MobileMenuButton";

export const Route = createFileRoute("/handbook")({
  head: () => ({
    meta: [
      { title: "The ALP Handbook — Contractor Circle" },
      {
        name: "description",
        content:
          "The operating manual behind ALP — Altitude, Logic, Pressure. Read the full handbook inside the portal.",
      },
    ],
    links: [{ rel: "preload", as: "image", href: bulldozerHero, fetchpriority: "high" }],
  }),
  component: HandbookPage,
});

function HandbookPage() {
  return (
    <div className="handbook-scope min-h-screen">
      <HandbookMobileMenu />
      <ReadingProgress />

      <div className="max-w-5xl mx-auto px-8 md:px-16 lg:px-24 pt-8">
        <HeroSection />
        <TableOfContents />

        {/* Front Matter */}
        <Dedication />
        <Foreword />
        <HowToUse />

        {/* Part I — The Frame */}
        <PartHeader number="I" title="The Frame" />
        <Chapter1 />
        <Chapter2 />
        <Chapter3 />

        {/* Part II — The Operating System (Volume 2) */}
        <PartHeader number="II" title="The Operating System" eyebrow="New in V2" />
        <Volume2Intro />
        <Chapter27 />
        <Chapter28 />
        <Chapter29 />
        <Chapter30 />
        <Chapter31 />
        <Chapter32 />

        {/* Part III — The Professional Contractor Field Guide */}
        <PartHeader number="III" title="The Professional Contractor Field Guide" eyebrow="New" />
        <ProfessionalContractorFieldGuide />

        {/* Part IV — The Business Systems */}
        <PartHeader number="IV" title="The Business Systems" eyebrow="Reorganized in V2" />
        <Chapter4 />
        <Chapter5 />
        <Chapter6 />
        {/* #13 Operations as Margin Protection + absorbed Operations Is Logistics */}
        <Chapter7 />
        <Chapter11 />
        <Chapter10 />

        {/* Part V — Time, Money, and Commercial Control */}
        <PartHeader
          number="V"
          title="Time, Money, and Commercial Control"
          eyebrow="Reorganized in V2"
        />
        {/* #15 Documentation */}
        <Chapter12 />
        {/* #16 Notices + absorbed Ch 20 (Notices/Docs/Offense at Scale) */}
        <Chapter13 />
        <Chapter20 />
        {/* #17 Scheduling + absorbed Start-Stop (Ch15) + CPM (Ch18) */}
        <Chapter14 />
        <Chapter15 />
        <Chapter18 />
        {/* #18 General Conditions + absorbed Profit Center (Ch17) */}
        <Chapter8 />
        <Chapter17 />
        {/* #19 Change Order Velocity */}
        <Chapter19 />
        {/* #20 Financial Command + absorbed Financial Authority (Ch21) */}
        <Chapter16 />
        <Chapter21 />
        {/* #21 Decision Matrix + absorbed Ch 22 */}
        <Chapter9 />
        <Chapter22 />

        {/* Part VI — Identity, Leadership, and Scale */}
        <PartHeader
          number="VI"
          title="Identity, Leadership, and Scale"
          eyebrow="Reorganized in V2"
        />
        <Chapter23 />
        <Chapter26 />
        <Chapter25 />

        {/* Part VII — Real-Time Application & Commitment */}
        <PartHeader
          number="VII"
          title="Real-Time Application & Commitment"
          eyebrow="Reorganized in V2"
        />
        <Chapter24 />
        <FinalChapter />

        <footer
          className="py-32 text-center"
          style={{ borderTop: "1px solid hsl(var(--hb-chapter-divider))" }}
        >
          <p
            className="text-sm uppercase tracking-widest opacity-40"
            style={{ letterSpacing: "0.2em" }}
          >
            The ALP Handbook
          </p>
          <p className="text-sm opacity-30 mt-4">© Marshall Wilkinson</p>
        </footer>
      </div>

      <FloatingTOC />
    </div>
  );
}
