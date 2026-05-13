import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  Delegate,
  PoseDetectionOnImage,
  RunningMode,
  type DetectionError,
  type Landmark as MpLandmark,
  type MediaPipeSolution,
  type PoseDetectionResultBundle,
  usePoseDetection,
} from 'react-native-mediapipe-posedetection';

import { AnalysisEngine } from './engine';
import { AnalysisState, SH, type FrameRecord } from './state';
import { SquatTracker } from './tracker';
import type { Landmark } from './types';

const MODEL_FILE = 'pose_landmarker_lite.task';

/* ───────────────────────────────────────────────────────────
 * 라이브 카메라 frame processor 결과를 분석 파이프라인에 연결.
 *
 * usePoseDetection 의 onResults 콜백은 JS thread에서 호출되므로 Zustand
 *   직접 접근 OK. frame processor 자체는 worklets에서 돌고, 결과만
 *   reactiveCallbacks 통해 JS로 dispatch되는 표준 패턴.
 *
 * 호출자가 isAnalyzing=true 로 켜야 frame이 history에 누적됨.
 *   (카메라 미리보기 단계에서는 isAnalyzing=false → 결과 무시)
 * ─────────────────────────────────────────────────────────── */
export function useLivePoseAnalysis(opts: {
  isAnalyzing: boolean;
  onProgress?: (frameCount: number, repCount: number) => void;
}): MediaPipeSolution & { resetSession: () => void; flushFrames: () => void } {
  const { isAnalyzing, onProgress } = opts;
  const isAnalyzingRef = useRef(isAnalyzing);
  isAnalyzingRef.current = isAnalyzing;

  const startTimeRef = useRef<number | null>(null);
  const frameCountRef = useRef(0);
  // QC fix: frameHistory를 매 frame store에 spread 누적하지 않고 ref에 push.
  //   기존 [...store.realtime.frameHistory, frame] 패턴은 O(N²) 메모리 + setState 부하 → 라이브 OOM 유발.
  //   pose-video.ts와 동일하게 ref에 누적 → finalize 시점에 store push (flushFrames).
  //   landmarks 필드는 buildSummary가 안 쓰므로 제외 → 메모리 ~2/3 절감.
  const collectedFramesRef = useRef<FrameRecord[]>([]);
  // QC fix: AppState 백그라운드 시 timer drift → 가짜 rep 방지. background 진입 시 ref들 리셋.
  const lastFrameTimeRef = useRef<number>(0);

  const onResults = useCallback(
    (bundle: PoseDetectionResultBundle) => {
      if (!isAnalyzingRef.current) return;
      const poses = bundle.results?.[0]?.landmarks;
      if (!poses || poses.length === 0) return;
      const lms = poses[0] as MpLandmark[];
      if (lms.length < 33) return;

      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
        frameCountRef.current = 0;
        collectedFramesRef.current = [];
        SquatTracker.reset();
        if (__DEV__) {
          const sample = lms[23];
          console.log(
            '[pose-live] first frame — vis(L_HIP):',
            sample?.visibility,
            'x:',
            sample?.x?.toFixed(3),
            'y:',
            sample?.y?.toFixed(3),
          );
        }
      }
      const nowMs = Date.now();
      // QC fix: 5초 이상 frame이 안 들어오면 백그라운드 후 복귀로 간주 → 세션 리셋
      if (lastFrameTimeRef.current > 0 && nowMs - lastFrameTimeRef.current > 5000) {
        startTimeRef.current = nowMs;
        frameCountRef.current = 0;
        collectedFramesRef.current = [];
        SquatTracker.reset();
        if (__DEV__) console.log('[pose-live] long gap detected → session reset');
      }
      lastFrameTimeRef.current = nowMs;
      const timeMs = nowMs - startTimeRef.current;
      frameCountRef.current += 1;

      // MediaPipe Landmark shape == 우리 Landmark (x/y/z/visibility 동일).
      // AppConfig.LM 인덱스(0-32)도 MediaPipe Pose 33-landmark과 동일.
      const lmArray: Landmark[] = lms.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: p.visibility,
        presence: p.presence,
      }));

      // 운동별 시점에 맞는 calcAngles
      const angles = AnalysisEngine.calcAngles(lmArray);

      // QC fix: frameHistory는 ref에만 push (mutate) — buildSummary가 안 쓰는 landmarks 필드 제외
      const frame: FrameRecord = { timeMs, angles };
      collectedFramesRef.current.push(frame);

      // realtime 가벼운 표시만 갱신 — frameHistory는 finalize 시점에 한 번에 push
      SH.setRealtime({
        currentLandmarks: lmArray,
        currentAngles: angles,
        frameCount: frameCountRef.current,
        lastPoseMs: timeMs,
        isPoseReady: true,
      });

      // SquatTracker (OHS 운동에서만 내부 분기)
      SquatTracker.update(lmArray, angles, timeMs);

      if (__DEV__ && frameCountRef.current % 5 === 0) {
        console.log(
          `[pose-live] f${frameCountRef.current} L_knee:${angles.leftKnee} R_knee:${angles.rightKnee} phase:${AnalysisState.squatTracker.phase} rep:${AnalysisState.squatTracker.repIndex}`,
        );
      }

      if (onProgress) {
        onProgress(frameCountRef.current, AnalysisState.squatTracker.repIndex);
      }
    },
    [onProgress],
  );

  const onError = useCallback((err: DetectionError) => {
    if (__DEV__) console.warn('[pose-live] error:', err?.code, err?.message);
  }, []);

  const solution = usePoseDetection(
    { onResults, onError },
    RunningMode.LIVE_STREAM,
    MODEL_FILE,
    {
      numPoses: 1,
      minPoseDetectionConfidence: 0.55,
      minPosePresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
      delegate: Delegate.GPU,
      mirrorMode: 'mirror-front-only',
      shouldOutputSegmentationMasks: false,
    },
  );

  const resetSession = useCallback(() => {
    startTimeRef.current = null;
    frameCountRef.current = 0;
    lastFrameTimeRef.current = 0;
    collectedFramesRef.current = [];
    SH.resetRealtime();
    SH.resetResult();
    SquatTracker.reset();
  }, []);

  // QC fix: finalize 호출 전에 collectedFramesRef.current를 store frameHistory에 push.
  //   engine.buildSummary는 AnalysisState.realtime.frameHistory를 reads.
  const flushFrames = useCallback(() => {
    SH.setRealtime({ frameHistory: [...collectedFramesRef.current] });
  }, []);

  // QC fix: AppState background 시 시간 drift 가드 — 다음 active 복귀 frame이 자동 5초 gap 감지로 리셋되도록.
  //   그리고 background 진입 즉시 lastFrameTime을 일부러 멀리 reset (5초 이상 gap 강제 트리거).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        // 의도적으로 0으로 두지 않음 (0은 첫 frame 의미) — 작은 음수로 두어 복귀 시 5초 gap 트리거
        lastFrameTimeRef.current = Date.now() - 10000;
      }
    });
    return () => sub.remove();
  }, []);

  return { ...solution, resetSession, flushFrames };
}

/* ───────────────────────────────────────────────────────────
 * 정적 자세 분석 — 사진 1장 → MediaPipe Pose → CVA / shoulder tilt /
 *   pelvis tilt / round shoulder 측정.
 *
 * config.ts [R5] CVA = Tragus(귀) → C7(어깨중점 근사) 라인과 horizontal angle.
 *   정면 사진에서는 z 좌표 활용해 sagittal plane 추정.
 * ─────────────────────────────────────────────────────────── */
export async function analyzeStaticPose(imageUri: string): Promise<{
  landmarks: Landmark[] | null;
  shoulderTilt: number;
  pelvisTilt: number;
  cva: number | null;
  fhpDeviation: number | null;
  roundShoulderAngle: number | null;
}> {
  const result = await PoseDetectionOnImage(imageUri, MODEL_FILE, {
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    delegate: Delegate.GPU,
  });

  const lms = result.results?.[0]?.landmarks?.[0];
  if (!lms || lms.length < 33) {
    return {
      landmarks: null,
      shoulderTilt: 0,
      pelvisTilt: 0,
      cva: null,
      fhpDeviation: null,
      roundShoulderAngle: null,
    };
  }

  const lmArray: Landmark[] = (lms as MpLandmark[]).map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    visibility: p.visibility,
    presence: p.presence,
  }));

  // L/R 어깨 (11/12), L/R 골반 (23/24), L/R 귀 (7/8)
  const ls = lmArray[11];
  const rs = lmArray[12];
  const lh = lmArray[23];
  const rh = lmArray[24];
  const le = lmArray[7];
  const re = lmArray[8];

  // 좌우 어깨 기울기 (수평선 대비). L이 R보다 위면 음수, 아래면 양수
  // y 좌표는 위→아래로 0→1 증가 (image 좌표계)
  const shoulderDy = ls.y - rs.y;
  const shoulderDx = rs.x - ls.x;
  const shoulderTilt = (Math.atan2(shoulderDy, Math.abs(shoulderDx)) * 180) / Math.PI;

  // 좌우 골반 기울기
  const pelvisDy = lh.y - rh.y;
  const pelvisDx = rh.x - lh.x;
  const pelvisTilt = (Math.atan2(pelvisDy, Math.abs(pelvisDx)) * 180) / Math.PI;

  // CVA 근사 — 정면 사진에서는 sagittal CVA 직접 측정 어려움.
  //   sagittal 측면 사진이면 ear-shoulder horizontal 각도로 측정.
  //   정면 사진에서는 ear-shoulder z 변위(깊이) 활용 — 귀가 어깨보다 z(depth) 음수면 전방 이동.
  const earMid = { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2, z: (le.z + re.z) / 2 };
  const shoulderMid = {
    x: (ls.x + rs.x) / 2,
    y: (ls.y + rs.y) / 2,
    z: (ls.z + rs.z) / 2,
  };
  // 귀가 어깨보다 z가 작으면(앞) FHP. z 차이를 어깨너비로 정규화 → 각도화
  const shoulderWidth = Math.abs(rs.x - ls.x) || 0.1;
  const earForwardZ = shoulderMid.z - earMid.z; // 양수 = 귀가 앞
  // 어깨너비 대비 z 변위 ratio → 각도 추정 (양수 = FHP)
  // 정상 CVA ≥ 50° 일 때 z 변위 작음. ratio = 0.3 정도 = CVA ~50°
  // 단순 비례 매핑: ratio 0 → deviation 0°, ratio 0.5 → deviation 40°
  const ratio = earForwardZ / shoulderWidth;
  const fhpDeviation = ratio > 0 ? Math.min(60, Math.round(ratio * 80)) : 0;
  const cva = ratio > 0 ? Math.max(30, Math.round(90 - fhpDeviation)) : 90;

  // 라운드숄더 — 정면 사진에서는 어깨가 hip line보다 앞에 있는지 z로 측정
  //   양수 = 어깨가 앞 = round
  const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: (lh.z + rh.z) / 2 };
  const shoulderForwardZ = hipMid.z - shoulderMid.z;
  const torsoLength = Math.abs(hipMid.y - shoulderMid.y) || 0.1;
  const rsRatio = shoulderForwardZ / torsoLength;
  // 어깨가 hip 라인 위에 정렬 → 약 180°. ratio 0.3 → 약 160° (round 시작)
  const roundShoulderAngle = Math.max(140, Math.round(180 - rsRatio * 80));

  return {
    landmarks: lmArray,
    shoulderTilt: Number(shoulderTilt.toFixed(1)),
    pelvisTilt: Number(pelvisTilt.toFixed(1)),
    cva: Number.isFinite(cva) ? cva : null,
    fhpDeviation: Number.isFinite(fhpDeviation) ? fhpDeviation : null,
    roundShoulderAngle: Number.isFinite(roundShoulderAngle) ? roundShoulderAngle : null,
  };
}

export { MODEL_FILE };
