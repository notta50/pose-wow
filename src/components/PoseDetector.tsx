import { useEffect, useRef, useState } from 'react';
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import { Loader2 } from 'lucide-react';

// プレイヤー情報の型定義
interface PlayerWowData {
  score: number;
  duration: number; // ポーズ維持時間（フレーム数）
  isActive: boolean;
}

const PoseDetector = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playersRef = useRef<PlayerWowData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [showWow, setShowWow] = useState(false);
  const [showYeah, setShowYeah] = useState(false);
  const [showBoo, setShowBoo] = useState(false);
  const [players, setPlayers] = useState<PlayerWowData[]>([]);
  const [showBattle, setShowBattle] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);

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
          numPoses: 2, // 最大2人まで同時検出
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
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
        
        // DrawingUtilsは1回だけ生成（パフォーマンス最適化）
        const drawer = new DrawingUtils(ctx2d);

        // 各人物の色を定義（ループ外に移動）
        const colors = [
          { landmark: '#FF00FF', connection: '#00FFFF' }, // 1人目: マゼンタとシアン
          { landmark: '#00FF00', connection: '#FFFF00' }, // 2人目: 緑と黄色
          { landmark: '#FF6600', connection: '#00FFFF' }, // 3人目以降
          { landmark: '#6600FF', connection: '#FF00FF' },
        ];

        const detect = () => {
          if (!video || !landmarker || video.readyState < 2) {
            requestAnimationFrame(detect);
            return;
          }

          const ts = performance.now();
          const res = landmarker.detectForVideo(video, ts);

          ctx2d.clearRect(0, 0, canvas.width, canvas.height);
          ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);

          // 複数人のポーズを判定するためのフラグ
          let anyBothHandsRaised = false;
          let anyRightHandRaised = false;
          let anyLeftHandRaised = false;

          // プレイヤー情報を更新
          const newPlayers: PlayerWowData[] = [];

          if (res.landmarks.length > 0) {
            // 各人物のランドマークを処理
            res.landmarks.forEach((lm, personIndex) => {
              const colorSet = colors[personIndex % colors.length];

              // ランドマークを描画
              drawer.drawLandmarks(lm, {
                color: colorSet.landmark,
                lineWidth: 2,
              });
              drawer.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, {
                color: colorSet.connection,
                lineWidth: 3,
              });

              // 各人物のポーズを判定
              const bothHands = checkBothHandsRaised(lm);
              const rightHand = checkRightHandRaised(lm);
              const leftHand = checkLeftHandRaised(lm);

              // いずれかの人物が該当ポーズをしていたらフラグをtrue
              if (bothHands) anyBothHandsRaised = true;
              if (rightHand) anyRightHandRaised = true;
              if (leftHand) anyLeftHandRaised = true;

              // WOWバトル用: 両手を上げている場合のみスコア計算
              if (bothHands) {
                const score = calculateWowScore(lm);
                const prevPlayer = playersRef.current[personIndex];
                
                newPlayers[personIndex] = {
                  score,
                  duration: prevPlayer?.isActive ? prevPlayer.duration + 1 : 1,
                  isActive: true
                };
              } else {
                newPlayers[personIndex] = {
                  score: 0,
                  duration: 0,
                  isActive: false
                };
              }
            });

            // プレイヤー情報を更新（変更があった場合のみ）
            playersRef.current = newPlayers;
            
            // UI更新は10フレームに1回だけ（パフォーマンス最適化）
            if (Math.floor(ts) % 300 < 50) {
              setPlayers([...newPlayers]);
            }

            // バトル判定: 2人以上いて、全員が3秒以上ポーズを維持したら勝負判定
            if (newPlayers.length >= 2) {
              const allActive = newPlayers.every(p => p.isActive && p.duration > 90); // 30fps * 3秒
              
              if (allActive) {
                setShowBattle((prev) => prev !== true ? true : prev);
                // スコアが高い方を勝者に
                const winnerIndex = newPlayers[0].score >= newPlayers[1].score ? 0 : 1;
                setWinner((prev) => prev !== winnerIndex ? winnerIndex : prev);
              } else {
                setShowBattle((prev) => prev !== false ? false : prev);
                setWinner((prev) => prev !== null ? null : prev);
              }
            }
          } else {
            // 誰も検出されていない場合はリセット
            playersRef.current = [];
            setPlayers((prev) => prev.length > 0 ? [] : prev);
            setShowBattle((prev) => prev !== false ? false : prev);
            setWinner((prev) => prev !== null ? null : prev);
          }

          // 優先順位: 両手 > 右手 > 左手
          // 状態が変わる時だけ更新（不要な再レンダリングを防ぐ）
          if (anyBothHandsRaised) {
            setShowWow((prev) => prev !== true ? true : prev);
            setShowYeah((prev) => prev !== false ? false : prev);
            setShowBoo((prev) => prev !== false ? false : prev);
          } else if (anyRightHandRaised) {
            setShowWow((prev) => prev !== false ? false : prev);
            setShowYeah((prev) => prev !== true ? true : prev);
            setShowBoo((prev) => prev !== false ? false : prev);
          } else if (anyLeftHandRaised) {
            setShowWow((prev) => prev !== false ? false : prev);
            setShowYeah((prev) => prev !== false ? false : prev);
            setShowBoo((prev) => prev !== true ? true : prev);
          } else {
            setShowWow((prev) => prev !== false ? false : prev);
            setShowYeah((prev) => prev !== false ? false : prev);
            setShowBoo((prev) => prev !== false ? false : prev);
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

    const checkBothHandsRaised = (landmarks: any[]): boolean => {
      const LEFT_WRIST = 15;
      const RIGHT_WRIST = 16;
      const LEFT_SHOULDER = 11;
      const RIGHT_SHOULDER = 12;
      const NOSE = 0;

      if (!landmarks[LEFT_WRIST] || !landmarks[RIGHT_WRIST] ||
          !landmarks[LEFT_SHOULDER] || !landmarks[RIGHT_SHOULDER] ||
          !landmarks[NOSE]) {
        return false;
      }

      const leftWrist = landmarks[LEFT_WRIST];
      const rightWrist = landmarks[RIGHT_WRIST];
      const leftShoulder = landmarks[LEFT_SHOULDER];
      const rightShoulder = landmarks[RIGHT_SHOULDER];
      const nose = landmarks[NOSE];

      const leftHandRaised = leftWrist.y < leftShoulder.y && leftWrist.y < nose.y + 0.1;
      const rightHandRaised = rightWrist.y < rightShoulder.y && rightWrist.y < nose.y + 0.1;

      return leftHandRaised && rightHandRaised;
    };

    // WOW度を計算する関数
    const calculateWowScore = (landmarks: any[]): number => {
      const NOSE = 0;
      const LEFT_SHOULDER = 11;
      const RIGHT_SHOULDER = 12;
      const LEFT_WRIST = 15;
      const RIGHT_WRIST = 16;
      const LEFT_HIP = 23;
      const RIGHT_HIP = 24;

      if (!landmarks[NOSE] || !landmarks[LEFT_SHOULDER] || !landmarks[RIGHT_SHOULDER] ||
          !landmarks[LEFT_WRIST] || !landmarks[RIGHT_WRIST] ||
          !landmarks[LEFT_HIP] || !landmarks[RIGHT_HIP]) {
        return 0;
      }

      const nose = landmarks[NOSE];
      const leftShoulder = landmarks[LEFT_SHOULDER];
      const rightShoulder = landmarks[RIGHT_SHOULDER];
      const leftWrist = landmarks[LEFT_WRIST];
      const rightWrist = landmarks[RIGHT_WRIST];
      const leftHip = landmarks[LEFT_HIP];
      const rightHip = landmarks[RIGHT_HIP];

      let score = 0;

      // 1. 手の高さスコア (0-40点)
      // 鼻よりどれだけ上に手があるか
      const leftHeight = Math.max(0, nose.y - leftWrist.y);
      const rightHeight = Math.max(0, nose.y - rightWrist.y);
      const heightScore = (leftHeight + rightHeight) * 100;
      score += Math.min(40, heightScore);

      // 2. 対称性スコア (0-30点)
      // 左右の手の高さの差が小さいほど高得点
      const symmetry = 1 - Math.abs(leftHeight - rightHeight) * 2;
      score += Math.max(0, symmetry * 30);

      // 3. 姿勢の安定性スコア (0-30点)
      // 肩と腰の中心が揃っているか
      const shoulderCenter = (leftShoulder.x + rightShoulder.x) / 2;
      const hipCenter = (leftHip.x + rightHip.x) / 2;
      const stability = 1 - Math.abs(shoulderCenter - hipCenter) * 2;
      score += Math.max(0, stability * 30);

      return Math.round(Math.min(100, score));
    };

    const checkRightHandRaised = (landmarks: any[]): boolean => {
      const RIGHT_WRIST = 16;
      const RIGHT_SHOULDER = 12;
      const LEFT_WRIST = 15;
      const LEFT_SHOULDER = 11;
      const NOSE = 0;

      if (!landmarks[RIGHT_WRIST] || !landmarks[RIGHT_SHOULDER] ||
          !landmarks[LEFT_WRIST] || !landmarks[LEFT_SHOULDER] ||
          !landmarks[NOSE]) {
        return false;
      }

      const rightWrist = landmarks[RIGHT_WRIST];
      const rightShoulder = landmarks[RIGHT_SHOULDER];
      const leftWrist = landmarks[LEFT_WRIST];
      const leftShoulder = landmarks[LEFT_SHOULDER];
      const nose = landmarks[NOSE];

      const rightHandRaised = rightWrist.y < rightShoulder.y && rightWrist.y < nose.y + 0.1;
      const leftHandRaised = leftWrist.y < leftShoulder.y && leftWrist.y < nose.y + 0.1;

      // 右手が上がっていて、かつ両手が上がっていない場合
      return rightHandRaised && !leftHandRaised;
    };

    const checkLeftHandRaised = (landmarks: any[]): boolean => {
      const LEFT_WRIST = 15;
      const LEFT_SHOULDER = 11;
      const RIGHT_WRIST = 16;
      const RIGHT_SHOULDER = 12;
      const NOSE = 0;

      if (!landmarks[LEFT_WRIST] || !landmarks[LEFT_SHOULDER] ||
          !landmarks[RIGHT_WRIST] || !landmarks[RIGHT_SHOULDER] ||
          !landmarks[NOSE]) {
        return false;
      }

      const leftWrist = landmarks[LEFT_WRIST];
      const leftShoulder = landmarks[LEFT_SHOULDER];
      const rightWrist = landmarks[RIGHT_WRIST];
      const rightShoulder = landmarks[RIGHT_SHOULDER];
      const nose = landmarks[NOSE];

      const leftHandRaised = leftWrist.y < leftShoulder.y && leftWrist.y < nose.y + 0.1;
      const rightHandRaised = rightWrist.y < rightShoulder.y && rightWrist.y < nose.y + 0.1;

      // 左手が上がっていて、かつ両手が上がっていない場合
      return leftHandRaised && !rightHandRaised;
    };

    init();

    return () => {
      landmarker?.close();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative">
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

      {/* WOWバトル表示 */}
      {showBattle && players.length >= 2 && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-8 shadow-2xl max-w-3xl w-full mx-4">
            <h2 className="text-5xl font-black text-center mb-8 text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600 animate-pulse">
              🎉 WOW BATTLE! 🎉
            </h2>
            
            <div className="grid grid-cols-2 gap-6 mb-8">
              {/* プレイヤー1 */}
              <div className={`text-center p-6 rounded-xl transition-all duration-300 ${winner === 0 ? 'bg-gradient-to-br from-yellow-100 to-yellow-200 border-4 border-yellow-400 scale-105' : 'bg-gray-100'}`}>
                <div className="text-6xl mb-4">👤</div>
                <div className="text-2xl font-bold mb-2" style={{color: '#FF00FF'}}>
                  Player 1
                </div>
                <div className="text-6xl font-black text-purple-600 mb-2">
                  {players[0].score}
                </div>
                <div className="text-sm text-gray-600">WOW度</div>
                {winner === 0 && (
                  <div className="mt-4 text-5xl animate-bounce">🏆</div>
                )}
              </div>
              
              {/* プレイヤー2 */}
              <div className={`text-center p-6 rounded-xl transition-all duration-300 ${winner === 1 ? 'bg-gradient-to-br from-yellow-100 to-yellow-200 border-4 border-yellow-400 scale-105' : 'bg-gray-100'}`}>
                <div className="text-6xl mb-4">👤</div>
                <div className="text-2xl font-bold mb-2" style={{color: '#00FF00'}}>
                  Player 2
                </div>
                <div className="text-6xl font-black text-green-600 mb-2">
                  {players[1].score}
                </div>
                <div className="text-sm text-gray-600">WOW度</div>
                {winner === 1 && (
                  <div className="mt-4 text-5xl animate-bounce">🏆</div>
                )}
              </div>
            </div>
            
            <div className="text-center">
              <div className="text-3xl font-black text-gray-800 mb-3">
                {winner !== null && (
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500">
                    🎊 Player {winner + 1} Wins! 🎊
                  </span>
                )}
              </div>
              <div className="text-sm text-gray-600">
                手を下ろすとリセットされます
              </div>
            </div>
          </div>
        </div>
      )}

      {/* リアルタイムスコア表示（バトル中以外） */}
      {!showBattle && players.length > 0 && (
        <div className="absolute top-4 left-4 right-4 flex justify-between z-40 pointer-events-none">
          {players.map((player, index) => (
            player.isActive && (
              <div key={index} className="bg-white bg-opacity-95 rounded-xl p-4 shadow-lg border-2 border-gray-200">
                <div className="text-sm font-bold mb-1" style={{color: index === 0 ? '#FF00FF' : '#00FF00'}}>
                  Player {index + 1}
                </div>
                <div className="text-4xl font-black text-gray-800">
                  {player.score}
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  {Math.round(player.duration / 30)}秒キープ
                </div>
                {player.duration > 60 && player.duration < 90 && (
                  <div className="text-xs text-orange-600 font-semibold mt-1 animate-pulse">
                    もう少し！
                  </div>
                )}
              </div>
            )
          ))}
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

        {/* 通常のメッセージ表示（バトル中は非表示） */}
        {!showBattle && showWow && (
          <div className="absolute top-8 left-1/2 -translate-x-1/2 animate-bounce">
            <div className="relative">
              <div className="bg-gradient-to-r from-yellow-400 via-orange-400 to-pink-500 text-white text-6xl font-black px-12 py-6 rounded-full shadow-2xl border-4 border-white transform rotate-[-5deg]">
                WOW!
              </div>
              <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[20px] border-l-transparent border-r-[20px] border-r-transparent border-t-[25px] border-t-white"></div>
            </div>
          </div>
        )}

        {!showBattle && showYeah && (
          <div className="absolute top-8 right-8 animate-pulse">
            <div className="relative">
              <div className="bg-gradient-to-r from-green-400 via-blue-400 to-purple-500 text-white text-4xl font-bold px-8 py-4 rounded-full shadow-xl border-3 border-white transform rotate-[5deg]">
                Yeah!
              </div>
              <div className="absolute -bottom-3 left-1/4 w-0 h-0 border-l-[15px] border-l-transparent border-r-[15px] border-r-transparent border-t-[20px] border-t-white"></div>
            </div>
          </div>
        )}

        {!showBattle && showBoo && (
          <div className="absolute top-8 left-8 animate-pulse">
            <div className="relative">
              <div className="bg-gradient-to-r from-red-600 via-rose-500 to-orange-500 text-white text-4xl font-extrabold px-8 py-4 rounded-full shadow-xl border-4 border-white transform rotate-[-3deg]">
                ブー！
              </div>
              <div className="absolute -bottom-3 left-3/4 -translate-x-1/2 w-0 h-0 border-l-[15px] border-l-transparent border-r-[15px] border-r-transparent border-t-[20px] border-t-white"></div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 text-center">
        <p className="text-slate-400 text-sm">
          {showBattle ? (
            <span className="text-yellow-400 font-semibold text-lg animate-pulse">
              🎮 WOWバトル進行中！3秒キープで勝負！ 🎮
            </span>
          ) : showWow ? (
            <span className="text-green-400 font-semibold text-lg">Great pose! Keep it up!</span>
          ) : showYeah ? (
            <span className="text-blue-400 font-semibold text-lg">Right hand raised! Yeah!</span>
          ) : showBoo ? (
            <span className="text-red-400 font-semibold text-lg">左手だけはダメ！ブー！</span>
          ) : (
            <span>
              {players.length >= 2 
                ? "2人で両手を上げてWOWバトル！" 
                : "Raise both hands for 'WOW!', right hand only for 'Yeah!', left hand only shows 'ブー！'"}
            </span>
          )}
        </p>
      </div>
    </div>
  );
};

export default PoseDetector;
