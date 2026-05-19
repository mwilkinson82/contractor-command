import { createFileRoute } from "@tanstack/react-router";
import "@/styles/handbook.css";

import HeroSection from "@/components/handbook/HeroSection";
import TableOfContents from "@/components/handbook/TableOfContents";
import PartHeader from "@/components/handbook/PartHeader";
import Dedication from "@/components/handbook/content/Dedication";
import Foreword from "@/components/handbook/content/Foreword";
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

        <Dedication />
        <Foreword />

        <PartHeader number="I" title="The Frame" />
        <Chapter1 /><Chapter2 /><Chapter3 />

        <PartHeader number="II" title="The Stool (Systems)" />
        <Chapter4 /><Chapter5 /><Chapter6 /><Chapter7 />
        <Chapter8 /><Chapter9 /><Chapter10 />

        <PartHeader number="III" title="Time, Money, & Leverage" />
        <Chapter11 /><Chapter12 /><Chapter13 /><Chapter14 />
        <Chapter15 /><Chapter16 /><Chapter17 /><Chapter18 />

        <PartHeader number="IV" title="Identity & Scale" />
        <Chapter19 /><Chapter20 /><Chapter21 /><Chapter22 /><Chapter23 />

        <PartHeader number="V" title="Real-Time Application" />
        <Chapter24 /><Chapter25 /><Chapter26 />

        <PartHeader number="VI" title="Commitment" />
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
