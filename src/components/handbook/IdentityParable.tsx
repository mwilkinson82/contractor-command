import React from 'react';

interface IdentityParableProps {
  id?: string;
  title: string;
  children: React.ReactNode;
}

const IdentityParable: React.FC<IdentityParableProps> = ({ id, title, children }) => {
  return (
    <div id={id} className="identity-parable-container scroll-mt-20">
      <div className="identity-parable-badge">
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          width="20" 
          height="20" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="1.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          className="opacity-80"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        <span>Identity Parable</span>
      </div>
      <h4 className="subsection-heading italic mt-4">{title}</h4>
      <div className="body-text space-y-4">
        {children}
      </div>
    </div>
  );
};

export default IdentityParable;
