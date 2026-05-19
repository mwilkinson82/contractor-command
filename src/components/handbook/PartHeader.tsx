import React from "react";
import Eyebrow from "@/components/editorial/Eyebrow";

interface PartHeaderProps {
  number: string;
  title: string;
  eyebrow?: string;
}

const PartHeader: React.FC<PartHeaderProps> = ({ number, title, eyebrow }) => {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center py-32">
      <Eyebrow className="mb-10">Part {number}</Eyebrow>

      <h1
        className="font-serif text-5xl md:text-7xl lg:text-8xl leading-[0.92]"
        style={{ fontWeight: 400, letterSpacing: "-0.03em" }}
      >
        {title}
      </h1>

      {eyebrow && (
        <div className="mt-10 flex flex-col items-center gap-5">
          <div className="w-12 h-px bg-foreground/30" />
          <Eyebrow accent>{eyebrow}</Eyebrow>
        </div>
      )}

      <div className="part-divider mt-16" />
    </div>
  );
};

export default PartHeader;
