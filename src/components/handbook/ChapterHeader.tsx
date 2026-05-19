import React from 'react';

interface ChapterHeaderProps {
  number?: number | string;
  title: string;
  subtitle?: string;
}

const ChapterHeader: React.FC<ChapterHeaderProps> = ({ number, title, subtitle }) => {
  return (
    <header className="mb-16 pt-8">
      {number && (
        <div className="text-sm uppercase tracking-widest opacity-50 mb-4 font-sans" style={{ letterSpacing: '0.2em' }}>
          Chapter {number}
        </div>
      )}
      <h2 className="chapter-heading">{title}</h2>
      {subtitle && (
        <p className="text-xl md:text-2xl opacity-70 font-light font-sans mt-4">{subtitle}</p>
      )}
    </header>
  );
};

export default ChapterHeader;
