import React from 'react';

interface LaserEffectProps {
  startX: number;
  startY: number;
  isActive: boolean;
}

export const LaserEffect: React.FC<LaserEffectProps> = ({ startX, startY, isActive }) => {
  if (!isActive) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* メイン光線 */}
      <div
        className="absolute bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 animate-pulse laser-beam"
        style={{
          left: `${startX}px`,
          top: `${startY}px`,
          width: '600px',
          height: '6px',
          transform: 'rotate(-30deg) translateX(0)',
          transformOrigin: 'left center',
          boxShadow: '0 0 20px rgba(139, 69, 255, 0.8), 0 0 40px rgba(139, 69, 255, 0.6), 0 0 60px rgba(139, 69, 255, 0.4)',
          borderRadius: '3px',
        }}
      />
      
      {/* 光の粒子エフェクト */}
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="absolute w-2 h-2 bg-white rounded-full animate-ping"
          style={{
            left: `${startX + i * 60 + Math.random() * 30}px`,
            top: `${startY - 15 + Math.random() * 30}px`,
            animationDelay: `${i * 0.05}s`,
            animationDuration: '0.8s',
            boxShadow: '0 0 10px rgba(255, 255, 255, 0.8)',
          }}
        />
      ))}
      
      {/* 発射点の強い光 */}
      <div
        className="absolute w-12 h-12 bg-white rounded-full opacity-90 pulse-origin"
        style={{
          left: `${startX - 24}px`,
          top: `${startY - 24}px`,
          boxShadow: '0 0 30px rgba(255, 255, 255, 0.9), 0 0 60px rgba(139, 69, 255, 0.7)',
        }}
      />

      {/* 光線のオーラ */}
      <div
        className="absolute bg-gradient-to-r from-transparent via-purple-300 to-transparent opacity-50 laser-aura"
        style={{
          left: `${startX}px`,
          top: `${startY - 4}px`,
          width: '600px',
          height: '14px',
          transform: 'rotate(-30deg) translateX(0)',
          transformOrigin: 'left center',
          borderRadius: '7px',
          filter: 'blur(4px)',
        }}
      />

      {/* エネルギー波 */}
      {[...Array(3)].map((_, i) => (
        <div
          key={`wave-${i}`}
          className="absolute border-2 border-purple-400 rounded-full energy-wave"
          style={{
            left: `${startX - 20 - i * 10}px`,
            top: `${startY - 20 - i * 10}px`,
            width: `${40 + i * 20}px`,
            height: `${40 + i * 20}px`,
            animationDelay: `${i * 0.1}s`,
            animationDuration: '0.6s',
            opacity: 0.6 - i * 0.2,
          }}
        />
      ))}
    </div>
  );
};