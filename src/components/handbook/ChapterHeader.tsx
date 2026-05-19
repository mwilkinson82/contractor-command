import React from "react";
import Eyebrow from "@/components/editorial/Eyebrow";

interface ChapterHeaderProps {
  number?: number | string;
  title: string;
  subtitle?: string;
}

const ChapterHeader: React.FC<ChapterHeaderProps> = ({ number, title, subtitle }) => {
  return (
    <header className="mb-16 pt-8">
      {number !== undefined && number !== null && (
        <Eyebrow className="mb-6">Chapter {number}</Eyebrow>
      )}
      <h2 className="chapter-heading">{title}</h2>
      {subtitle && (
        <p className="editorial-tagline text-xl md:text-2xl text-foreground/70 mt-6 max-w-3xl">
          {subtitle}
        </p>
      )}
    </header>
  );
};

export default ChapterHeader;
