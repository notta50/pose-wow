import { useRef, useCallback } from 'react';

interface SoundOptions {
  volume?: number;
  loop?: boolean;
  preload?: boolean;
}

export const useSound = (src: string, options: SoundOptions = {}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { volume = 1, loop = false, preload = true } = options;

  // 音声ファイルを初期化
  const initAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(src);
      audioRef.current.volume = volume;
      audioRef.current.loop = loop;
      if (preload) {
        audioRef.current.preload = 'auto';
      }
    }
  }, [src, volume, loop, preload]);

  // 音声を再生
  const play = useCallback(() => {
    initAudio();
    if (audioRef.current) {
      // 既に再生中の場合は最初から再生
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((error) => {
        console.warn('Audio play failed:', error);
      });
    }
  }, [initAudio]);

  // 音声を停止
  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, []);

  // 音量を設定
  const setVolume = useCallback((newVolume: number) => {
    if (audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, newVolume));
    }
  }, []);

  return {
    play,
    stop,
    setVolume,
  };
};