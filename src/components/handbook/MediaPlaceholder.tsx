import React from 'react';

interface MediaPlaceholderProps {
  type: 'audio' | 'video' | 'diagram';
  label?: string;
}

const MediaPlaceholder: React.FC<MediaPlaceholderProps> = ({ type, label }) => {
  const typeLabels = {
    audio: 'Audio Commentary',
    video: 'Video Teaching',
    diagram: 'Diagram / Visual Reference',
  };

  return (
    <div className="media-placeholder">
      <span className="media-placeholder-text">
        {label || typeLabels[type]} (to be added)
      </span>
    </div>
  );
};

export default MediaPlaceholder;
