import { useEffect, useRef, useState } from 'react';
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import { Loader2 } from 'lucide-react';
import { LaserEffect } from './LaserEffect';
import { soundGenerator } from '../utils/audioUtils';

const PoseDetector = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [rightHandRaised, setRightHandRaised] = useState(false);
  const [laserPosition, setLaserPosition] = useState({ x: 0, y: 0 });
  const previousRightHandRaised = useRef(false);

  useEffect(() => {
    let landmarker: PoseLandmarker | undefined;
    let stream: MediaStream | undefined;

    const init = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
        );

        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });

        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (!videoRef.current) return;

        const video = videoRef.current;
        video.srcObject = stream;

        await new Promise<void>((resolve) => {
          video.onloadedmetadata = () => {
            video.play().then(() => {
              resolve();
            }).catch((err) => {
              console.error('Play error:', err);
            });
          };
        });

        setIsLoading(false);

        const canvas = canvasRef.current!;
        const ctx2d = canvas.getContext('2d')!;
        const drawer = new DrawingUtils(ctx2d);

        const detect = () => {
          if (!video || !landmarker || video.readyState < 2) {
            requestAnimationFrame(detect);
            return;
          }

          const ts = performance.now();
          const res = landmarker.detectForVideo(video, ts);

          ctx2d.clearRect(0, 0, canvas.width, canvas.height);
          ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);

          if (res.landmarks.length) {
            const lm = res.landmarks[0];

            drawer.drawLandmarks(lm, {
              color: '#FF00FF',
              lineWidth: 2,
            });
            drawer.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, {
              color: '#00FFFF',
              lineWidth: 3,
            });

            // 右手を突き上げた場合の光線エフェクト
            const rightHandUp = checkRightHandRaised(lm);
            
            // 新しく光線が発射された時のみ効果音を再生
            if (rightHandUp && !previousRightHandRaised.current) {
              soundGenerator.playLaserSound().catch(console.warn);
            }
            
            previousRightHandRaised.current = rightHandUp;
            setRightHandRaised(rightHandUp);

            // 右手中指の位置を推定（画面座標に変換）
            if (rightHandUp && lm[16] && lm[14] && lm[12]) {
              const rightWrist = lm[16];
              const rightElbow = lm[14];
              const rightShoulder = lm[12];
              
              // 手首から肘への方向ベクトルを計算
              const wristToElbowX = rightWrist.x - rightElbow.x;
              const wristToElbowY = rightWrist.y - rightElbow.y;
              
              // 肘から肩への方向も考慮してより正確な腕の向きを計算
              const elbowToShoulderX = rightElbow.x - rightShoulder.x;
              const elbowToShoulderY = rightElbow.y - rightShoulder.y;
              
              // 平均的な腕の方向を計算
              const avgDirectionX = (wristToElbowX + elbowToShoulderX) * 0.5;
              const avgDirectionY = (wristToElbowY + elbowToShoulderY) * 0.5;
              
              // 手首から指先方向に延長して中指の位置を推定（より長めに延長）
              const fingerTipX = (rightWrist.x + avgDirectionX * 0.4) * canvas.width;
              const fingerTipY = (rightWrist.y + avgDirectionY * 0.4) * canvas.height;
              
              setLaserPosition({
                x: fingerTipX,
                y: fingerTipY
              });
            }
          }

          requestAnimationFrame(detect);
        };
        detect();
      } catch (err) {
        console.error('Error initializing pose detection:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(`Failed to initialize: ${errorMessage}`);
        setIsLoading(false);
      }
    };

    const checkRightHandRaised = (landmarks: any[]): boolean => {
      const RIGHT_WRIST = 16;
      const RIGHT_SHOULDER = 12;
      const NOSE = 0;

      if (!landmarks[RIGHT_WRIST] || !landmarks[RIGHT_SHOULDER] || !landmarks[NOSE]) {
        return false;
      }

      const rightWrist = landmarks[RIGHT_WRIST];
      const rightShoulder = landmarks[RIGHT_SHOULDER];
      const nose = landmarks[NOSE];

      // 右手首が右肩より上で、鼻の位置より少し上にある（より厳密な条件）
      return rightWrist.y < rightShoulder.y && rightWrist.y < nose.y - 0.05;
    };

    init();

    return () => {
      landmarker?.close();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // AudioContextの初期化（ブラウザのautoplay制限対策）
  const handleUserInteraction = () => {
    soundGenerator.playBeepSound().catch(() => {
      // 初期化のためのサイレント再生（エラーは無視）
    });
  };

  return (
    <div className="relative" onClick={handleUserInteraction}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-800/50 rounded-2xl backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
            <p className="text-white text-lg">Loading pose detector...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 mb-4 max-w-2xl">
          <p className="text-red-300 text-sm break-words">{error}</p>
          <p className="text-red-400 text-xs mt-3">
            Possible causes: Camera permission denied, not using HTTPS, or network error. Check browser console for details.
          </p>
        </div>
      )}

      <div className="relative rounded-2xl overflow-hidden shadow-2xl border-4 border-slate-700">
        <video
          ref={videoRef}
          width={640}
          height={480}
          autoPlay
          playsInline
          muted
          style={{ display: 'none' }}
        />
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          className="max-w-full h-auto"
          style={{ transform: 'scaleX(-1)' }}
        />

        {/* 光線エフェクト */}
        <LaserEffect 
          startX={laserPosition.x}
          startY={laserPosition.y}
          isActive={rightHandRaised}
        />
      </div>

      <div className="mt-6 text-center">
        <p className="text-slate-400 text-sm">
          {rightHandRaised ? (
            <span className="text-purple-400 font-semibold text-lg">✨🔊 Laser beam activated! 🔊✨</span>
          ) : (
            <span>Raise your right hand high to activate the laser beam!</span>
          )}
        </p>
        <p className="text-slate-500 text-xs mt-2">
          💡 Click anywhere on the screen to enable sound effects
        </p>
      </div>
    </div>
  );
};

export default PoseDetector;
