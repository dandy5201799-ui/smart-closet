import React from 'react';

export const ScannerEffect: React.FC = () => {
  return (
    <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden rounded-xl">
      <div className="absolute inset-0 bg-brand-500/10"></div>
      <div className="absolute left-0 right-0 h-1 bg-brand-400 shadow-[0_0_15px_3px_rgba(217,70,239,0.5)] animate-scan"></div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-black/60 text-white px-6 py-3 rounded-full backdrop-blur-md text-sm font-bold border border-white/20 animate-pulse">
          AI 视觉标签识别中...
        </div>
      </div>
    </div>
  );
};