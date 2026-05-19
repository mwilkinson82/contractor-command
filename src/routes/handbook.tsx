import { createFileRoute } from "@tanstack/react-router";
import "@/styles/handbook.css";

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
import FinalChapter from "@/components/handbook/content/FinalChapter";
import ReadingProgress from "@/components/handbook/ReadingProgress";
import FloatingTOC from "@/components/handbook/FloatingTOC";

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
  }),
  component: HandbookPage,
});

function HandbookPage() {
  return (
    <div className="handbook-scope min-h-screen">
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

        {/* Part III — The Business Systems */}
        <PartHeader number="III" title="The Business Systems" />
        <Chapter4 />
        <Chapter5 />
        <Chapter6 />
        <Chapter7 />
        <Chapter11 />
        <Chapter10 />

        {/* Part IV — Time, Money, and Commercial Control */}
        <PartHeader number="IV" title="Time, Money, and Commercial Control" />
        <Chapter12 />
        <Chapter13 />
        <Chapter20 />
        <Chapter14 />
        <Chapter15 />
        <Chapter18 />
        <Chapter8 />
        <Chapter17 />
        <Chapter19 />
        <Chapter16 />
        <Chapter21 />
        <Chapter9 />
        <Chapter22 />

        {/* Part V — Identity, Leadership, and Scale */}
        <PartHeader number="V" title="Identity, Leadership, and Scale" />
        <Chapter23 />
        <Chapter26 />
        <Chapter25 />

        {/* Part VI — Real-Time Application & Commitment */}
        <PartHeader number="VI" title="Real-Time Application & Commitment" />
        <Chapter24 />
        <FinalChapter />

        <footer className="py-32 text-center" style={{ borderTop: "1px solid hsl(var(--hb-chapter-divider))" }}>
          <p className="text-sm uppercase tracking-widest opacity-40" style={{ letterSpacing: "0.2em" }}>
            The ALP Handbook
          </p>
          <p className="text-sm opacity-30 mt-4">© Marshall Wilkinson</p>
        </footer>
      </div>

      <FloatingTOC />
    </div>
  );
}
