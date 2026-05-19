import React from 'react';
import bookCover from '@/assets/book-cover.png';
import ExpandableImage from './ExpandableImage';

const HeroSection: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-8 py-16">
      <ExpandableImage 
        src={bookCover} 
        alt="The ALP Handbook - To Operating a Top-Tier Contracting Company by Marshall Wilkinson" 
        className="max-w-sm md:max-w-md lg:max-w-lg w-full h-auto shadow-2xl rounded-sm"
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
