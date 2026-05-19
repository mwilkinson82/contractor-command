import React from 'react';

interface PartHeaderProps {
  number: string;
  title: string;
}

const PartHeader: React.FC<PartHeaderProps> = ({ number, title }) => {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center text-center py-32">
      <div className="text-sm uppercase tracking-widest opacity-50 mb-6 font-sans" style={{ letterSpacing: '0.25em' }}>
        Part {number}
      </div>
      <h1 className="text-4xl md:text-6xl lg:text-7xl font-semibold tracking-tight font-serif">
        {title}
      </h1>
      <div className="part-divider mt-16" />
    </div>
  );
};

export default PartHeader;
