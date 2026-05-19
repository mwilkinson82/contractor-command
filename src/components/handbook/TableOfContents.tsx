import React from "react";
import Eyebrow from "@/components/editorial/Eyebrow";

interface TocItem {
  id: string;
  title: string;
  chapter?: string;
  badge?: string;
}

interface TocSection {
  part?: string;
  title: string;
  eyebrow?: string;
  items: TocItem[];
}

const tocData: TocSection[] = [
  {
    title: "Front Matter",
    items: [
      { id: "dedication", title: "Dedication" },
      { id: "foreword", title: "Foreword / Author's Note", badge: "Updated for V2" },
      { id: "how-to-use", title: "How to Use This Handbook", badge: "Updated for V2" },
    ],
  },
  {
    part: "I",
    title: "The Frame",
    items: [
      { id: "chapter-1", chapter: "1", title: "The ALP Doctrine — Altitude, Logic, Pressure" },
      { id: "chapter-2", chapter: "2", title: "All Problems Are Entrepreneurial Problems" },
      { id: "chapter-3", chapter: "3", title: "The ALP Scaling Stool" },
    ],
  },
  {
    part: "II",
    title: "The Operating System",
    eyebrow: "New in V2",
    items: [
      { id: "volume-2-intro", title: "Why the Operating System" },
      { id: "chapter-27", chapter: "4", title: "A Contracting Company Cannot Run on the Owner" },
      { id: "chapter-28", chapter: "5", title: "Hierarchy Is Not Accountability" },
      { id: "chapter-29", chapter: "6", title: "The Six Components of a Contracting Operating System" },
      { id: "chapter-30", chapter: "7", title: "Weekly Execution Is Where the Company Is Won" },
      { id: "chapter-31", chapter: "8", title: "Systems Remove Personality from the Business" },
      { id: "chapter-32", chapter: "9", title: "Why AOS Belongs in an Application" },
    ],
  },
  {
    part: "III",
    title: "The Business Systems",
    eyebrow: "Reorganized in V2",
    items: [
      { id: "chapter-4", chapter: "10", title: "Marketing as Infrastructure" },
      { id: "chapter-5", chapter: "11", title: 'Upstream Marketing & Being "In the Know"' },
      { id: "chapter-6", chapter: "12", title: "Sales, Pressure, and Clarity" },
      { id: "chapter-7", chapter: "13", title: "Operations as Margin Protection" },
      { id: "chapter-10", chapter: "14", title: "From Chaos to Control" },
    ],
  },
  {
    part: "IV",
    title: "Time, Money, and Commercial Control",
    eyebrow: "Reorganized in V2",
    items: [
      { id: "chapter-12", chapter: "15", title: "Documentation, Entitlement, and Proof" },
      { id: "chapter-13", chapter: "16", title: "Notices & Playing Offense" },
      { id: "chapter-14", chapter: "17", title: "Scheduling, Start–Stop Work, and the Cost of Disorder" },
      { id: "chapter-8", chapter: "18", title: "General Conditions: From Invisible Cost to Profit Center" },
      { id: "chapter-19", chapter: "19", title: "Change Order Velocity and Monetizing Disruption" },
      { id: "chapter-16", chapter: "20", title: "Financial Command and Financial Authority" },
      { id: "chapter-9", chapter: "21", title: "The ALP Decision Matrix" },
    ],
  },
  {
    part: "V",
    title: "Identity, Leadership, and Scale",
    eyebrow: "Reorganized in V2",
    items: [
      { id: "chapter-23", chapter: "22", title: "Identity, Pressure, and the Entrepreneur's Responsibility" },
      { id: "chapter-26", chapter: "23", title: "Leadership, Standards, and Cultural Enforcement" },
      { id: "chapter-25", chapter: "24", title: "Scaling Without Losing Control" },
    ],
  },
  {
    part: "VI",
    title: "Real-Time Application & Commitment",
    eyebrow: "Reorganized in V2",
    items: [
      { id: "chapter-24", chapter: "25", title: "Using the ALP Handbook in Real Time" },
      { id: "final-chapter", chapter: "26", title: "The ALP Way — Doctrine & Commitment" },
    ],
  },
];

interface TableOfContentsProps {
  onNavigate?: (id: string) => void;
}

const TableOfContents: React.FC<TableOfContentsProps> = ({ onNavigate }) => {
  const handleClick = (id: string) => {
    if (onNavigate) onNavigate(id);
    const element = document.getElementById(id);
    if (element) element.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav className="py-20">
      <Eyebrow className="mb-6">The Index</Eyebrow>
      <h2 className="chapter-heading">Table of Contents</h2>

      <div className="mt-16">
        {tocData.map((section, sectionIndex) => (
          <div key={sectionIndex} className="mb-2">
            {section.part ? (
              <div className="toc-part flex items-baseline gap-3 flex-wrap">
                <span>Part {section.part} — {section.title}</span>
                {section.eyebrow && (
                  <Eyebrow accent bare className="text-[10px]">
                    {section.eyebrow}
                  </Eyebrow>
                )}
              </div>
            ) : (
              <div className="toc-part">{section.title}</div>
            )}

            {section.items.map((item) => (
              <div
                key={item.id}
                className="toc-item flex items-baseline gap-6"
                onClick={() => handleClick(item.id)}
              >
                <span className="font-mono text-xs uppercase tracking-[0.25em] opacity-50 w-10 shrink-0">
                  {item.chapter ?? ""}
                </span>
                <span className="toc-item__title text-xl md:text-2xl flex-1 flex items-baseline gap-3 flex-wrap">
                  <span>{item.title}</span>
                  {item.badge && (
                    <Eyebrow accent bare className="text-[10px]">
                      {item.badge}
                    </Eyebrow>
                  )}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
};

export default TableOfContents;
