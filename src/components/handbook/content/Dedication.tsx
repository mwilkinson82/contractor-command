import React from 'react';
import AudioPlayer from '../AudioPlayer';
import Eyebrow from '@/components/editorial/Eyebrow';
import dedicationAudio from '@/assets/audio/dedication.mp3';

const Dedication: React.FC = () => {
  return (
    <div id="dedication" className="py-24 border-t border-chapter-divider text-center">
      <div className="flex justify-center mb-6">
        <Eyebrow>Front Matter</Eyebrow>
      </div>
      <h2 className="chapter-heading text-center mb-12">Dedication</h2>
      <div className="flex justify-center mb-16">
        <AudioPlayer src={dedicationAudio} title="Listen to the Dedication" />
      </div>
      <div className="body-text space-y-8 max-w-3xl mx-auto text-center italic font-serif text-xl md:text-2xl leading-relaxed">

        <p>
          This work is dedicated to the men who shaped my understanding of this business — and the responsibility that comes with it.
        </p>
        <p>
          To my best friend and mentor, my father, <strong className="font-medium not-italic">Robert Wilkinson</strong>, who taught me this craft long before I understood it, and who inculcated the traits and disciplines of success at the table, on the job, and in life — beginning in the high chair.
        </p>
        <p>
          To <strong className="font-medium not-italic">Pietro Palmari</strong>, who gave me opportunity and responsibility in the biggest game in the world, and who stood behind me even when I was wrong — teaching me what real backing and real leadership look like.
        </p>
        <p>
          To <strong className="font-medium not-italic">Ian Street</strong> and <strong className="font-medium not-italic">Tom Sinacore</strong>, whose exposure to the legal and contractual realities of this business fundamentally changed my trajectory and sharpened my understanding of consequence, leverage, and precision.
        </p>
        <p>
          And to <strong className="font-medium not-italic">Nick, Keith, and Kurt Feldmann</strong>, whose trust, guidance, and daily standards in the biggest game in the world forged the concepts and disciplines I practice today — concepts that have since helped hundreds of serious-minded contractors reach their potential.
        </p>
        <p className="pt-8 not-italic opacity-70">
          This work carries your influence on every page.
        </p>
      </div>
    </div>
  );
};

export default Dedication;
