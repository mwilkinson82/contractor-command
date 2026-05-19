import React from 'react';

interface DoctrineListProps {
  items: string[];
}

const DoctrineList: React.FC<DoctrineListProps> = ({ items }) => {
  return (
    <ul className="list-doctrine">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
};

export default DoctrineList;
