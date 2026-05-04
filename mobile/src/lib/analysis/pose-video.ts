import * as FileSystem from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';
import {
  Delegate,
  PoseDetectionOnImage,
  type Landmark as MpLandmark,
} from 'react-native-mediapipe-posedetection';

import { AnalysisEngine } from './engine';
import { SH, type FrameRecord, useAnalysisStore } from './state';
import { SquatTracker } from './tracker';
import type { Landmark } from './types';

const MODEL_FILE = 'pose_landmarker_lite.task';
// frame 추출 간격. 0.35s ≈ 2.85fps.
//   OHS 1 rep ≈ 3-4초이므로 3fps도 충분 (descend/bottom/ascend 각 1-2 frame씩 잡힘).
//   0.2s(5fps) → 0.35s 변경: frame 수 43% 감소 = 처리 시간 거의 절반.
const FRAME_INTERVAL_MS = 350;
// thumbnail 압축 품질 — Pose 추론은 0.4 정도면 충분 (JPEG artifact가 33 landmark 정확도에 미미).
const THUMB_QUALITY = 0.4;
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
  // frame들을 local에 누적 → 종료 시 한번에 store push (per-frame setRealtime 무한 spread 방지)
  const collectedFrames: FrameRecord[] = [];

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
        quality: THUMB_QUALITY,
      });
      thumbUri = t.uri;
    } catch (err) {
      console.warn(`[pose-video] thumbnail extract failed at ${timeMs}ms:`, err);
      continue;
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
      // 추론 실패해도 thumbnail 파일은 정리
      void FileSystem.deleteAsync(thumbUri, { idempotent: true }).catch(() => {});
      continue;
    }

    // ★ 메모리 폭증/디스크 누적 방지 — 추론 끝난 thumbnail 즉시 삭제
    void FileSystem.deleteAsync(thumbUri, { idempotent: true }).catch(() => {});

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

    // ★ frame은 local에만 누적 (매 frame setRealtime + spread 시 OOM 위험)
    const frame: FrameRecord = { timeMs, angles, landmarks: lmArray };
    collectedFrames.push(frame);

    // SquatTracker.update — rep 카운트는 매 frame 필요 (내부적으로 SH.setSquatTracker 자동 호출)
    SquatTracker.update(lmArray, angles, timeMs);

    // 가벼운 realtime 표시만 갱신 (frameHistory는 X). 5 frame 간격으로 throttle.
    if (i % 5 === 0) {
      SH.setRealtime({
        currentAngles: angles,
        frameCount: i + 1,
        lastPoseMs: timeMs,
        isPoseReady: true,
      });
    }

    if (i % 10 === 0) {
      const phase = useAnalysisStore.getState().squatTracker.phase;
      const rep = useAnalysisStore.getState().squatTracker.repIndex;
      console.log(
        `[pose-video] f${i + 1}/${totalFrames} L:${angles.leftKnee} R:${angles.rightKnee} phase:${phase} rep:${rep}`,
      );
    }

    processed += 1;
  }

  // ★ 종료 시점에 frameHistory를 store에 한번에 push — finalizeResult가 buildSummary에서 읽음
  SH.setRealtime({
    frameHistory: collectedFrames,
    frameCount: collectedFrames.length,
    isPoseReady: true,
  });

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
