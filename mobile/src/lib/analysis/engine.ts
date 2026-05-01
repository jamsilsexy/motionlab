import { AppConfig } from './config';
import { ExpertFilter } from './filter';
import {
  AnalysisState,
  SH,
  type Capture,
  type JointSummaryEntry,
  type RecurrenceData,
  type SquatRep,
  type VideoSignature,
} from './state';
import { SquatTracker } from './tracker';
import type { JointAngles, JointRange, Landmark } from './types';
import { avg, calcAngle, devOf, isVisible, lmAngle, riskOf } from './utils';

/* ───────────────────────────────────────────────────────────
 * 정면 전용: 좌우 무릎·고관절 비대칭, 어깨 수평, 발목 외회전
 * ─────────────────────────────────────────────────────────── */
function calcFrontAngles(lms: Landmark[]): JointAngles {
  const L = AppConfig.LM;
  const a = (ia: number, ib: number, ic: number) => lmAngle(lms, ia, ib, ic);

  // 발끝 외회전 (발목-무릎 벡터, 30도 이상 = 발목 배굴 보상 의심)
  // 원본 v17 버그 수정: 미정의 angles 변수 → return 객체에 직접 포함
  let footOutward: number | null = null;
  {
    const lAnk = lms[L.L_ANKLE];
    const lKn = lms[L.L_KNEE];
    const rAnk = lms[L.R_ANKLE];
    const rKn = lms[L.R_KNEE];
    if (isVisible(lAnk) && isVisible(lKn) && isVisible(rAnk) && isVisible(rKn)) {
      const leftFO = Math.abs((Math.atan2(lAnk.x - lKn.x, lKn.y - lAnk.y) * 180) / Math.PI);
      const rightFO = Math.abs((Math.atan2(rAnk.x - rKn.x, rKn.y - rAnk.y) * 180) / Math.PI);
      footOutward = Math.round((leftFO + rightFO) / 2);
    }
  }

  // 골반 좌우 시프팅 (고관절 중점 x좌표가 어깨 중점 대비 얼마나 이동)
  // 어깨 너비 기준 정규화 → 각도 스케일로 변환
  const hipShift = ((): number | null => {
    const ls = lms[L.L_SHOULDER];
    const rs = lms[L.R_SHOULDER];
    const lh = lms[L.L_HIP];
    const rh = lms[L.R_HIP];
    if (!isVisible(ls) || !isVisible(rs) || !isVisible(lh) || !isVisible(rh)) return null;
    const shoulderMidX = (ls.x + rs.x) / 2;
    const hipMidX = (lh.x + rh.x) / 2;
    const shoulderWidth = Math.abs(rs.x - ls.x) || 0.1;
    const shiftRatio = Math.abs(hipMidX - shoulderMidX) / shoulderWidth;
    return Math.round(shiftRatio * 140);
  })();

  // 척추 대칭 (어깨중점 → 고관절중점 vs 수직)
  const spineSymmetry = ((): number | null => {
    const ls = lms[L.L_SHOULDER];
    const rs = lms[L.R_SHOULDER];
    const lh = lms[L.L_HIP];
    const rh = lms[L.R_HIP];
    if (!isVisible(ls) || !isVisible(rs) || !isVisible(lh) || !isVisible(rh)) return null;
    const sm = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: 0 };
    const hm = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: 0 };
    const vert = { x: sm.x, y: sm.y + 0.1, z: 0 };
    return calcAngle(vert, sm, hm);
  })();

  return {
    leftKnee: a(L.L_HIP, L.L_KNEE, L.L_ANKLE),
    rightKnee: a(L.R_HIP, L.R_KNEE, L.R_ANKLE),
    leftHip: a(L.L_SHOULDER, L.L_HIP, L.L_KNEE),
    rightHip: a(L.R_SHOULDER, L.R_HIP, L.R_KNEE),
    leftShoulder: a(L.L_ELBOW, L.L_SHOULDER, L.L_HIP),
    rightShoulder: a(L.R_ELBOW, L.R_SHOULDER, L.R_HIP),
    hipShift,
    spineSymmetry,
    footOutward,
  };
}

/* ───────────────────────────────────────────────────────────
 * 측면 전용: 척추 굴곡, 발목 배굴, 체간 기울기, 힙 뎁스
 * ─────────────────────────────────────────────────────────── */
function calcSideAngles(lms: Landmark[]): JointAngles {
  const L = AppConfig.LM;
  const a = (ia: number, ib: number, ic: number) => lmAngle(lms, ia, ib, ic);

  // null 대신 가시성 있는 쪽만 선택 (null||180 오류 수정 from v7.2)
  const avg2 = (v1: number | null, v2: number | null): number | null => {
    if (v1 !== null && v2 !== null) return (v1 + v2) / 2;
    if (v1 !== null) return v1;
    if (v2 !== null) return v2;
    return null;
  };

  const kneeRaw = avg2(a(L.L_HIP, L.L_KNEE, L.L_ANKLE), a(L.R_HIP, L.R_KNEE, L.R_ANKLE));
  const hipRaw = avg2(a(L.L_SHOULDER, L.L_HIP, L.L_KNEE), a(L.R_SHOULDER, L.R_HIP, L.R_KNEE));
  const ankleRaw = avg2(a(L.L_KNEE, L.L_ANKLE, L.L_HEEL), a(L.R_KNEE, L.R_ANKLE, L.R_HEEL));

  const angles: JointAngles = {
    leftKnee: kneeRaw !== null ? Math.round(kneeRaw) : null,
    rightKnee: kneeRaw !== null ? Math.round(kneeRaw) : null,
    leftHip: hipRaw !== null ? Math.round(hipRaw) : null,
    rightHip: hipRaw !== null ? Math.round(hipRaw) : null,
    leftAnkle: ankleRaw !== null ? Math.round(ankleRaw) : null,
    rightAnkle: ankleRaw !== null ? Math.round(ankleRaw) : null,
  };

  const ls = lms[L.L_SHOULDER];
  const rs = lms[L.R_SHOULDER];
  const lh = lms[L.L_HIP];
  const rh = lms[L.R_HIP];
  const lk = lms[L.L_KNEE];
  const rk = lms[L.R_KNEE];
  const allVis4 = isVisible(ls) && isVisible(rs) && isVisible(lh) && isVisible(rh);

  // 측면 척추: 어깨중점 → 고관절중점 → 무릎중점
  if (allVis4 && isVisible(lk) && isVisible(rk)) {
    const sm = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: 0 };
    const hm = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: 0 };
    const km = { x: (lk.x + rk.x) / 2, y: (lk.y + rk.y) / 2, z: 0 };
    angles.spine = calcAngle(sm, hm, km);
  }

  // 체간 전방 기울기: 어깨중점 → 고관절중점 vs 수직
  if (allVis4) {
    const sm2 = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: 0 };
    const hm2 = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: 0 };
    const vertRef = { x: hm2.x, y: hm2.y - 0.1, z: 0 };
    angles.trunkLean = calcAngle(sm2, hm2, vertRef);
  }

  // v17: 발목 배굴(Dorsiflexion) — 정강이 기울기 각도
  const la = lms[L.L_ANKLE];
  const lk2 = lms[L.L_KNEE];
  const ra = lms[L.R_ANKLE];
  const rk2 = lms[L.R_KNEE];
  if (isVisible(la) && isVisible(lk2)) {
    const dx = Math.abs(lk2.x - la.x);
    const dy = Math.abs(lk2.y - la.y);
    if (dy > 0.01) angles.ankleDorsiL = Math.round((Math.atan2(dx, dy) * 180) / Math.PI);
  }
  if (isVisible(ra) && isVisible(rk2)) {
    const dx = Math.abs(rk2.x - ra.x);
    const dy = Math.abs(rk2.y - ra.y);
    if (dy > 0.01) angles.ankleDorsiR = Math.round((Math.atan2(dx, dy) * 180) / Math.PI);
  }
  const adL = angles.ankleDorsiL;
  const adR = angles.ankleDorsiR;
  if (adL != null && adR != null) angles.ankleDorsi = Math.round((adL + adR) / 2);
  else if (adL != null) angles.ankleDorsi = adL;
  else if (adR != null) angles.ankleDorsi = adR;

  // v17: 흉추 가동성 — 상체 전방 기울기 (수직 대비 어깨-골반 각도)
  if (allVis4 && isVisible(lk) && isVisible(rk)) {
    const sm3 = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: 0 };
    const hm3 = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: 0 };
    const vertRef3 = { x: hm3.x, y: hm3.y - 0.2, z: 0 };
    angles.thoracicFlex = Math.round(calcAngle(sm3, hm3, vertRef3));
  }

  return angles;
}

/* ───────────────────────────────────────────────────────────
 * 운동별 시점에 따라 적합한 계산 함수 디스패치
 * ─────────────────────────────────────────────────────────── */
function calcAngles(lms: Landmark[]): JointAngles {
  const mvId = AnalysisState.session.selectedMvId || 'ohs_front';
  if (mvId === 'ohs_front' || mvId === 'lunge') return calcFrontAngles(lms);
  if (mvId === 'ohs_side' || mvId === 'hip_hinge') return calcSideAngles(lms);
  return calcFrontAngles(lms);
}

/* ───────────────────────────────────────────────────────────
 * 영상별 특징 추출 (VideoSignature)
 * ─────────────────────────────────────────────────────────── */
function extractVideoSignature(
  summary: Record<string, JointSummaryEntry>,
  recurrence: Record<string, RecurrenceData>,
  sqReps: SquatRep[],
): VideoSignature {
  const rec = recurrence ?? {};
  const reps = sqReps ?? [];

  // 1. 가장 deviation이 큰 관절
  let dominantJoint: string | null = null;
  let dominantDeviation = 0;
  Object.entries(summary).forEach(([jk, d]) => {
    const dev = devOf(d.worst, d.range);
    if (dev > dominantDeviation) {
      dominantDeviation = dev;
      dominantJoint = jk;
    }
  });

  // 2. 좌우 차이 최대값
  const mirrorPairs: [string, string][] = [
    ['leftKnee', 'rightKnee'],
    ['leftHip', 'rightHip'],
    ['leftAnkle', 'rightAnkle'],
    ['leftShoulder', 'rightShoulder'],
  ];
  let leftRightDiff = 0;
  let leftRightJoint = '';
  mirrorPairs.forEach(([l, r]) => {
    const lAvg = summary[l]?.avg;
    const rAvg = summary[r]?.avg;
    if (lAvg !== undefined && rAvg !== undefined) {
      const diff = Math.abs(lAvg - rAvg);
      if (diff > leftRightDiff) {
        leftRightDiff = diff;
        leftRightJoint = l.replace('left', '');
      }
    }
  });

  // 3. 반복률 가장 높은 이슈
  let topRecurrentJoint: string | null = null;
  let topRecurrentRate = 0;
  Object.entries(rec).forEach(([jk, d]) => {
    if (d.rate > topRecurrentRate) {
      topRecurrentRate = d.rate;
      topRecurrentJoint = jk;
    }
  });

  // 4. 평균 안정성
  const issueRates = Object.values(summary).map((d) => d.issueRate || 0);
  const avgInstability = issueRates.length ? avg(issueRates) : 0;
  const avgStability = Math.round((1 - avgInstability) * 100);

  // 5. 최소 무릎 각도
  const minKneeAngle = reps.length ? Math.min(...reps.map((r) => r.minKneeAngle)) : null;

  // 6. 최대 척추 굴곡 이탈
  const maxSpineFlexion = summary.spine ? devOf(summary.spine.worst, summary.spine.range) : 0;

  // 7. 가장 나쁜/좋은 rep
  let worstRepNum: number | null = null;
  let bestRepNum: number | null = null;
  if (reps.length >= 2) {
    const worst = reps.reduce((w, r) => (r.score < w.score ? r : w), reps[0]);
    const best = reps.reduce((b, r) => (r.score > b.score ? r : b), reps[0]);
    worstRepNum = worst.repNum;
    bestRepNum = best.repNum;
  }

  // 8. rep 간 일관성
  let consistencyScore = 100;
  if (reps.length >= 3) {
    const scores = reps.map((r) => r.score);
    const mean = avg(scores);
    const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
    const stddev = Math.sqrt(variance);
    consistencyScore = Math.max(0, Math.round(100 - stddev * 2));
  }

  return {
    dominantJoint,
    dominantDeviation: Math.round(dominantDeviation),
    leftRightDiff: Math.round(leftRightDiff),
    leftRightJoint,
    topRecurrentJoint,
    topRecurrentRate: Math.round(topRecurrentRate * 100),
    avgStability,
    minKneeAngle,
    maxSpineFlexion: Math.round(maxSpineFlexion),
    worstRepNum,
    bestRepNum,
    consistencyScore,
    mvId: AnalysisState.session.selectedMvId,
  };
}

/* ───────────────────────────────────────────────────────────
 * 프레임 히스토리 → 관절별 통계 (IQR 이상값 제거 포함)
 * ─────────────────────────────────────────────────────────── */
function buildSummary(): Record<string, JointSummaryEntry> {
  const hist = AnalysisState.realtime.frameHistory;
  if (!hist || hist.length < 1) return {};

  const mvId = AnalysisState.session.selectedMvId || 'ohs_front';
  const ranges = (AppConfig.MOVEMENTS.find((m) => m.id === mvId)?.ranges ?? {}) as Record<
    string,
    JointRange
  >;

  // 타임스탬프 기반 중복 프레임 제거
  const seen = new Set<number>();
  const dedupedHist = hist.filter((f) => {
    const key = Math.round(f.timeMs);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const byJ: Record<string, number[]> = {};
  dedupedHist.forEach((f) => {
    Object.entries(f.angles).forEach(([j, ang]) => {
      if (ang === null || ang === undefined) return;
      if (typeof ang !== 'number' || Number.isNaN(ang) || ang < 0 || ang > 180) return;
      if (!byJ[j]) byJ[j] = [];
      byJ[j].push(ang);
    });
  });

  const summary: Record<string, JointSummaryEntry> = {};
  Object.entries(byJ).forEach(([j, arr]) => {
    if (!arr.length) return;
    const range = ranges[j] as JointRange | undefined;
    if (!range) return;

    // IQR 기반 이상값 제거 (4개 이상일 때만)
    let filtered = arr;
    if (arr.length >= 4) {
      const sorted = [...arr].sort((a, b) => a - b);
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = q3 - q1;
      const lo = q1 - iqr * 1.5;
      const hi = q3 + iqr * 1.5;
      const f = arr.filter((v) => v >= lo && v <= hi);
      if (f.length >= 1) filtered = f;
    }
    if (filtered.length < 1) return;

    const avgVal = Math.round(avg(filtered));
    const min = Math.min(...filtered);
    const max = Math.max(...filtered);
    const worst = filtered.reduce(
      (w, v) => (devOf(v, range) > devOf(w, range) ? v : w),
      filtered[0],
    );
    const risk = riskOf(worst, range);
    const issFrames = filtered.filter((v) => {
      const r = riskOf(v, range);
      return r !== 'normal' && r !== 'ignore';
    }).length;

    summary[j] = {
      avg: avgVal,
      min,
      max,
      worst,
      risk,
      name: range.name,
      range,
      issueRate: issFrames / filtered.length,
      totalFrames: filtered.length,
      rawFrames: arr.length,
      filteredOut: arr.length - filtered.length,
    };
  });

  return summary;
}

/* ───────────────────────────────────────────────────────────
 * 관절별 시각화용 점수 (0~100) — DISPLAY_MAX_DEV 기준
 * ─────────────────────────────────────────────────────────── */
function jointScore(jointKey: string, deviation: number): number {
  const dmap = AppConfig.EXPERT.DISPLAY_MAX_DEV;
  const kind =
    jointKey === 'spine'
      ? 'spine'
      : jointKey === 'hipShift'
        ? 'hipShift'
        : jointKey.toLowerCase().includes('knee')
          ? 'knee'
          : jointKey.toLowerCase().includes('hip')
            ? 'hip'
            : jointKey.toLowerCase().includes('ankle')
              ? 'ankle'
              : jointKey.toLowerCase().includes('shoulder')
                ? 'shoulder'
                : 'default';
  const maxDev = dmap[kind] ?? dmap.default;
  return Math.max(0, Math.round(100 - (deviation / maxDev) * 100));
}

/* ───────────────────────────────────────────────────────────
 * 종합 점수 (criticals 기반 감점)
 * ─────────────────────────────────────────────────────────── */
function calcScore(criticals: Capture[]): number {
  let p = 0;
  criticals.forEach((c) => {
    if (c.expertClass === 'CRITICAL') p += 12;
    else if (c.severity === 'danger') p += 5;
    else p += 2;
  });
  let score = 100 - p;
  if (score < 40) score = 30 + score / 4;
  return Math.max(10, Math.min(100, Math.round(score)));
}

/* ───────────────────────────────────────────────────────────
 * 보완 테스트 결정 — OHS criticals + hipShift 기반
 * ─────────────────────────────────────────────────────────── */
function decideSupplementTest(): string | null {
  const allResults = AnalysisState.session.allResults;
  const ohsResults = Object.entries(allResults)
    .filter(([id]) => id.startsWith('ohs'))
    .map(([, r]) => r);
  if (!ohsResults.length) return null;

  const allCriticals = ohsResults.flatMap((r) => r.criticalIssues || []);
  const hasHipShift = ohsResults.some((r) => {
    const hs = r.jointSummary?.hipShift;
    return hs?.risk === 'warning' || hs?.risk === 'danger';
  });

  const issueKeys = new Set<string>(allCriticals.map((c) => c.jointKey));
  if (hasHipShift) issueKeys.add('hipShift');

  const sorted = [...AppConfig.SUPPLEMENT_MAP].sort((a, b) => a.priority - b.priority);
  for (const entry of sorted) {
    if (entry.triggerJoints.some((jk) => issueKeys.has(jk))) {
      return entry.supplementId;
    }
  }
  return null;
}

/* ───────────────────────────────────────────────────────────
 * 단일 영상 분석 마무리 — Lean (sales script / member summary / PT plan / integratedEval 제외)
 * ─────────────────────────────────────────────────────────── */
function finalizeResult(): void {
  const summary = buildSummary();
  SH.setJointSummary(summary);

  const isOhs = AnalysisState.session.selectedMvId?.startsWith('ohs');
  if (isOhs) {
    SH.setSqReps(SquatTracker.summarizeReps());
    SH.setRecurrence(SquatTracker.calcRecurrence());
  }
  const recurrence = AnalysisState.result.recurrence ?? {};
  const sqReps = AnalysisState.result.sqReps ?? [];

  const signature = extractVideoSignature(summary, recurrence, sqReps);
  SH.setVideoSignature(signature);

  // captures에 recurrence 메타 병합
  const enrichedCaptures = AnalysisState.result.captures.map((c) => {
    const repData = recurrence[c.jointKey];
    return {
      ...c,
      repeatCount: repData?.count ?? 0,
      repeatRate: repData?.rate ?? 0,
      isRepresentative: false,
    };
  });
  SH.setResult({ captures: enrichedCaptures });

  const criticals = ExpertFilter.selectCriticals(
    enrichedCaptures,
    summary,
    recurrence,
    signature,
  );

  // isRepresentative 마킹
  const critIds = new Set(criticals.map((c) => c.id));
  const markedCaptures = enrichedCaptures.map((c) =>
    critIds.has(c.id) ? { ...c, isRepresentative: true } : c,
  );
  SH.setResult({ captures: markedCaptures });
  SH.setCritical(criticals);

  const score = calcScore(criticals);
  SH.setScore(score);

  const member = AnalysisState.session.memberData;
  if (member?.id) {
    void SH.upsertMember({ ...member, lastAnalysis: new Date().toISOString() });
  }

  SH.setResult({ isComplete: true });
}

/* ───────────────────────────────────────────────────────────
 * 멀티 분석 통합 마무리 — Lean (NASMEngine + sales script 등 제외)
 * ─────────────────────────────────────────────────────────── */
function finalizeMultiResult(): void {
  const allResults = AnalysisState.session.allResults;
  const member = AnalysisState.session.memberData;
  const mvIds = Object.keys(allResults);
  if (!mvIds.length) return;

  const mergedSummary: Record<string, JointSummaryEntry> = {};
  const mergedCriticals: Capture[] = [];
  const seenJointKeys = new Set<string>();

  mvIds.forEach((mvId) => {
    const r = allResults[mvId];
    Object.entries(r.jointSummary ?? {}).forEach(([jk, d]) => {
      if (!mergedSummary[jk]) {
        mergedSummary[jk] = d;
      } else {
        const existDev = devOf(mergedSummary[jk].worst, mergedSummary[jk].range);
        const newDev = devOf(d.worst, d.range);
        if (newDev > existDev) mergedSummary[jk] = d;
      }
    });
    (r.criticalIssues ?? []).forEach((c) => {
      if (!seenJointKeys.has(c.jointKey)) {
        seenJointKeys.add(c.jointKey);
        mergedCriticals.push(c);
      }
    });
  });

  const limitedCriticals = mergedCriticals.slice(0, AppConfig.EXPERT.MAX_CRITICAL_OUTPUT);
  SH.setJointSummary(mergedSummary);
  SH.setCritical(limitedCriticals);

  const score = calcScore(limitedCriticals);
  SH.setScore(score);

  SH.setResult({
    analyzedMovements: mvIds,
    isComplete: true,
  });

  if (member?.id) {
    void SH.upsertMember({ ...member, lastAnalysis: new Date().toISOString() });
  }
}

/* ───────────────────────────────────────────────────────────
 * 배럴 export
 * ─────────────────────────────────────────────────────────── */
export const AnalysisEngine = {
  calcFrontAngles,
  calcSideAngles,
  calcAngles,
  buildSummary,
  extractVideoSignature,
  jointScore,
  calcScore,
  decideSupplementTest,
  finalizeResult,
  finalizeMultiResult,
};

export {
  calcFrontAngles,
  calcSideAngles,
  calcAngles,
  buildSummary,
  extractVideoSignature,
  jointScore,
  calcScore,
  decideSupplementTest,
  finalizeResult,
  finalizeMultiResult,
};
