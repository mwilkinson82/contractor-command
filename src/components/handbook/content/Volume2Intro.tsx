import React from 'react';
import Eyebrow from '@/components/editorial/Eyebrow';

const Volume2Intro: React.FC = () => {
  return (
    <div id="volume-2-intro" className="py-24 border-t border-chapter-divider">
      <header className="mb-16 pt-8">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-6">
          <Eyebrow accent bare>New in V2</Eyebrow>
          <Eyebrow bare>Foreword</Eyebrow>
        </div>
        <h2 className="chapter-heading">Why the Operating System</h2>
      </header>

      <div className="body-text space-y-6 max-w-3xl">
        <p>
          You have the frame. You understand that contracting problems are entrepreneurial problems. You have seen the scaling stool and where it bears weight.
        </p>
        <p>
          Now the question is structural: how does the company actually run?
        </p>
        <p>
          The owner cannot keep running it on memory, personality, hierarchy, and emergency response. The company needs a system. It needs rules. It needs roles. It needs numbers. It needs a weekly execution rhythm. It needs one place where all of that lives.
        </p>
        <p>
          The chapters in this volume describe that operating system. Not as theory. As the structure a contracting company needs before the business systems in the rest of the handbook can hold weight.
        </p>
        <p className="body-text-emphasis">
          Read this volume first. The rest of the book sits on top of it.
        </p>
      </div>
    </div>
  );
};

export default Volume2Intro;

