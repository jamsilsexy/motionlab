import * as VideoThumbnails from 'expo-video-thumbnails';
import {
  Delegate,
  PoseDetectionOnImage,
  type Landmark as MpLandmark,
} from 'react-native-mediapipe-posedetection';

import { AnalysisEngine } from './engine';
import { SH, useAnalysisStore, type FrameRecord } from './state';
import { SquatTracker } from './tracker';
import type { Landmark } from './types';

const MODEL_FILE = 'pose_landmarker_lite.task';
// 영상 분석 frame 추출 간격. 0.2s = 5fps.
//   OHS 5 reps 평균 12-15초 영상 → 60-75 frame 추출 (분석 충분, 추출 시간 합리적).
//   너무 잘게 (0.1s)면 thumbnail 생성 시간이 분석 시간을 압도.
const FRAME_INTERVAL_MS = 200;
// 1 frame 추출 + 분석 평균 200-400ms (저사양 폰 기준). 30초 영상 = 약 30-60s 처리 시간.
const MIN_VIDEO_DURATION_MS = 3000;
const MAX_VIDEO_DURATION_MS = 30000;

export interface VideoAnalyzeProgress {
  phase: 'extracting' | 'detecting' | 'finalizing' | 'done' | 'error';
  current: number;
  total: number;
  message?: string;
}

/* ───────────────────────────────────────────────────────────
 * 갤러리 영상 파일 → 일정 간격 frame 추출 → 각 frame Pose 검출 →
 *   AnalysisEngine.calcAngles → frameHistory 누적 + SquatTracker.update
 *   → AnalysisEngine.finalizeResult.
 *
 * 호출 측은 onProgress 콜백으로 진행도 받음.
 *
 * 라이브 카메라(useLivePoseAnalysis)와 결과 동일 형식이라 finalize 후
 *   동일하게 saveCurrentResult → advanceQueue 흐름 사용 가능.
 * ─────────────────────────────────────────────────────────── */
export async function analyzeVideoFile(opts: {
  videoUri: string;
  videoDurationMs: number;
  onProgress?: (p: VideoAnalyzeProgress) => void;
  signal?: AbortSignal;
}): Promise<{ ok: true; frameCount: number } | { ok: false; error: string }> {
  const { videoUri, videoDurationMs, onProgress, signal } = opts;

  if (videoDurationMs < MIN_VIDEO_DURATION_MS) {
    return { ok: false, error: '영상이 너무 짧습니다 (최소 3초 필요)' };
  }
  const effectiveDuration = Math.min(videoDurationMs, MAX_VIDEO_DURATION_MS);
  const totalFrames = Math.floor(effectiveDuration / FRAME_INTERVAL_MS);

  // store 리셋 (라이브 분석과 동일 시작점)
  SH.resetRealtime();
  SH.resetResult();
  SquatTracker.reset();

  let firstVisibilityLogged = false;
  let processed = 0;

  for (let i = 0; i < totalFrames; i += 1) {
    if (signal?.aborted) return { ok: false, error: '사용자 취소' };

    const timeMs = i * FRAME_INTERVAL_MS;
    onProgress?.({
      phase: 'extracting',
      current: i,
      total: totalFrames,
    });

    let thumbUri: string;
    try {
      const t = await VideoThumbnails.getThumbnailAsync(videoUri, {
        time: timeMs,
        quality: 0.7,
      });
      thumbUri = t.uri;
    } catch (err) {
      console.warn(`[pose-video] thumbnail extract failed at ${timeMs}ms:`, err);
      continue; // 일부 프레임 실패는 무시하고 계속
    }

    onProgress?.({
      phase: 'detecting',
      current: i,
      total: totalFrames,
    });

    let lms: MpLandmark[] | undefined;
    try {
      const r = await PoseDetectionOnImage(thumbUri, MODEL_FILE, {
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        delegate: Delegate.GPU,
      });
      lms = r.results?.[0]?.landmarks?.[0];
    } catch (err) {
      console.warn(`[pose-video] pose detection failed at ${timeMs}ms:`, err);
      continue;
    }

    if (!lms || lms.length < 33) continue;

    if (!firstVisibilityLogged) {
      const sample = lms[23];
      console.log(
        '[pose-video] first frame — vis(L_HIP):',
        sample?.visibility,
        'x:',
        sample?.x?.toFixed(3),
        'y:',
        sample?.y?.toFixed(3),
      );
      firstVisibilityLogged = true;
    }

    const lmArray: Landmark[] = lms.map((p) => ({
      x: p.x,
      y: p.y,
      z: p.z,
      visibility: p.visibility,
      presence: p.presence,
    }));

    const angles = AnalysisEngine.calcAngles(lmArray);

    // store 누적 + SquatTracker.update (라이브와 동일 흐름)
    const store = useAnalysisStore.getState();
    const frame: FrameRecord = { timeMs, angles, landmarks: lmArray };
    store.setRealtime({
      currentLandmarks: lmArray,
      currentAngles: angles,
      frameCount: i + 1,
      lastPoseMs: timeMs,
      frameHistory: [...store.realtime.frameHistory, frame],
      isPoseReady: true,
    });
    SquatTracker.update(lmArray, angles, timeMs);

    if (i % 10 === 0) {
      const phase = useAnalysisStore.getState().squatTracker.phase;
      const rep = useAnalysisStore.getState().squatTracker.repIndex;
      console.log(
        `[pose-video] f${i + 1}/${totalFrames} L:${angles.leftKnee} R:${angles.rightKnee} phase:${phase} rep:${rep}`,
      );
    }

    processed += 1;
  }

  onProgress?.({
    phase: 'finalizing',
    current: totalFrames,
    total: totalFrames,
  });

  try {
    AnalysisEngine.finalizeResult();
  } catch (err) {
    return { ok: false, error: `finalize 실패: ${(err as Error).message}` };
  }

  onProgress?.({
    phase: 'done',
    current: totalFrames,
    total: totalFrames,
  });

  return { ok: true, frameCount: processed };
}

export { FRAME_INTERVAL_MS };
