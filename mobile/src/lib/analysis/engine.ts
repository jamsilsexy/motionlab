import { AppConfig } from './config';
import { ExpertFilter } from './filter';
import {
  AnalysisState,
  SH,
  type Capture,
  type JointSummaryEntry,
  type Member,
  type RecurrenceData,
  type SquatRep,
  type VideoSignature,
} from './state';
import { SquatTracker } from './tracker';
import type {
  JointAngles,
  JointRange,
  Landmark,
  MemberSummary,
  PtPlan,
  PtPlanPhase,
  SalesScriptStage,
} from './types';
import { avg, calcAngle, devOf, isVisible, lmAngle, riskOf } from './utils';

/* ───────────────────────────────────────────────────────────
 * V2 lib: HTML 태그 스트립 (web v17 sales script/member summary는
 *   <strong>, <em> 같은 인라인 태그를 본문에 포함. RN <Text>는 미렌더 → 제거)
 * ─────────────────────────────────────────────────────────── */
function stripHtml(s: string): string {
  return s.replace(/<\/?[a-z][^>]*>/gi, '');
}

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

/* ═══════════════════════════════════════════════════════════
 * V2 lib (web v17 8515-9286 풀이전):
 *   buildMemberSummary, buildSalesScriptV5, calcPtPlan
 *
 * 모두 pure 함수 — 명시적 인자만 받음 (web 버전은 AppState 글로벌
 *   읽기였지만 mobile에서는 단일 + 멀티 분석 양쪽 호출 단순화 위해 인자화).
 * ═══════════════════════════════════════════════════════════ */

const PLAIN_JOINT_NAME: Record<string, string> = {
  spine: '허리',
  leftKnee: '왼쪽 무릎',
  rightKnee: '오른쪽 무릎',
  leftHip: '왼쪽 고관절',
  rightHip: '오른쪽 고관절',
  leftAnkle: '왼쪽 발목',
  rightAnkle: '오른쪽 발목',
  leftShoulder: '왼쪽 어깨',
  rightShoulder: '오른쪽 어깨',
  hipShift: '골반',
};

interface BuildSummaryArgs {
  criticals: Capture[];
  summary: Record<string, JointSummaryEntry>;
  member: Member | null;
  recurrence: Record<string, RecurrenceData>;
  signature: VideoSignature | null;
  ptPlan: PtPlan | null;
  totalReps: number;
  isOhs: boolean;
}

/* ───────────────────────────────────────────────────────────
 * 회원용 1페이지 요약 (web v17 8515-8779)
 * ─────────────────────────────────────────────────────────── */
function buildMemberSummary(args: BuildSummaryArgs): MemberSummary {
  const { criticals, member, recurrence, signature, ptPlan, totalReps, isOhs } = args;
  const rec = recurrence ?? {};
  const sig = signature ?? ({} as VideoSignature);
  const goal = member?.goal || 'general';

  const hasSpine = criticals.some((c) => c.jointKey === 'spine');
  const hasKnee = criticals.some((c) => c.jointKey.includes('Knee'));
  const hasHip = criticals.some((c) => c.jointKey.includes('Hip'));
  const hasAnkle = criticals.some((c) => c.jointKey.includes('Ankle'));

  // 1. 한 줄 결론
  let conclusion: string;
  if (!criticals.length) {
    conclusion =
      `전반적인 움직임 패턴은 양호합니다. 안정성 ${sig.avgStability ?? '-'}점` +
      (sig.minKneeAngle ? `, 최저 무릎각도 ${sig.minKneeAngle}°` : '') +
      `. 예방적 관리로 더 효율적인 운동이 가능합니다.`;
  } else {
    const topC = criticals[0];
    const topDev = topC ? Math.round(devOf(topC.angle, topC.normalRange)) : 0;
    const topRec = rec[topC?.jointKey];
    const topRecStr =
      isOhs && topRec && totalReps > 0 ? `, ${totalReps}회 중 ${topRec.count}회 반복` : '';
    const topName = topC ? PLAIN_JOINT_NAME[topC.jointKey] || topC.jointName : '';

    let core = `${topName}에서 ${topDev}° 이탈 패턴이 가장 두드러집니다${topRecStr}.`;
    if (sig.leftRightDiff !== undefined && sig.leftRightDiff >= 12) {
      core += ` 좌우 ${sig.leftRightJoint || '관절'} 차이가 ${sig.leftRightDiff}°로 불균형이 명확합니다.`;
    }
    if (sig.consistencyScore !== undefined && sig.consistencyScore < 65) {
      core += ` 반복마다 폼 편차(일관성 ${sig.consistencyScore}점)가 커 피로 누적 시 부상 위험이 높습니다.`;
    }
    conclusion = core;
  }

  const goalSuffix: Record<string, string> = {
    weight: '이 상태에서 운동 강도를 높이면 효율보다 부상 위험이 먼저 올라갑니다.',
    performance:
      `안정성 ${sig.avgStability ?? '-'}점 — ` +
      (sig.dominantJoint
        ? `${PLAIN_JOINT_NAME[sig.dominantJoint] || sig.dominantJoint} 패턴 미교정 시`
        : '이 패턴이') +
      ' 중량 증가 시 부상으로 이어집니다.',
    rehab: '지금 패턴 교정이 재활 목표 달성의 가장 빠른 길입니다.',
    general: '일상 동작에서도 이 패턴이 반복되고 있을 가능성이 있습니다.',
  };
  if (criticals.length > 0 && goalSuffix[goal]) {
    conclusion += ' ' + goalSuffix[goal];
  }

  // 2. 핵심 문제 3개
  const problems = criticals.slice(0, 3).map((c) => {
    const repData = rec[c.jointKey];
    const repCount = isOhs && repData ? repData.count : null;
    const repTotal = isOhs && totalReps > 0 ? totalReps : null;
    const dev = Math.round(devOf(c.angle, c.normalRange));

    const plainNames: Record<string, string> = {
      spine: '허리가 굽는 패턴',
      leftKnee: '왼쪽 무릎이 안으로 무너짐',
      rightKnee: '오른쪽 무릎이 안으로 무너짐',
      leftHip: '왼쪽 고관절 가동성 부족',
      rightHip: '오른쪽 고관절 가동성 부족',
      leftAnkle: '왼쪽 발목 굽힘 제한',
      rightAnkle: '오른쪽 발목 굽힘 제한',
      leftShoulder: '왼쪽 어깨 정렬 이탈',
      rightShoulder: '오른쪽 어깨 정렬 이탈',
    };

    const plainDescs: Record<string, string> = {
      spine: `요추-골반 복합체의 안정화 기전이 무너져 ${dev}° 굴곡이 발생합니다. 이는 척추 기립근의 과활성과 디스크 후방 압력을 높이는 주원인이 됩니다.`,
      leftKnee: `고관절 외회전근(중둔근)의 통제력 부족으로 대퇴골이 내전/내회전되며 무릎이 ${dev}° 안으로 쏠립니다. 이는 반월상 연골과 내측 인대에 비정상적인 전단력을 가합니다.`,
      rightKnee: `고관절 외회전근(중둔근)의 통제력 부족으로 대퇴골이 내전/내회전되며 무릎이 ${dev}° 안으로 쏠립니다. 이는 반월상 연골과 내측 인대에 비정상적인 전단력을 가합니다.`,
      leftHip: `고관절 굴곡 가동 범위가 ${dev}° 제한되어 하강 시 골반의 후방 경사(Butt Wink)를 유발하며, 이는 요추의 보상적 굴곡으로 이어져 허리 부하를 가중시킵니다.`,
      rightHip: `고관절 굴곡 가동 범위가 ${dev}° 제한되어 하강 시 골반의 후방 경사(Butt Wink)를 유발하며, 이는 요추의 보상적 굴곡으로 이어져 허리 부하를 가중시킵니다.`,
      leftAnkle: `거퇴관절의 배굴(Dorsiflexion)이 ${dev}° 제한되어 하강 시 무게 중심이 전방으로 이동합니다. 이는 무릎의 전방 쏠림과 척추의 과도한 전경을 유발하는 연쇄 반응의 시작점입니다.`,
      rightAnkle: `거퇴관절의 배굴(Dorsiflexion)이 ${dev}° 제한되어 하강 시 무게 중심이 전방으로 이동합니다. 이는 무릎의 전방 쏠림과 척추의 과도한 전경을 유발하는 연쇄 반응의 시작점입니다.`,
      leftShoulder: `견갑-상완 리듬의 불균형으로 어깨 정렬이 ${dev}° 이탈합니다. 이는 흉추 가동성 저하와 결합되어 상체 안정성을 무너뜨리고 목/어깨 통증을 유발할 수 있습니다.`,
      rightShoulder: `견갑-상완 리듬의 불균형으로 어깨 정렬이 ${dev}° 이탈합니다. 이는 흉추 가동성 저하와 결합되어 상체 안정성을 무너뜨리고 목/어깨 통증을 유발할 수 있습니다.`,
    };

    return {
      jointKey: c.jointKey,
      name: plainNames[c.jointKey] || c.jointName,
      desc: plainDescs[c.jointKey] || `${dev}° 이탈 감지`,
      severity: c.severity,
      repCount,
      repTotal,
      deviation: dev,
      isRecurrent: repData?.isRecurrent || false,
    };
  });

  // 3. 왜 문제인가
  const whyItems: { icon: string; text: string }[] = [];
  if (hasSpine || hasKnee) {
    const maxDev = sig.dominantDeviation || 0;
    whyItems.push({
      icon: '⚠️',
      text: `최대 ${maxDev}° 이탈이 반복되면 관절·디스크에 누적 스트레스가 쌓입니다. 지금은 통증이 없어도 임계점을 넘는 순간 부상으로 이어집니다`,
    });
  }
  if (goal === 'weight') {
    whyItems.push({
      icon: '📉',
      text: `안정성 ${sig.avgStability ?? '-'}점 수준에서는 운동 효율이 크게 떨어집니다. 같은 시간 운동해도 결과가 30%+ 덜 나옵니다`,
    });
  } else if (goal === 'performance') {
    whyItems.push({
      icon: '🏋️',
      text: `현재 패턴으로 중량을 올리면 ${sig.dominantJoint ? `${PLAIN_JOINT_NAME[sig.dominantJoint] || sig.dominantJoint} ` : ''}부위에 부하가 기하급수적으로 증가합니다`,
    });
  } else {
    whyItems.push({
      icon: '📉',
      text: '잘못된 패턴이 굳어지기 전 교정하면 훨씬 적은 노력으로 개선됩니다. 지금이 가장 빠른 타이밍입니다',
    });
  }
  if (sig.leftRightDiff !== undefined && sig.leftRightDiff >= 12) {
    whyItems.push({
      icon: '⚖️',
      text: `좌우 ${sig.leftRightJoint || '관절'} 차이가 ${sig.leftRightDiff}°로 한쪽에 스트레스가 집중됩니다. 방치하면 한쪽 관절이 더 빨리 닳습니다`,
    });
  } else if (hasAnkle || hasHip) {
    whyItems.push({
      icon: '🔗',
      text: '발목→무릎→허리는 연결되어 있습니다. 한 부위의 제한이 전신 연쇄 보상을 만듭니다',
    });
  }

  // 4. 변화 예측 (이슈별 × 주차별 DB)
  const changeDB: Record<string, { week24: string; week68: string }> = {
    spine: {
      week24:
        'McGill의 연구에 따르면 척추 중립 재교육 시작 후 2~3주 내 요추 압박력이 감소하기 시작합니다. 앉아서 오래 있을 때 허리가 덜 뻐근해지고, 아침에 일어날 때 뻣뻣함이 줄어드는 것을 먼저 느끼게 됩니다.',
      week68:
        '복횡근·다열근의 공동 수축 패턴이 자동화되어 무거운 물건을 들 때 "허리가 먼저 조여지는" 능동적 보호 반응이 형성됩니다. McGill의 Big 3 훈련 8주 후 요통 재발률이 유의미하게 감소한다는 연구 결과와 일치하는 단계입니다.',
    },
    leftKnee: {
      week24:
        'Clamshell·Side Walk로 중둔근을 활성화하면 1~2주 내 계단 오를 때 무릎이 안으로 쏠리는 느낌이 줄어듭니다. Boyle의 Joint-by-Joint 이론대로 고관절 안정성이 확보되면 무릎은 즉각적으로 반응합니다.',
      week68:
        '대퇴골 내회전을 제어하는 외회전근군이 강화되어 런닝·점프 착지 시 무릎 정렬이 자동으로 유지됩니다. 슬개골-대퇴골 압박력 정상화로 계단 하강 시 통증이 감소하고, 스쿼트 깊이가 이전보다 자연스럽게 깊어집니다.',
    },
    rightKnee: {
      week24:
        'Clamshell·Side Walk로 중둔근을 활성화하면 1~2주 내 계단 오를 때 무릎이 안으로 쏠리는 느낌이 줄어듭니다. Boyle의 Joint-by-Joint 이론대로 고관절 안정성이 확보되면 무릎은 즉각적으로 반응합니다.',
      week68:
        '대퇴골 내회전을 제어하는 외회전근군이 강화되어 런닝·점프 착지 시 무릎 정렬이 자동으로 유지됩니다. 슬개골-대퇴골 압박력 정상화로 계단 하강 시 통증이 감소하고, 스쿼트 깊이가 이전보다 자연스럽게 깊어집니다.',
    },
    leftHip: {
      week24:
        '90/90 스트레칭과 CARs로 고관절 캡슐 가동성이 회복되기 시작하면 앉았다 일어날 때 "뚝"하는 느낌과 뻣뻣함이 감소합니다. Sahrmann의 연구에 따르면 고관절 가동성 회복은 요추 보상 움직임을 직접적으로 줄입니다.',
      week68:
        '고관절 굴곡 패턴이 정상화되면서 스쿼트·데드리프트 시 허리가 개입하는 보상 패턴이 사라집니다. 단측 동작(런지·스텝업)에서 좌우 균형감이 명확히 달라지고, 장시간 보행 후 고관절 주변 피로감이 줄어듭니다.',
    },
    rightHip: {
      week24:
        '90/90 스트레칭과 CARs로 고관절 캡슐 가동성이 회복되기 시작하면 앉았다 일어날 때 "뚝"하는 느낌과 뻣뻣함이 감소합니다. Sahrmann의 연구에 따르면 고관절 가동성 회복은 요추 보상 움직임을 직접적으로 줄입니다.',
      week68:
        '고관절 굴곡 패턴이 정상화되면서 스쿼트·데드리프트 시 허리가 개입하는 보상 패턴이 사라집니다. 단측 동작(런지·스텝업)에서 좌우 균형감이 명확히 달라지고, 장시간 보행 후 고관절 주변 피로감이 줄어듭니다.',
    },
    leftAnkle: {
      week24:
        'Ankle CARs와 벽 드릴 2~3주 후 스쿼트 하강 시 발뒤꿈치가 들리지 않고 바닥에 붙어있는 느낌을 체감합니다. 발목 배굴 범위가 늘어나면 상체가 자연스럽게 직립하게 되어 허리 부하가 즉시 감소합니다.',
      week68:
        '비복근·가자미근의 점탄성이 회복되어 달리기·점프 후 착지 충격이 발목에서 효율적으로 흡수됩니다. Cook의 FMS에서 발목 가동성 정상화는 전신 운동 사슬의 가장 근본적인 변화로 제시되며, 스쿼트 깊이와 안정성이 함께 향상됩니다.',
    },
    rightAnkle: {
      week24:
        'Ankle CARs와 벽 드릴 2~3주 후 스쿼트 하강 시 발뒤꿈치가 들리지 않고 바닥에 붙어있는 느낌을 체감합니다. 발목 배굴 범위가 늘어나면 상체가 자연스럽게 직립하게 되어 허리 부하가 즉시 감소합니다.',
      week68:
        '비복근·가자미근의 점탄성이 회복되어 달리기·점프 후 착지 충격이 발목에서 효율적으로 흡수됩니다. Cook의 FMS에서 발목 가동성 정상화는 전신 운동 사슬의 가장 근본적인 변화로 제시되며, 스쿼트 깊이와 안정성이 함께 향상됩니다.',
    },
    leftShoulder: {
      week24:
        '소흉근 이완과 Face Pull 2~3주 후 팔을 들어올릴 때 어깨 앞쪽의 충돌감이 줄어듭니다. 견갑골 후인이 회복되면 앉아서 작업할 때 목·어깨 주변 만성 긴장이 감소하기 시작합니다.',
      week68:
        '견갑-상완 리듬이 정상화되어 오버헤드 동작에서 회전근개 부하가 줄어듭니다. Boyle의 연구에 따르면 흉추 가동성과 연계된 어깨 교정은 6~8주 후 벤치프레스·오버헤드 프레스 시 어깨 불편감을 유의미하게 감소시킵니다.',
    },
    rightShoulder: {
      week24:
        '소흉근 이완과 Face Pull 2~3주 후 팔을 들어올릴 때 어깨 앞쪽의 충돌감이 줄어듭니다. 견갑골 후인이 회복되면 앉아서 작업할 때 목·어깨 주변 만성 긴장이 감소하기 시작합니다.',
      week68:
        '견갑-상완 리듬이 정상화되어 오버헤드 동작에서 회전근개 부하가 줄어듭니다. Boyle의 연구에 따르면 흉추 가동성과 연계된 어깨 교정은 6~8주 후 벤치프레스·오버헤드 프레스 시 어깨 불편감을 유의미하게 감소시킵니다.',
    },
    hipShift: {
      week24:
        'Suitcase Carry와 Side Plank로 측면 코어(요방형근·중둔근)가 활성화되면 2~3주 내 한 발로 서거나 계단을 오를 때 골반이 덜 기우는 것을 느낍니다.',
      week68:
        '동적 골반 안정성이 확보되어 런닝·점프 착지 시 좌우 충격 분산이 대칭적으로 이루어집니다. 한쪽 무릎·고관절에 집중되던 누적 스트레스가 양측으로 균등하게 분산됩니다.',
    },
  };

  const changes = { week24: '', week68: '' };
  if (!criticals.length) {
    changes.week24 =
      '현재 움직임 패턴은 양호합니다. NSCA 기준으로 이 단계에서의 훈련은 신경근 효율성을 최적화하는 데 집중됩니다. 같은 무게로 더 깔끔하게, 더 적은 에너지로 움직이는 질적 향상이 먼저 나타납니다.';
    changes.week68 =
      '구조적 적응기에 접어들어 근력·지구력의 실질적 향상이 측정 가능한 수준으로 나타납니다. 부상 없이 점진적 과부하(Progressive Overload)를 적용할 수 있는 최적의 몸 상태가 형성됩니다.';
  } else {
    const topC = criticals[0];
    const topDB = changeDB[topC.jointKey];
    if (topDB) {
      changes.week24 = topDB.week24;
      changes.week68 = topDB.week68;
    } else {
      changes.week24 = `${topC.jointName} 교정이 진행되면서 2~3주 내 해당 부위의 움직임이 부드러워지고 보상 패턴이 줄어드는 것을 체감합니다.`;
      changes.week68 = `신경근 재교육이 완성되는 6~8주 후에는 교정된 패턴이 자동화되어 의식하지 않아도 올바른 움직임이 유지됩니다.`;
    }
  }

  // 5. PT 권장
  const ptRange = ptPlan?.totalRange || '12~20회';
  const totalSessions = ptPlan?.totalSessions || 12;
  let ptReason: string;
  if (!criticals.length) {
    ptReason = '현재 패턴을 더욱 고도화하고 부상 예방 기반을 만드는 데 최적입니다';
  } else {
    const recurrentCount = Object.values(rec).filter((d) => d.isRecurrent).length;
    if (recurrentCount >= 2) {
      ptReason = `반복 패턴이 ${recurrentCount}개 확인되었습니다. 혼자서는 교정이 어렵고, 전문가 피드백이 있어야 빠르게 개선됩니다`;
    } else if (criticals.length >= 2) {
      ptReason = '두 곳 이상에서 문제가 확인되었습니다. 체계적인 단계별 접근이 필요합니다';
    } else {
      ptReason = '발견된 패턴을 교정하고 올바른 움직임을 완전히 자동화하는 데 필요한 기간입니다';
    }
  }

  return {
    conclusion: stripHtml(conclusion),
    problems,
    whyItems,
    changes,
    ptRange,
    ptReason,
    totalSessions,
  };
}

/* ───────────────────────────────────────────────────────────
 * 세일즈 스크립트 5단계 (web v17 8783-8880)
 * ─────────────────────────────────────────────────────────── */
function buildSalesScriptV5(args: BuildSummaryArgs): SalesScriptStage[] {
  const { criticals, member, recurrence, signature, ptPlan, totalReps, isOhs } = args;
  const rec = recurrence ?? {};
  const sig = signature ?? ({} as VideoSignature);
  const goal = member?.goal || 'general';
  const name = member?.name || '회원';
  const ptRange = ptPlan?.totalRange || '12~20회';

  const recurrentIssues = Object.entries(rec).filter(([, d]) => d.isRecurrent);
  const hasRecurrent = recurrentIssues.length > 0;

  // 1단계: 문제 요약
  let step1: string;
  if (!criticals.length) {
    step1 = `${name}님, 오늘 분석 결과 안정성 ${sig.avgStability ?? '-'}점으로 전반적으로 양호합니다. 몇 가지 예방적 관리 포인트가 있습니다.`;
  } else {
    const top = criticals[0];
    const topDev = top ? Math.round(devOf(top.angle, top.normalRange)) : 0;
    const topName = top ? PLAIN_JOINT_NAME[top.jointKey] || top.jointName : '';
    let core = `${name}님, 오늘 분석에서 ${topName}에서 ${topDev}° 이탈 패턴이 가장 두드러졌습니다.`;
    if (isOhs && hasRecurrent) {
      const topRec = recurrentIssues[0][1];
      core += ` 이 패턴은 ${totalReps}회 중 ${topRec.count}회 반복되어 일시적 흔들림이 아닌 습관화된 패턴으로 보입니다.`;
    }
    if (sig.leftRightDiff !== undefined && sig.leftRightDiff >= 12) {
      core += ` 좌우 ${sig.leftRightJoint || ''} 차이도 ${sig.leftRightDiff}°로 불균형이 확인됩니다.`;
    }
    step1 = core;
  }

  // 2단계: 위험성
  let step2: string;
  if (!criticals.length) {
    step2 =
      '지금 당장 문제는 없지만, 현재 패턴이 굳어지면 교정이 어려워집니다. 예방적 접근이 가장 효율적입니다.';
  } else {
    const goalRisk: Record<string, string> = {
      weight: `안정성 ${sig.avgStability ?? '-'}점 수준에서 강도를 올리면 효율보다 부상 위험이 먼저 올라갑니다.`,
      performance: `현재 이탈 패턴(최대 ${sig.dominantDeviation || 0}°)이 계속되면 중량 증가 시 관절 부하가 기하급수적으로 쌓입니다.`,
      rehab: '잘못된 보상 패턴이 재활 진행을 방해할 수 있습니다.',
      general: `이탈 각도 ${sig.dominantDeviation || 0}°가 반복되면 통증 없이도 관절 마모가 진행됩니다.`,
    };
    const painfx = member?.painAreas
      ? ` 현재 ${member.painAreas} 불편감이 이 패턴과 직결될 수 있습니다.`
      : '';
    step2 = (goalRisk[goal] || goalRisk.general) + painfx;
  }

  // 3단계: 변화 가능성
  const goalChange: Record<string, string> = {
    weight: '패턴 교정 후 같은 시간 운동해도 효율이 눈에 띄게 달라집니다.',
    performance:
      '기초를 다지면 중량 증가 속도가 빨라집니다. 지금 2~4주 투자가 나중 몇 달을 아낍니다.',
    rehab: '올바른 움직임이 잡히면 통증이 줄고 일상 동작이 편해집니다.',
    general: '자세가 달라지면 운동 효율과 일상 피로감 모두 개선됩니다.',
  };
  const worstRepTxt = sig.worstRepNum ? ` (${sig.worstRepNum}번째 반복이 가장 흔들렸습니다)` : '';
  const step3 =
    (goalChange[goal] || goalChange.general) +
    ` 대부분 ${criticals.length > 1 ? '3~4주' : '2~3주'} 안에 변화가 나타납니다${worstRepTxt}.`;

  // 4단계: PT 필요성
  let step4: string;
  if (hasRecurrent) {
    step4 = `이 패턴은 실시간 피드백 없이 혼자 교정하기 매우 어렵습니다. ${totalReps}회 중 ${recurrentIssues[0][1].count}회 반복이 확인된 만큼, 본인이 어느 순간 무너지는지 혼자서는 감지하기 어렵습니다. 전문가가 즉각 피드백을 줄 때 가장 빠르게 바뀝니다.`;
  } else if (criticals.length >= 2) {
    step4 = `두 곳 이상에서 패턴이 확인되었습니다. 각각을 순서대로 체계적으로 잡아야 하므로 전문가와 단계적으로 진행하는 것이 가장 효율적입니다.`;
  } else {
    step4 = `발견된 패턴을 완전히 자동화하려면 전문가 피드백과 함께 반복 훈련이 필요합니다. 느낌만으로 됐다고 판단하기 어렵습니다.`;
  }

  // 5단계: 행동 유도
  const step5 = `권장 PT는 ${ptRange}입니다. 초기 교정 → 패턴 안정화 → 강화 순서로 진행합니다. 지금 시작하시면 가장 빠르게 교정할 수 있는 타이밍입니다.`;

  return [
    { step: 1, label: '분석 결과 요약', text: stripHtml(step1) },
    { step: 2, label: '방치했을 때 위험', text: stripHtml(step2) },
    { step: 3, label: '개선 가능성', text: stripHtml(step3) },
    { step: 4, label: '트레이너가 필요한 이유', text: stripHtml(step4) },
    { step: 5, label: '지금 시작해야 하는 이유', text: stripHtml(step5) },
  ];
}

/* ───────────────────────────────────────────────────────────
 * PT 회차 계산 + 단계 커리큘럼 (web v17 8885-9286)
 * ─────────────────────────────────────────────────────────── */
function calcPtPlan(
  criticals: Capture[],
  member: Member | null,
  recurrence: Record<string, RecurrenceData>,
): PtPlan {
  const goal = member?.goal || 'general';
  const rec = recurrence ?? {};
  const hasRecurrent = Object.values(rec).some((d) => d.isRecurrent);
  const factors: string[] = [];

  let base = 10;

  const recurrentCount = Object.values(rec).filter((d) => d.isRecurrent).length;
  if (recurrentCount >= 3) {
    base += 10;
    factors.push('반복 패턴 3개+ → +10회');
  } else if (recurrentCount === 2) {
    base += 7;
    factors.push('반복 패턴 2개 → +7회');
  } else if (recurrentCount === 1) {
    base += 4;
    factors.push('반복 패턴 1개 → +4회');
  } else if (criticals.length >= 2) {
    base += 4;
    factors.push('교정 필요 2개+ → +4회');
  } else if (criticals.length === 1) {
    base += 2;
    factors.push('교정 필요 1개 → +2회');
  }

  if (member?.asymmetry === 'significant') {
    base += 5;
    factors.push('심한 좌우 불균형 → +5회');
  } else if (member?.asymmetry === 'minor') {
    base += 2;
    factors.push('경미한 불균형 → +2회');
  }

  if (member?.injuryHistory) {
    base += 3;
    factors.push('부상 이력 → +3회(안전)');
  } else if (member?.painAreas) {
    base += 2;
    factors.push('통증 부위 → +2회');
  }

  if (goal === 'performance') {
    base += 3;
    factors.push('퍼포먼스 목표 → +3회');
  } else if (goal === 'rehab') {
    base += 4;
    factors.push('재활 목표 → +4회');
  }

  if (member?.experience === 'beginner') {
    base += 3;
    factors.push('초급 → +3회');
  }

  base = Math.min(base, 30);

  const range =
    base <= 12 ? '10~12회' : base <= 18 ? '15~18회' : base <= 24 ? '20~24회' : '25~30회';

  const issueKeys = new Set(criticals.map((c) => c.jointKey));
  const hasSpineIssue = issueKeys.has('spine');
  const hasKneeIssue = issueKeys.has('leftKnee') || issueKeys.has('rightKnee');
  const hasHipIssue = issueKeys.has('leftHip') || issueKeys.has('rightHip');
  const hasAnkleIssue = issueKeys.has('leftAnkle') || issueKeys.has('rightAnkle');
  const hasShoulderIssue = issueKeys.has('leftShoulder') || issueKeys.has('rightShoulder');

  const curriculumDB = CURRICULUM_DB;
  const currKey = hasSpineIssue
    ? 'spine'
    : hasKneeIssue
      ? 'knee'
      : hasHipIssue
        ? 'hip'
        : hasAnkleIssue
          ? 'ankle'
          : hasShoulderIssue
            ? 'shoulder'
            : 'general';
  const curr = curriculumDB[currKey];

  const phases: PtPlanPhase[] = [];
  if (base <= 12) {
    phases.push({
      num: 1,
      range: '1~4회',
      color: '#ef4444',
      goal: curr.p1.goal,
      why: curr.p1.why,
      exercises: curr.p1.exercises,
    });
    phases.push({
      num: 2,
      range: '5~9회',
      color: '#f59e0b',
      goal: curr.p2.goal,
      why: curr.p2.why,
      exercises: curr.p2.exercises,
    });
    if (base > 10) {
      phases.push({
        num: 3,
        range: `10~${base}회`,
        color: '#22c55e',
        goal: curr.p3.goal,
        why: curr.p3.why,
        exercises: curr.p3.exercises,
      });
    }
  } else if (base <= 18) {
    phases.push({
      num: 1,
      range: '1~5회',
      color: '#ef4444',
      goal: curr.p1.goal,
      why: curr.p1.why,
      exercises: curr.p1.exercises,
    });
    phases.push({
      num: 2,
      range: '6~12회',
      color: '#f59e0b',
      goal: curr.p2.goal,
      why: curr.p2.why,
      exercises: curr.p2.exercises,
    });
    phases.push({
      num: 3,
      range: `13~${base}회`,
      color: '#22c55e',
      goal: curr.p3.goal,
      why: curr.p3.why,
      exercises: curr.p3.exercises,
    });
  } else {
    const mid = Math.floor(base * 0.6);
    phases.push({
      num: 1,
      range: '1~6회',
      color: '#ef4444',
      goal: curr.p1.goal,
      why: curr.p1.why,
      exercises: curr.p1.exercises,
    });
    phases.push({
      num: 2,
      range: '7~14회',
      color: '#f59e0b',
      goal: curr.p2.goal,
      why: curr.p2.why,
      exercises: curr.p2.exercises,
    });
    phases.push({
      num: 3,
      range: `15~${mid}회`,
      color: '#06b6d4',
      goal: curr.p3.goal,
      why: curr.p3.why,
      exercises: curr.p3.exercises,
    });
    phases.push({
      num: 4,
      range: `${mid + 1}~${base}회`,
      color: '#22c55e',
      goal: '재평가 & 고도화',
      why: 'NSCA 권장: 8~12주 훈련 후 반드시 재평가를 통해 이슈 해소 여부를 확인하고, 해소된 패턴에서는 점진적 과부하를 적용합니다.',
      exercises: [
        'FMS 재스크리닝 (초기 대비 비교)',
        '점진적 과부하 복합 운동',
        '스포츠·생활 동작 적용 훈련',
        '자가 교정 프로그램 구성',
      ],
    });
  }

  let trainerMsg: string;
  if (hasRecurrent) {
    trainerMsg = `반복 패턴이 확인된 경우, 실시간 피드백 없이는 교정이 어렵습니다. 자신이 어느 순간 패턴이 무너지는지 혼자서는 감지하기 어렵기 때문입니다.`;
  } else {
    trainerMsg = `올바른 패턴이 완전히 자동화될 때까지 전문가의 주기적인 확인이 필요합니다. 느낌만으로 교정됐다고 판단하기 어렵습니다.`;
  }

  return {
    totalSessions: base,
    totalRange: range,
    basis: factors.join(' / '),
    phases,
    trainerMsg,
  };
}

/* ───────────────────────────────────────────────────────────
 * PT 커리큘럼 DB (calcPtPlan 내부에서 큰 객체로 분리)
 * ─────────────────────────────────────────────────────────── */
interface CurriculumStage {
  goal: string;
  why: string;
  exercises: string[];
}
interface CurriculumEntry {
  p1: CurriculumStage;
  p2: CurriculumStage;
  p3: CurriculumStage;
}

const CURRICULUM_DB: Record<string, CurriculumEntry> = {
  spine: {
    p1: {
      goal: '척추 안정화 & 호흡 패턴',
      why: 'McGill의 연구에 따르면 척추 안정화 운동 순서는 ①호흡(복압 형성) → ②등척성 수축 → ③동적 부하 순이어야 합니다. 이 단계를 건너뛰면 강화 운동이 오히려 보상 패턴을 강화합니다.',
      exercises: [
        '복식 호흡 + IAP(복강내압) 훈련 3×5회 10초',
        'McGill Curl-up 2×8회 (목 중립 유지)',
        '90/90 Hip Lift 2×5회 (횡격막-골반저 연결)',
        '캣-카우 분절 가동 2×10회',
      ],
    },
    p2: {
      goal: '심부 코어 신경근 재교육',
      why: 'NSCA 기준 신경근 적응은 주 3~4회 × 4~6주가 필요합니다. Dead Bug와 Bird Dog는 복횡근·다열근의 공동 수축을 요구하며, McGill이 허리 안정화의 핵심으로 제시한 운동입니다.',
      exercises: [
        'Dead Bug 3×8회 (요추 바닥 고정 확인)',
        'Bird Dog 3×8회 5초 정지 (견갑-고관절 대각선 패턴)',
        'McGill Side Plank 3×20초 (최대 60초까지 progression)',
        'Pallof Press 3×10회 (반회전 저항 훈련)',
      ],
    },
    p3: {
      goal: '기능적 패턴 통합 & 점진적 부하',
      why: 'Boyle의 New Functional Training에서 척추 안정화 이후 힙 힌지 패턴을 가장 먼저 부하화하도록 권장합니다. 척추 중립을 유지한 채 고관절이 주도하는 패턴이 완성되면 복합 운동으로 이행합니다.',
      exercises: [
        'Trap Bar Deadlift 또는 KB Deadlift 3×8회',
        'Goblet Squat 3×10회 (척추 중립 큐잉 병행)',
        'Single Arm KB Row 3×10회 (안정화 유지)',
        '점진적 중량 추가 (매 2회 5~10% 증가)',
      ],
    },
  },
  knee: {
    p1: {
      goal: '중둔근 활성화 & 대퇴근막 이완',
      why: 'Boyle의 Joint-by-Joint 이론: 무릎 Valgus의 근본 원인은 고관절 외회전근(중둔근) 억제에 있습니다. 억제된 근육을 깨우기 전에 과활성화된 길항근(TFL·IT밴드)을 먼저 이완해야 합니다.',
      exercises: [
        'TFL·IT밴드 폼롤러 SMR 각 60초',
        'Clamshell (루프밴드) 3×20회 — 골반 회전 없이',
        'Side-lying Hip Abduction 3×15회 (무게 없이 정확성 우선)',
        '엎드려 Hip External Rotation 2×15회',
      ],
    },
    p2: {
      goal: '무릎 추적 패턴 재교육',
      why: "Cook의 FMS 교정 전략: 무릎 추적은 고관절-발목 연결 사슬에서 결정됩니다. Mini-band를 활용해 외회전 피드백을 제공하면 신경근 재교육 속도가 빨라집니다.",
      exercises: [
        'Mini-band Side Walk 3×15걸음 (무릎 외회전 의식)',
        'Mini-band Squat 3×12회 (무릎이 2번째 발가락 위 큐잉)',
        'Step-up 3×10회 (무릎 추적 확인하며)',
        'Bulgarian Split Squat 2×8회 (약한 쪽 먼저)',
      ],
    },
    p3: {
      goal: '단측 하지 강화 & 동적 안정화',
      why: 'NSCA 기준 단측 운동은 양측 대비 고관절 외전근 활성도가 30% 높아 무릎 안정화에 더 효과적입니다. 이 단계에서 통증 없는 착지 패턴까지 완성합니다.',
      exercises: [
        'Single Leg Squat (TRX 보조) 3×8회',
        'Lateral Step Down 3×10회 (편심성 제어)',
        'KB Suitcase Carry 3×20m (골반 수평 유지)',
        '점진적 점프 착지 훈련 (양발→한발)',
      ],
    },
  },
  hip: {
    p1: {
      goal: '고관절 가동성 회복 & 굴곡근 이완',
      why: 'Sahrmann의 Movement Impairment Syndromes: 고관절 굴곡근 단축이 골반 전방 경사를 유발하고, 이것이 요추 과신전으로 이어지는 연쇄를 끊는 것이 우선입니다.',
      exercises: [
        '90/90 Hip Stretch 각 자세 60초 (앞·뒤 모두)',
        '반무릎 Hip Flexor Stretch 2×45초',
        'Hip CARs (Controlled Articular Rotations) 2×5회',
        'Thomas Test Stretch 2×45초 (장요근 대상)',
      ],
    },
    p2: {
      goal: '힙 힌지 패턴 & 후방 체인 활성화',
      why: 'Boyle의 New Functional Training: 힙 힌지는 모든 하체 복합 운동의 기반 패턴입니다. 가동성이 회복된 후 즉시 패턴화하지 않으면 근육이 다시 짧아집니다.',
      exercises: [
        'Dowel Hip Hinge 3×12회 (척추 3점 접촉 확인)',
        'KB Deadlift 3×10회 (고관절 주도 강조)',
        'Single Leg RDL (무게 없이) 3×8회',
        'Glute Bridge 3×12회 5초 정지',
      ],
    },
    p3: {
      goal: '복합 하체 패턴 강화',
      why: 'Dan John의 Intervention: 힙 힌지 패턴이 안정화되면 스쿼트 패턴과 통합하여 전신 하체 기능을 완성합니다. Carry 운동으로 동적 안정성을 마무리합니다.',
      exercises: [
        'Trap Bar Deadlift 3×8회 (점진적 부하)',
        'Goblet Squat to Box 3×10회',
        'Lateral Lunge 3×8회 (고관절 외전·굴곡 통합)',
        'Farmer Carry 3×30m',
      ],
    },
  },
  ankle: {
    p1: {
      goal: '발목 배굴 가동성 & 연부조직 이완',
      why: 'Cook의 FMS에서 발목 배굴 제한은 전신 운동 사슬의 가장 하위 제한 요소입니다. 이것이 해결되지 않으면 무릎·고관절·척추의 보상이 반복됩니다.',
      exercises: [
        '비복근 스트레칭 (무릎 펴고) 2×45초',
        '가자미근 스트레칭 (무릎 구부리고) 2×45초',
        '벽 발목 배굴 드릴 2×10회 (5cm 거리에서 시작)',
        'Ankle CARs 2×5회 (완전 가동 범위)',
      ],
    },
    p2: {
      goal: '기능적 배굴 재훈련 & 체중 부하',
      why: '발목 가동성은 체중 부하 하에서 훈련해야 기능으로 전환됩니다. Boyle: 발목 가동성 훈련 없이 스쿼트 깊이를 늘리면 무릎·허리에 부하가 전가됩니다.',
      exercises: [
        'Heel Elevated Goblet Squat 3×10회 (점진적 heel 낮추기)',
        '발목 저항 밴드 배굴 강화 3×15회',
        'Single Leg Calf Raise 3×15회 (편심성 포함)',
        'Slant Board Squat 3×10회',
      ],
    },
    p3: {
      goal: '동적 발목 안정성 & 하체 패턴 통합',
      why: 'NSCA: 발목 고유수용감각 훈련은 단순 가동성보다 부상 예방 효과가 높습니다. 이 단계에서 정상 발목 기능으로 전체 스쿼트 패턴을 완성합니다.',
      exercises: [
        'Single Leg Balance (눈 감기 progression)',
        'Box Step-down 3×10회 (발목 제어)',
        'Full Depth Goblet Squat 3×10회 (heel flat)',
        '점프 착지 + 발목 충격 흡수 훈련',
      ],
    },
  },
  shoulder: {
    p1: {
      goal: '어깨 가동성 회복 & 소흉근 이완',
      why: 'Boyle: 어깨 충돌 증후군의 75%는 흉추 가동성 부족 및 소흉근 단축에서 기인합니다. 회전근개를 강화하기 전에 반드시 제한된 구조물을 풀어야 합니다.',
      exercises: [
        '소흉근 도어웨이 스트레칭 2×45초',
        '흉추 폼롤러 익스텐션 2×10회',
        'Wall Angel 2×10회 (등·머리·엉덩이 벽 접촉)',
        'Sleeper Stretch 2×45초 (내회전 제한 시)',
      ],
    },
    p2: {
      goal: '견갑골 안정화 & 회전근개 활성화',
      why: 'Sahrmann: 견갑골 안정화 없이 오버헤드 동작을 진행하면 상부 승모근이 보상 과활성화됩니다. YTW 운동은 하부 승모근·전거근을 선택적으로 강화합니다.',
      exercises: [
        '밴드 Face Pull 3×15회 (외회전 마지막 1/3 강조)',
        'YTW 운동 2×10회 (각 자세)',
        'KB Bottoms-up Press 2×8회 (회전근개 공동 수축)',
        'Side-lying External Rotation 3×15회',
      ],
    },
    p3: {
      goal: '오버헤드 패턴 & 상체 복합 강화',
      why: "Dan John의 Push·Pull 균형 원칙: 프레스 운동 1세트당 로우 운동 2세트를 권장합니다. 이 비율로 어깨 전·후방 균형을 유지합니다.",
      exercises: [
        'Half-kneeling KB Press 3×8회 (코어 연결)',
        'Seated Cable Row 3×12회',
        'Landmine Press 3×10회 (오버헤드 진입 전 단계)',
        'Pull-up 또는 Lat Pulldown 3×10회',
      ],
    },
  },
  general: {
    p1: {
      goal: '전신 이동성 & 기초 패턴 평가',
      why: 'Cook의 FMS 원칙: 문제가 명확하지 않을 때는 전신 7개 패턴을 균등하게 점검하며 제한점을 찾는 것이 우선입니다.',
      exercises: [
        '전신 CARs 루틴 (관절별 10분)',
        'FMS 스크리닝 7개 패턴 재확인',
        '호흡·코어 기초 (복식호흡 + IAP)',
        '기초 힙 힌지 & 스쿼트 패턴 확인',
      ],
    },
    p2: {
      goal: '기본 움직임 패턴 강화',
      why: 'Dan John의 5패턴(Push·Pull·Hinge·Squat·Carry)을 균등하게 훈련하면 신체 불균형 없이 전반적인 기능을 향상시킬 수 있습니다.',
      exercises: [
        'Goblet Squat 3×10회',
        'KB Deadlift 3×10회',
        'Push-up 3×10회',
        'TRX Row 3×12회',
        'Farmer Carry 3×30m',
      ],
    },
    p3: {
      goal: '점진적 부하 & 복합 운동 통합',
      why: 'NSCA Progressive Overload 원칙: 기본 패턴이 안정화된 후 매 2주마다 5~10% 부하 증가를 적용합니다.',
      exercises: [
        'Barbell Back Squat 또는 Trap Bar DL 3×8회',
        'Bench Press + Bent-over Row 3×10회',
        'Turkish Get-up 2×3회 (전신 통합)',
        '운동별 1RM 측정 & 목표 설정',
      ],
    },
  },
};

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
  buildMemberSummary,
  buildSalesScriptV5,
  calcPtPlan,
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
  buildMemberSummary,
  buildSalesScriptV5,
  calcPtPlan,
};
