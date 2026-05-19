import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { X, ZoomIn } from 'lucide-react';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';

interface ExpandableImageProps {
  src: string;
  alt: string;
  className?: string;
}

const ExpandableImage: React.FC<ExpandableImageProps> = ({ src, alt, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="relative group cursor-zoom-in w-full block"
        aria-label={`Expand image: ${alt}`}
      >
        <img 
          src={src} 
          alt={alt} 
          className={className}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200 rounded-lg flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-background/90 backdrop-blur-sm rounded-full p-3 shadow-lg">
            <ZoomIn className="w-5 h-5 text-foreground" />
          </div>
        </div>
      </button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto h-auto p-0 bg-transparent border-none shadow-none">
          <VisuallyHidden>
            <DialogTitle>{alt}</DialogTitle>
          </VisuallyHidden>
          <button
            onClick={() => setIsOpen(false)}
            className="absolute top-4 right-4 z-50 bg-background/90 backdrop-blur-sm rounded-full p-2 shadow-lg hover:bg-background transition-colors"
            aria-label="Close expanded image"
          >
            <X className="w-5 h-5 text-foreground" />
          </button>
          <img 
            src={src} 
            alt={alt} 
            className="max-w-full max-h-[90vh] w-auto h-auto object-contain rounded-lg shadow-2xl"
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ExpandableImage;
