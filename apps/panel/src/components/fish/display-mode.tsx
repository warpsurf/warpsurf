import React from 'react';

type DisplayModeProps = {
  feedOnClick: boolean;
  setFeedOnClick: (v: boolean) => void;
  previousFeedOnClickRef: React.MutableRefObject<boolean>;
  onBack: () => void;
  onAddFish: () => void;
  onAddShark: () => void;
  onFeed: (amount: number, clientX?: number, clientY?: number) => void;
  onWave: () => void;
  onClear: () => void;
};

const DisplayMode: React.FC<DisplayModeProps> = ({
  feedOnClick,
  setFeedOnClick,
  previousFeedOnClickRef,
  onBack,
  onAddFish,
  onAddShark,
  onFeed,
  onWave,
  onClear,
}) => {
  return (
    <div
      className="absolute inset-0 z-20"
      onClick={(e) => {
        if (!feedOnClick) return;
        const target = e.target as HTMLElement;
        if (!target.closest('button')) {
          onFeed(0, e.clientX, e.clientY);
        }
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/10 via-transparent to-cyan-50/10 pointer-events-none"></div>

      <button
        onClick={() => {
          setFeedOnClick(previousFeedOnClickRef.current);
          onBack();
        }}
        className="absolute top-4 left-4 z-30 pointer-events-auto px-4 py-2 rounded-md bg-gray-700/90 hover:bg-gray-800/90 text-white text-sm font-medium shadow-lg transition-colors"
      >
        ← Back to Chat
      </button>

      <div className="absolute top-4 right-4 z-30 flex gap-2 pointer-events-auto">
        <button onClick={onAddFish} className="px-3 py-1.5 rounded-md bg-blue-500/90 hover:bg-blue-600/90 text-white text-sm font-medium shadow-lg transition-colors">Add Fish</button>
        <button onClick={onAddShark} className="px-3 py-1.5 rounded-md bg-gray-600/90 hover:bg-gray-700/90 text-white text-sm font-medium shadow-lg transition-colors">Add Shark</button>
        <button onClick={() => onFeed(10)} className="px-3 py-1.5 rounded-md bg-amber-500/90 hover:bg-amber-600/90 text-white text-sm font-medium shadow-lg transition-colors">Feed</button>
        <button onClick={onWave} className="px-3 py-1.5 rounded-md bg-cyan-500/90 hover:bg-cyan-600/90 text-white text-sm font-medium shadow-lg transition-colors">Wave</button>
        <button onClick={onClear} className="px-3 py-1.5 rounded-md bg-red-500/90 hover:bg-red-600/90 text-white text-sm font-medium shadow-lg transition-colors">Clear</button>
      </div>

      <div className="absolute bottom-4 left-4 z-30 pointer-events-none">
        <h2 className="text-2xl font-bold text-gray-800">Marine Display</h2>
        <p className="text-sm text-gray-600 mt-1">Click anywhere to drop food</p>
      </div>
    </div>
  );
};

export default DisplayMode;


