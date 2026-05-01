import { AppConfig } from './config';
import {
  AnalysisState,
  SH,
  type BestFrameData,
  type RecurrenceData,
  type SquatRep,
} from './state';
import type { JointAngles, JointRange, Landmark, RiskLevel } from './types';
import { avg, devOf, isVisible, riskOf } from './utils';

interface IssueBestFrame {
  deviation: number;
  timeMs: number;
  landmarks: Landmark[];
  angles: JointAngles;
  angle: number;
  range: JointRange;
  risk: Exclude<RiskLevel, 'normal' | 'ignore'>;
  isBottom: boolean;
}

interface InternalRep {
  startMs: number;
  bottomMs: number;
  endMs: number;
  minKneeAngle: number;
  maxHipY: number;
  issues: string[];
  issueBest: Record<string, IssueBestFrame>;
  repIndexWhenDone: number;
  repIndex?: number;
}

/**
 * tracker 내부 mutable state — Zustand 외부.
 * 분석 진행 중에는 매 프레임 mutate, rep 완성 시점에만 SH로 reactive 동기화.
 */
const trackerState = {
  phase: 'idle' as 'idle' | 'descending' | 'ascending',
  reps: [] as InternalRep[],
  currentRep: null as InternalRep | null,
  hipYHistory: [] as number[],
  repIndex: 0,
  issueReps: {} as Record<string, Set<number>>,
  bestFrames: {} as Record<string, BestFrameData>,
};

function reset(): void {
  trackerState.phase = 'idle';
  trackerState.reps = [];
  trackerState.currentRep = null;
  trackerState.hipYHistory = [];
  trackerState.repIndex = 0;
  trackerState.issueReps = {};
  trackerState.bestFrames = {};
  SH.resetSquatTracker();
}

function update(landmarks: Landmark[], angles: JointAngles, timeMs: number): void {
  const mvId = AnalysisState.session.selectedMvId;
  if (!mvId.startsWith('ohs')) return;

  const L = AppConfig.LM;
  const cfg = AppConfig.SQUAT;
  const lhip = landmarks[L.L_HIP];
  const rhip = landmarks[L.R_HIP];
  if (!isVisible(lhip) || !isVisible(rhip)) return;

  const hipY = (lhip.y + rhip.y) / 2;
  const lk = angles.leftKnee ?? 180;
  const rk = angles.rightKnee ?? 180;
  const kneeAngle = (lk + rk) / 2;

  trackerState.hipYHistory.push(hipY);
  if (trackerState.hipYHistory.length > 8) trackerState.hipYHistory.shift();
  const smoothHipY = avg(trackerState.hipYHistory);

  switch (trackerState.phase) {
    case 'idle':
      if (kneeAngle < cfg.KNEE_DOWN_ANGLE) {
        trackerState.phase = 'descending';
        trackerState.currentRep = {
          startMs: timeMs,
          bottomMs: 0,
          endMs: 0,
          minKneeAngle: kneeAngle,
          maxHipY: smoothHipY,
          issues: [],
          issueBest: {},
          repIndexWhenDone: trackerState.repIndex + 1,
        };
      }
      break;
    case 'descending':
      if (!trackerState.currentRep) break;
      if (kneeAngle < trackerState.currentRep.minKneeAngle) {
        trackerState.currentRep.minKneeAngle = kneeAngle;
      }
      if (smoothHipY > trackerState.currentRep.maxHipY) {
        trackerState.currentRep.maxHipY = smoothHipY;
      }
      if (kneeAngle > trackerState.currentRep.minKneeAngle + 12) {
        trackerState.phase = 'ascending';
        trackerState.currentRep.bottomMs = timeMs;
      }
      break;
    case 'ascending':
      if (!trackerState.currentRep) break;
      if (kneeAngle > 155) {
        trackerState.currentRep.endMs = timeMs;
        if (
          trackerState.currentRep.endMs - trackerState.currentRep.startMs >=
          cfg.MIN_REP_DURATION_MS
        ) {
          trackerState.repIndex += 1;
          trackerState.currentRep.repIndex = trackerState.repIndex;
          trackerState.reps.push({
            ...trackerState.currentRep,
            issueBest: { ...trackerState.currentRep.issueBest },
          });

          // issueReps 누적
          Object.keys(trackerState.currentRep.issueBest).forEach((jk) => {
            if (!trackerState.issueReps[jk]) trackerState.issueReps[jk] = new Set();
            trackerState.issueReps[jk].add(trackerState.repIndex);
          });

          // bestFrames 갱신: 전체 통틀어 이슈별 가장 심한 프레임
          Object.entries(trackerState.currentRep.issueBest).forEach(([jk, frame]) => {
            const existing = trackerState.bestFrames[jk];
            if (!existing || frame.deviation > existing.deviation) {
              trackerState.bestFrames[jk] = {
                deviation: frame.deviation,
                timeMs: frame.timeMs,
                landmarks: frame.landmarks,
                angles: frame.angles,
                repIndex: trackerState.repIndex,
              };
            }
          });

          // Zustand reactive 동기화 — UI가 repIndex / reps 표시
          SH.setSquatTracker({
            repIndex: trackerState.repIndex,
            reps: summarizeReps(),
          });
        }
        trackerState.currentRep = null;
        trackerState.phase = 'idle';
      }
      break;
  }

  // currentRep 내 모든 관절 이슈 추적
  const cur = trackerState.currentRep;
  if (cur) {
    const mvConf = AppConfig.MOVEMENTS.find((m) => m.id === AnalysisState.session.selectedMvId);
    const ranges = (mvConf?.ranges ?? {}) as Record<string, JointRange>;
    Object.entries(angles).forEach(([jk, ang]) => {
      if (ang === null || ang === undefined) return;
      const range = ranges[jk];
      if (!range) return;
      const risk = riskOf(ang, range);
      if (risk === 'normal' || risk === 'ignore') return;

      const dev = devOf(ang, range);
      if (!cur.issues.includes(jk)) cur.issues.push(jk);

      const existing = cur.issueBest[jk];
      if (!existing || dev > existing.deviation) {
        cur.issueBest[jk] = {
          deviation: dev,
          timeMs,
          landmarks: [...landmarks],
          angles: { ...angles },
          angle: ang,
          range,
          risk: risk as 'warning' | 'danger',
          isBottom:
            Math.abs(timeMs - (cur.bottomMs || 0)) < AppConfig.CAPTURE.BOTTOM_WINDOW_MS,
        };
      }
    });
  }
}

function summarizeReps(): SquatRep[] {
  return trackerState.reps.map((rep, i) => {
    const depthScore = Math.min(100, Math.max(0, Math.round((130 - rep.minKneeAngle) * 1.5)));
    const issueScore = Math.max(0, 100 - rep.issues.length * 25);
    return {
      repNum: rep.repIndex ?? i + 1,
      startMs: rep.startMs,
      endMs: rep.endMs,
      bottomMs: rep.bottomMs,
      minKneeAngle: rep.minKneeAngle,
      score: Math.round((depthScore + issueScore) / 2),
      issues: [...rep.issues],
    };
  });
}

function calcRecurrence(): Record<string, RecurrenceData> {
  const total = trackerState.repIndex || 1;
  const ranges = (AppConfig.MOVEMENTS.find(
    (m) => m.id === AnalysisState.session.selectedMvId,
  )?.ranges ?? {}) as Record<string, JointRange>;
  const result: Record<string, RecurrenceData> = {};

  Object.entries(trackerState.issueReps).forEach(([jk, repSet]) => {
    const repNums = Array.from(repSet).sort((a, b) => a - b);
    const count = repNums.length;
    const rate = count / total;
    result[jk] = {
      count,
      total,
      rate,
      repNums,
      jointName: ranges[jk]?.name ?? jk,
      isRecurrent:
        count >= AppConfig.EXPERT.RECURRENCE_MIN_COUNT ||
        rate >= AppConfig.EXPERT.RECURRENCE_MIN_RATE,
    };
  });

  return result;
}

function getBestFrames(): Record<string, BestFrameData> {
  return { ...trackerState.bestFrames };
}

function getRepIndex(): number {
  return trackerState.repIndex;
}

export const SquatTracker = {
  update,
  reset,
  summarizeReps,
  calcRecurrence,
  getBestFrames,
  getRepIndex,
};

export { update, reset, summarizeReps, calcRecurrence, getBestFrames, getRepIndex };
