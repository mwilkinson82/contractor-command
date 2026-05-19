import React from 'react';

interface ParableProps {
  id?: string;
  title: string;
  children: React.ReactNode;
}

const Parable: React.FC<ParableProps> = ({ id, title, children }) => {
  return (
    <div id={id} className="parable-container scroll-mt-20">
      <div className="parable-label">Parable</div>
      <h4 className="subsection-heading italic">{title}</h4>
      <div className="body-text space-y-4">
        {children}
      </div>
    </div>
  );
};

export default Parable;
