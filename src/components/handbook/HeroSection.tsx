import React from 'react';
import bookCover from '@/assets/handbook/book-cover.png';
import ExpandableImage from './ExpandableImage';

const HeroSection: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 pt-8 pb-16">
      <ExpandableImage 
        src={bookCover} 
        alt="The ALP Handbook - To Operating a Top-Tier Contracting Company by Marshall Wilkinson" 
        className="max-w-[220px] md:max-w-[280px] lg:max-w-xs w-full h-auto shadow-2xl rounded-sm"
      />
      
      {/* Scroll indicator */}
      <div className="mt-16 animate-bounce opacity-30">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
};

export default HeroSection;
