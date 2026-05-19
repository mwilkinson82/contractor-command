import React, { useState } from 'react';
import { List, X, BookOpen, FileText } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TocItem {
  id: string;
  title: string;
  chapter?: string;
}

interface TocSection {
  part?: string;
  title: string;
  items: TocItem[];
}

interface ParableItem {
  id: string;
  title: string;
  chapter: string;
  isIdentity: boolean;
}

const tocData: TocSection[] = [
  {
    title: 'Front Matter',
    items: [
      { id: 'dedication', title: 'Dedication' },
      { id: 'foreword', title: 'Foreword / Author\'s Note' },
    ],
  },
  {
    part: 'I',
    title: 'The Frame',
    items: [
      { id: 'chapter-1', chapter: '1', title: 'The ALP Doctrine — Altitude, Logic, Pressure' },
      { id: 'chapter-2', chapter: '2', title: 'All Problems Are Entrepreneurial Problems' },
      { id: 'chapter-3', chapter: '3', title: 'The ALP Scaling Stool' },
    ],
  },
  {
    part: 'II',
    title: 'The Stool (Systems)',
    items: [
      { id: 'chapter-4', chapter: '4', title: 'Marketing as Infrastructure' },
      { id: 'chapter-5', chapter: '5', title: 'Upstream Marketing & Being "In the Know"' },
      { id: 'chapter-6', chapter: '6', title: 'Sales, Pressure, and Clarity' },
      { id: 'chapter-7', chapter: '7', title: 'Operations as Margin Protection' },
      { id: 'chapter-8', chapter: '8', title: 'General Conditions & Invisible Costs' },
      { id: 'chapter-9', chapter: '9', title: 'The ALP Decision Matrix' },
      { id: 'chapter-10', chapter: '10', title: 'From Chaos to Control' },
    ],
  },
  {
    part: 'III',
    title: 'Time, Money, & Leverage',
    items: [
      { id: 'chapter-11', chapter: '11', title: 'Operations Is Logistics — Not Labor' },
      { id: 'chapter-12', chapter: '12', title: 'Documentation, Entitlement, and Proof' },
      { id: 'chapter-13', chapter: '13', title: 'Notices & Playing Offense' },
      { id: 'chapter-14', chapter: '14', title: 'Scheduling as Time Control' },
      { id: 'chapter-15', chapter: '15', title: 'Start–Stop Work and Productivity Loss' },
      { id: 'chapter-16', chapter: '16', title: 'Financial Command: Seeing the Business Clearly' },
      { id: 'chapter-17', chapter: '17', title: 'General Conditions Are Not Overhead — They Are a Profit Center' },
      { id: 'chapter-18', chapter: '18', title: 'CPM Schedules, Start–Stop Work, and the Cost of Disorder' },
    ],
  },
  {
    part: 'IV',
    title: 'Identity & Scale',
    items: [
      { id: 'chapter-19', chapter: '19', title: 'Change Order Velocity and Monetizing Disruption' },
      { id: 'chapter-20', chapter: '20', title: 'Notices, Documentation, and Playing Offense' },
      { id: 'chapter-21', chapter: '21', title: 'Financial Authority at Scale' },
      { id: 'chapter-22', chapter: '22', title: 'The Decision Matrix: How Operators Decide Under Pressure' },
      { id: 'chapter-23', chapter: '23', title: 'Identity, Pressure, and the Entrepreneur\'s Responsibility' },
    ],
  },
  {
    part: 'V',
    title: 'Real-Time Application',
    items: [
      { id: 'chapter-24', chapter: '24', title: 'Using the ALP Handbook in Real Time' },
      { id: 'chapter-25', chapter: '25', title: 'Scaling Without Losing Control' },
      { id: 'chapter-26', chapter: '26', title: 'Leadership, Standards, and Cultural Enforcement' },
    ],
  },
  {
    part: 'VI',
    title: 'Commitment',
    items: [
      { id: 'final-chapter', title: 'The ALP Way — Doctrine & Commitment' },
    ],
  },
];

// Parable index data - complete list
const parableData: ParableItem[] = [
  // Regular Parables (in chapter order)
  { id: 'parable-calm-operator', title: 'The Calm Operator', chapter: '1', isIdentity: false },
  { id: 'parable-broken-toolbelt', title: 'The Broken Toolbelt', chapter: '2', isIdentity: false },
  { id: 'parable-uneven-table', title: 'The Uneven Table', chapter: '3', isIdentity: false },
  { id: 'parable-silent-expert', title: 'The Silent Expert', chapter: '4', isIdentity: false },
  { id: 'parable-quiet-recommendation', title: 'The Quiet Recommendation', chapter: '5', isIdentity: false },
  { id: 'parable-indecisive-buyer', title: 'The Indecisive Buyer', chapter: '6', isIdentity: false },
  { id: 'parable-crowded-site', title: 'The Crowded Site', chapter: '7', isIdentity: false },
  { id: 'parable-one-week-extension', title: 'The One-Week Extension', chapter: '8', isIdentity: false },
  { id: 'parable-deferred-call', title: 'The Deferred Call', chapter: '9', isIdentity: false },
  { id: 'parable-noisy-jobsite', title: 'The Noisy Jobsite', chapter: '10', isIdentity: false },
  { id: 'parable-unwritten-delay', title: 'The Unwritten Delay', chapter: '12', isIdentity: false },
  { id: 'parable-polite-contractor', title: 'The Polite Contractor', chapter: '13', isIdentity: false },
  { id: 'parable-flexible-timeline', title: 'The Flexible Timeline', chapter: '14', isIdentity: false },
  { id: 'parable-interrupted-trade', title: 'The Interrupted Trade', chapter: '15', isIdentity: false },
  { id: 'parable-profitable-company-wasnt', title: 'The Profitable Company That Wasn\'t', chapter: '16', isIdentity: false },
  { id: 'parable-job-looked-profitable', title: 'The Job That Looked Profitable', chapter: '17', isIdentity: false },
  { id: 'parable-change-order-died', title: 'The Change Order That Died Quietly', chapter: '19', isIdentity: false },
  { id: 'parable-profitable-company-collapsed', title: 'The Profitable Company That Collapsed', chapter: '21', isIdentity: false },
  { id: 'parable-calm-operator-21', title: 'The Calm Operator', chapter: '21', isIdentity: false },
  { id: 'parable-fork-in-road', title: 'The Fork in the Road', chapter: '22', isIdentity: false },
  { id: 'parable-unmoved-operator', title: 'The Unmoved Operator', chapter: '23', isIdentity: false },
  { id: 'parable-owner-fixed-wrong', title: 'The Owner Who Fixed the Wrong Thing', chapter: '24', isIdentity: false },
  { id: 'parable-clean-decision', title: 'The Clean Decision', chapter: '24', isIdentity: false },
  { id: 'parable-expanding-circle', title: 'The Expanding Circle', chapter: '25', isIdentity: false },
  { id: 'parable-first-exception', title: 'The First Exception', chapter: '26', isIdentity: false },
  // Identity Parables
  { id: 'identity-parable-17', title: 'The Owner Who Had to Be Needed', chapter: '17', isIdentity: true },
  { id: 'identity-parable-18', title: 'The Operator Who Hated Planning', chapter: '18', isIdentity: true },
  { id: 'identity-parable-19', title: 'The Nice Contractor', chapter: '19', isIdentity: true },
  { id: 'identity-parable-20', title: 'The Contractor Afraid of Being Wrong', chapter: '20', isIdentity: true },
  { id: 'identity-parable-21', title: 'The Owner Who Avoided the Numbers', chapter: '21', isIdentity: true },
  { id: 'identity-parable-22', title: 'The Delayer', chapter: '22', isIdentity: true },
];

const FloatingTOC: React.FC = () => {
  const [open, setOpen] = useState(false);

  const handleNavigate = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      setOpen(false);
    }
  };

  const regularParables = parableData.filter(p => !p.isIdentity);
  const identityParables = parableData.filter(p => p.isIdentity);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all flex items-center justify-center hover:scale-105"
          aria-label="Open table of contents"
        >
          <List className="w-6 h-6" />
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:w-[400px] p-0">
        <SheetHeader className="p-6 pb-0">
          <SheetTitle className="text-left" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
            Navigation
          </SheetTitle>
        </SheetHeader>
        
        <Tabs defaultValue="chapters" className="w-full mt-4">
          <TabsList className="w-full px-6">
            <TabsTrigger value="chapters" className="flex-1 gap-2">
              <BookOpen className="w-4 h-4" />
              Chapters
            </TabsTrigger>
            <TabsTrigger value="parables" className="flex-1 gap-2">
              <FileText className="w-4 h-4" />
              Parables
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="chapters" className="mt-0">
            <ScrollArea className="h-[calc(100vh-180px)]">
              <div className="p-6 pt-4">
                {tocData.map((section, sectionIndex) => (
                  <div key={sectionIndex} className="mb-6">
                    {section.part ? (
                      <div className="text-xs uppercase tracking-widest opacity-50 pt-4 pb-2" style={{ fontFamily: 'Inter, sans-serif', letterSpacing: '0.15em' }}>
                        Part {section.part} — {section.title}
                      </div>
                    ) : (
                      <div className="text-xs uppercase tracking-widest opacity-50 pb-2" style={{ fontFamily: 'Inter, sans-serif', letterSpacing: '0.15em' }}>
                        {section.title}
                      </div>
                    )}
                    {section.items.map((item) => (
                      <button
                        key={item.id}
                        className="w-full text-left py-2.5 px-3 hover:bg-accent rounded-md transition-colors flex items-baseline gap-3 group"
                        onClick={() => handleNavigate(item.id)}
                      >
                        {item.chapter && (
                          <span className="text-xs opacity-40 font-medium w-5" style={{ fontFamily: 'Inter, sans-serif' }}>
                            {item.chapter}
                          </span>
                        )}
                        <span className="text-sm leading-tight group-hover:text-foreground" style={{ fontFamily: 'Inter, sans-serif' }}>
                          {item.title}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
          
          <TabsContent value="parables" className="mt-0">
            <ScrollArea className="h-[calc(100vh-180px)]">
              <div className="p-6 pt-4">
                {/* Regular Parables */}
                <div className="mb-8">
                  <div className="text-xs uppercase tracking-widest opacity-50 pb-3" style={{ fontFamily: 'Inter, sans-serif', letterSpacing: '0.15em' }}>
                    Parables
                  </div>
                  {regularParables.map((parable) => (
                    <button
                      key={parable.id}
                      className="w-full text-left py-2.5 px-3 hover:bg-accent rounded-md transition-colors flex items-baseline justify-between group"
                      onClick={() => handleNavigate(parable.id)}
                    >
                      <span className="text-sm leading-tight group-hover:text-foreground italic" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
                        {parable.title}
                      </span>
                      <span className="text-xs opacity-40" style={{ fontFamily: 'Inter, sans-serif' }}>
                        Ch. {parable.chapter}
                      </span>
                    </button>
                  ))}
                </div>
                
                {/* Identity Parables */}
                <div>
                  <div className="text-xs uppercase tracking-widest pb-3 text-brand-accent" style={{ fontFamily: 'Inter, sans-serif', letterSpacing: '0.15em' }}>
                    Identity Parables
                  </div>
                  {identityParables.map((parable) => (
                    <button
                      key={parable.id}
                      className="w-full text-left py-2.5 px-3 hover:bg-identity-parable-bg/50 rounded-md transition-colors flex items-baseline justify-between group border-l-2 border-brand-accent mb-1"
                      onClick={() => handleNavigate(parable.id)}
                    >
                      <span className="text-sm leading-tight group-hover:text-foreground italic" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
                        {parable.title}
                      </span>
                      <span className="text-xs opacity-40" style={{ fontFamily: 'Inter, sans-serif' }}>
                        Ch. {parable.chapter}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};

export default FloatingTOC;
