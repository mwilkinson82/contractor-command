import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

interface ReadingHeaderProps {
  currentChapter?: string;
}

const ReadingHeader: React.FC<ReadingHeaderProps> = ({ currentChapter }) => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check for saved preference or system preference
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (saved === 'dark' || (!saved && prefersDark)) {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = () => {
    setIsDark(!isDark);
    if (isDark) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="max-w-4xl mx-auto px-6 md:px-12 h-14 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium tracking-wide uppercase opacity-60" style={{ fontFamily: 'Inter, sans-serif', letterSpacing: '0.1em' }}>
            The ALP Handbook
          </span>
          {currentChapter && (
            <>
              <span className="opacity-30">|</span>
              <span className="text-sm opacity-50" style={{ fontFamily: 'Inter, sans-serif' }}>
                {currentChapter}
              </span>
            </>
          )}
        </div>
        
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md hover:bg-accent transition-colors"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? (
            <Sun className="w-5 h-5 opacity-70" />
          ) : (
            <Moon className="w-5 h-5 opacity-70" />
          )}
        </button>
      </div>
    </header>
  );
};

export default ReadingHeader;
