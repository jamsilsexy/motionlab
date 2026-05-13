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
  ComparisonChange,
  ComparisonResult,
  ExerciseRef,
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

  // 측면 OHS는 시상면(sagittal plane) 분석 — 좌우 구분이 의미 없음.
  // 이전 버전은 leftX/rightX 모두 동일한 평균값을 주입해 buildCapturesFromBestFrames가
  //   양쪽 모두 critical로 잡고 리포트에 좌우 중복 표시되는 버그가 있었음.
  // → leftX 키에만 채우고 rightX는 null로 두어 중복 제거.
  //   (라벨 '왼쪽 무릎'은 측면일 때 시상면 무릎을 가리키는 통합 표현)
  const angles: JointAngles = {
    leftKnee: kneeRaw !== null ? Math.round(kneeRaw) : null,
    rightKnee: null,
    leftHip: hipRaw !== null ? Math.round(hipRaw) : null,
    rightHip: null,
    leftAnkle: ankleRaw !== null ? Math.round(ankleRaw) : null,
    rightAnkle: null,
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
    // ★ SquatTracker.bestFrames(관절별 최악 frame) → captures 시드.
    //   web v17은 frame-by-frame addCapture 패턴이었으나, mobile은 SquatTracker가
    //   누적한 issueBest를 finalize 시점에 한번에 변환. 이거 안 하면 captures 빈 채로
    //   ExpertFilter.selectCriticals → criticals 0개 → 점수 100 고정.
    const seedCaptures = SquatTracker.buildCapturesFromBestFrames();
    SH.setResult({ captures: seedCaptures });
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
      // QC fix: 같은 jointKey가 ohs_front/ohs_side 양쪽에서 발견되면
      //   더 심각한 (deviation 큰) 쪽을 유지해야 함. 기존 코드는 먼저 본 것만 keep → milder 결과 노출
      const existingIdx = mergedCriticals.findIndex((m) => m.jointKey === c.jointKey);
      if (existingIdx < 0) {
        seenJointKeys.add(c.jointKey);
        mergedCriticals.push(c);
      } else {
        const existing = mergedCriticals[existingIdx];
        const newDev = devOf(c.angle, c.normalRange);
        const existDev = devOf(existing.angle, existing.normalRange);
        if (newDev > existDev) {
          mergedCriticals[existingIdx] = c;
        }
      }
    });
  });

  // QC fix: severity 정렬 후 slice — 단순 insertion-order slice는 더 나쁜 이슈를 누락
  mergedCriticals.sort((a, b) => devOf(b.angle, b.normalRange) - devOf(a.angle, a.normalRange));
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

/* ───────────────────────────────────────────────────────────
 * 회원 친화 부상/일상불편 DB (관절별)
 *
 * painRisk: 반복 시 발생 가능한 통증 (한 줄 요약)
 * dailyImpact: 현재 일상에서 느낄 수 있는 불편
 * cascade: 단기/중기/장기 부상 누적 시나리오 (구체적 부상명 + 시간 단위)
 * ─────────────────────────────────────────────────────────── */
const PAIN_RISK_DB: Record<string, string> = {
  spine: '계속되면 디스크 후방 압력이 누적돼 허리디스크 발병 위험이 올라가요.',
  leftKnee: '심해지면 무릎 안쪽 반월상연골/내측측부인대 손상으로 이어져요.',
  rightKnee: '심해지면 무릎 안쪽 반월상연골/내측측부인대 손상으로 이어져요.',
  leftHip: '허리가 보상하면서 만성 요통, 좌골신경통 위험이 커져요.',
  rightHip: '허리가 보상하면서 만성 요통, 좌골신경통 위험이 커져요.',
  leftAnkle: '무릎/허리가 보상하면서 슬개대퇴 통증, 만성 요통으로 번져요.',
  rightAnkle: '무릎/허리가 보상하면서 슬개대퇴 통증, 만성 요통으로 번져요.',
  leftShoulder: '어깨 충돌증후군, 회전근개 미세파열로 발전할 수 있어요.',
  rightShoulder: '어깨 충돌증후군, 회전근개 미세파열로 발전할 수 있어요.',
};

const DAILY_IMPACT_DB: Record<string, string> = {
  spine: '오래 앉아있을 때 허리 뻐근함, 아침에 일어날 때 허리 뻣뻣함.',
  leftKnee: '계단 내려갈 때 무릎 시큰거림, 오래 서 있으면 무릎 욱신.',
  rightKnee: '계단 내려갈 때 무릎 시큰거림, 오래 서 있으면 무릎 욱신.',
  leftHip: '양반다리 어렵거나 오래 걸으면 골반/엉덩이 주변 뻐근함.',
  rightHip: '양반다리 어렵거나 오래 걸으면 골반/엉덩이 주변 뻐근함.',
  leftAnkle: '오래 서 있으면 종아리 뭉침, 계단 오를 때 발목 뻑뻑함.',
  rightAnkle: '오래 서 있으면 종아리 뭉침, 계단 오를 때 발목 뻑뻑함.',
  leftShoulder: '팔을 머리 위로 들 때 어깨 앞쪽 결림, 책상 작업 시 목/어깨 결림.',
  rightShoulder: '팔을 머리 위로 들 때 어깨 앞쪽 결림, 책상 작업 시 목/어깨 결림.',
};

/**
 * 누적 부상 시나리오 — 단기 (1-3개월) / 중기 (3-12개월) / 장기 (1-3년+).
 * 임상적으로 흔한 진행 패턴을 회원 친화 언어로 표현. 정량 시간 단위로 위급성 인식 ↑.
 */
const CASCADE_DB: Record<string, { short: string; mid: string; long: string }> = {
  spine: {
    short: '몇 주 안에 허리가 자주 묵직해지고, 무거운 물건 들 때 찌릿한 느낌이 시작돼요.',
    mid: '3-12개월 사이에 만성 요통이 자리 잡고, 요추 디스크가 부풀어 신경을 누르기 시작해요.',
    long: '1-3년이 지나면 디스크 탈출(추간판 탈출증)로 다리 저림(좌골신경통)까지 와서, 일상 보행도 어려워질 수 있어요.',
  },
  leftKnee: {
    short: '몇 주 안에 계단 내려갈 때 시큰거림, 운동 후 무릎 욱신거림이 잦아져요.',
    mid: '3-12개월 사이에 슬개대퇴 통증증후군(주자무릎)이 자리 잡고, 무릎 안쪽 인대가 약해져요.',
    long: '1-3년이 지나면 반월상연골 손상이나 슬개골 연골연화증으로 진행돼 수술 단계에 들어갈 수 있어요.',
  },
  rightKnee: {
    short: '몇 주 안에 계단 내려갈 때 시큰거림, 운동 후 무릎 욱신거림이 잦아져요.',
    mid: '3-12개월 사이에 슬개대퇴 통증증후군(주자무릎)이 자리 잡고, 무릎 안쪽 인대가 약해져요.',
    long: '1-3년이 지나면 반월상연골 손상이나 슬개골 연골연화증으로 진행돼 수술 단계에 들어갈 수 있어요.',
  },
  leftHip: {
    short: '몇 주 안에 오래 걸으면 골반 주변이 뻐근하고, 양반다리가 점점 어려워져요.',
    mid: '3-12개월 사이에 고관절 충돌증후군(FAI)이 의심되고, 허리가 대신 일하면서 만성 요통이 시작돼요.',
    long: '1-3년이 지나면 고관절 관절순(라브룸) 파열이나 초기 고관절염으로 진행될 수 있어요.',
  },
  rightHip: {
    short: '몇 주 안에 오래 걸으면 골반 주변이 뻐근하고, 양반다리가 점점 어려워져요.',
    mid: '3-12개월 사이에 고관절 충돌증후군(FAI)이 의심되고, 허리가 대신 일하면서 만성 요통이 시작돼요.',
    long: '1-3년이 지나면 고관절 관절순(라브룸) 파열이나 초기 고관절염으로 진행될 수 있어요.',
  },
  leftAnkle: {
    short: '몇 주 안에 종아리가 자주 뭉치고, 아킬레스 부근이 뻑뻑해져요.',
    mid: '3-12개월 사이에 족저근막염, 아킬레스건염이 발생하고 무릎/허리가 대신 일해요.',
    long: '1-3년이 지나면 평발 진행, 발목 관절염이 오면서 운동 자체가 어려운 상태로 갈 수 있어요.',
  },
  rightAnkle: {
    short: '몇 주 안에 종아리가 자주 뭉치고, 아킬레스 부근이 뻑뻑해져요.',
    mid: '3-12개월 사이에 족저근막염, 아킬레스건염이 발생하고 무릎/허리가 대신 일해요.',
    long: '1-3년이 지나면 평발 진행, 발목 관절염이 오면서 운동 자체가 어려운 상태로 갈 수 있어요.',
  },
  leftShoulder: {
    short: '몇 주 안에 팔 들 때 어깨 앞 결림, 책상 작업 후 목/어깨 결림이 자주 와요.',
    mid: '3-12개월 사이에 어깨 충돌증후군이 자리 잡고, 회전근개 미세파열이 시작돼요.',
    long: '1-3년이 지나면 회전근개 완전파열 또는 오십견(유착성 관절낭염)으로 진행돼 팔이 안 올라갈 수 있어요.',
  },
  rightShoulder: {
    short: '몇 주 안에 팔 들 때 어깨 앞 결림, 책상 작업 후 목/어깨 결림이 자주 와요.',
    mid: '3-12개월 사이에 어깨 충돌증후군이 자리 잡고, 회전근개 미세파열이 시작돼요.',
    long: '1-3년이 지나면 회전근개 완전파열 또는 오십견(유착성 관절낭염)으로 진행돼 팔이 안 올라갈 수 있어요.',
  },
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
  // hasHip은 cascade chain 그룹화용으로 유지(현재 whyItems에선 직접 미사용, 향후 grouping에 사용 예정)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const hasHip = criticals.some((c) => c.jointKey.includes('Hip'));
  const hasAnkle = criticals.some((c) => c.jointKey.includes('Ankle'));
  const hasShoulder = criticals.some((c) => c.jointKey.includes('Shoulder'));

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

    let core = `${topName}이(가) 평소보다 ${topDev}° 정도 벗어나 있어요${topRecStr}.`;
    if (sig.leftRightDiff !== undefined && sig.leftRightDiff >= 12) {
      core += ` 왼쪽과 오른쪽 ${sig.leftRightJoint || '관절'} 차이가 ${sig.leftRightDiff}°라서 한쪽으로 쏠려있어요.`;
    }
    if (sig.consistencyScore !== undefined && sig.consistencyScore < 65) {
      core += ` 반복할 때마다 자세가 들쑥날쑥해요(일관성 ${sig.consistencyScore}점). 피곤해지면 다칠 위험이 높아져요.`;
    }
    conclusion = core;
  }

  const goalSuffix: Record<string, string> = {
    weight: '이대로 운동 강도를 높이면 살 빼는 효과보다 다칠 위험이 먼저 올라가요.',
    performance:
      `안정성 ${sig.avgStability ?? '-'}점이에요. ` +
      (sig.dominantJoint
        ? `${PLAIN_JOINT_NAME[sig.dominantJoint] || sig.dominantJoint} 자세를 그대로 두고 무게를 더 들면`
        : '이 자세 그대로 무게를 더 들면') +
      ' 다칠 수 있어요.',
    rehab: '지금 자세를 잡는 게 가장 빠른 회복법이에요.',
    general: '평소 일상 동작에서도 같은 자세가 반복될 가능성이 있어요.',
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
      spine: '허리가 굽어요',
      leftKnee: '왼쪽 무릎이 안으로 쏠려요',
      rightKnee: '오른쪽 무릎이 안으로 쏠려요',
      leftHip: '왼쪽 엉덩이 관절이 잘 안 굽어요',
      rightHip: '오른쪽 엉덩이 관절이 잘 안 굽어요',
      leftAnkle: '왼쪽 발목이 잘 안 굽어요',
      rightAnkle: '오른쪽 발목이 잘 안 굽어요',
      leftShoulder: '왼쪽 어깨가 비뚤어요',
      rightShoulder: '오른쪽 어깨가 비뚤어요',
    };

    const plainDescs: Record<string, string> = {
      spine: `허리를 잡아주는 힘이 약해서 ${dev}° 정도 휘어요.`,
      leftKnee: `엉덩이 옆 근육이 약해서 허벅지가 안쪽으로 돌아가고, 무릎이 ${dev}° 정도 안으로 무너져요.`,
      rightKnee: `엉덩이 옆 근육이 약해서 허벅지가 안쪽으로 돌아가고, 무릎이 ${dev}° 정도 안으로 무너져요.`,
      leftHip: `엉덩이 관절이 ${dev}° 정도 잘 안 굽혀져요. 깊이 앉을 때 골반이 뒤로 말려요.`,
      rightHip: `엉덩이 관절이 ${dev}° 정도 잘 안 굽혀져요. 깊이 앉을 때 골반이 뒤로 말려요.`,
      leftAnkle: `발목이 앞으로 ${dev}° 정도 잘 안 굽혀져요. 그래서 몸이 앞으로 쏠려요.`,
      rightAnkle: `발목이 앞으로 ${dev}° 정도 잘 안 굽혀져요. 그래서 몸이 앞으로 쏠려요.`,
      leftShoulder: `어깨 균형이 ${dev}° 정도 어긋나 있어요. 등이 굳어 있을 때 자주 같이 나타나요.`,
      rightShoulder: `어깨 균형이 ${dev}° 정도 어긋나 있어요. 등이 굳어 있을 때 자주 같이 나타나요.`,
    };

    const painRisk = PAIN_RISK_DB[c.jointKey];
    const dailyImpact = DAILY_IMPACT_DB[c.jointKey];
    const cascade = CASCADE_DB[c.jointKey];

    return {
      jointKey: c.jointKey,
      name: plainNames[c.jointKey] || c.jointName,
      desc: plainDescs[c.jointKey] || `${dev}° 정도 자세가 벗어나 있어요`,
      severity: c.severity,
      repCount,
      repTotal,
      deviation: dev,
      isRecurrent: repData?.isRecurrent || false,
      painRisk,
      dailyImpact,
      cascade,
      frameDataUri: c.frameDataUri,
      landmarks: c.landmarks,
      timeMs: c.timeMs,
      capRepIndex: c.repIndex,
    };
  });

  // 3. 왜 문제인가 — 구체적 부상명 + 누적 메커니즘 + 정량 수치 활용
  const whyItems: { icon: string; text: string }[] = [];

  // 3-1. 누적 메커니즘 (관절 종류별 가장 임상적 부상명 명시)
  if (hasSpine) {
    const maxDev = sig.dominantDeviation || 0;
    const recurrent = Object.values(rec).filter((d) => d.isRecurrent).length;
    whyItems.push({
      icon: '🦴',
      text: `허리가 ${maxDev}° 휘는 자세가 ${recurrent > 0 ? `${recurrent}곳에서 반복` : '계속 누적'}되면, 추간판(디스크)에 한쪽으로만 압력이 쏠려요. 처음엔 뻐근함 → 몇 달 후 만성 요통 → 1-2년 후 디스크 탈출로 진행되는 게 임상적으로 흔한 경로예요.`,
    });
  } else if (hasKnee) {
    const maxDev = sig.dominantDeviation || 0;
    whyItems.push({
      icon: '🦵',
      text: `무릎이 ${maxDev}° 안으로 무너지는 자세가 반복되면, 슬개골이 매번 잘못된 궤도로 미끄러져요. 이게 누적되면 슬개대퇴 통증증후군(주자무릎) → 반월상연골 손상으로 이어집니다.`,
    });
  } else if (hasAnkle) {
    whyItems.push({
      icon: '👣',
      text: `발목이 잘 안 굽혀지면 무릎과 허리가 대신 일해요. 매 걸음, 매 스쿼트마다 무릎/허리에 작은 부담이 쌓여서 결국 무릎 시큰함, 만성 요통으로 번지는 연쇄 반응이 시작돼요.`,
    });
  } else if (hasShoulder) {
    whyItems.push({
      icon: '💪',
      text: `어깨 정렬이 어긋난 채로 팔을 자주 쓰면, 회전근개가 견봉(어깨뼈 돌기)에 끼이는 충돌이 매번 발생해요. 미세손상이 쌓이면 어깨 충돌증후군 → 회전근개 파열로 진행될 수 있어요.`,
    });
  }

  // 3-2. 좌우 비대칭 (한쪽에만 부담 누적 시 마모 가속)
  if (sig.leftRightDiff !== undefined && sig.leftRightDiff >= 12) {
    whyItems.push({
      icon: '⚖️',
      text: `왼쪽과 오른쪽 ${sig.leftRightJoint || '관절'} 차이가 ${sig.leftRightDiff}°예요. 한쪽 관절이 다른 쪽보다 1.5-2배 빠르게 닳아요 — 자동차 한쪽 타이어만 빨리 닳는 것과 같은 원리.`,
    });
  }

  // 3-3. 목표별 압박 포인트
  if (goal === 'weight') {
    whyItems.push({
      icon: '📉',
      text: `안정성 ${sig.avgStability ?? '-'}점이면 같은 운동 강도에서 칼로리 소모가 20-30% 적게 나와요. 잘못된 자세는 큰 근육이 일하지 않고 보조 근육만 일하게 만들거든요.`,
    });
  } else if (goal === 'performance') {
    whyItems.push({
      icon: '🏋️',
      text: `이 자세 그대로 무게를 10kg 더 올리면, ${sig.dominantJoint ? `${PLAIN_JOINT_NAME[sig.dominantJoint] || sig.dominantJoint}에 ` : ''}가는 압력은 1.5-2배로 커져요. 부하는 선형이 아니라 비선형으로 쌓여요.`,
    });
  } else if (goal === 'rehab') {
    whyItems.push({
      icon: '🩹',
      text: '잘못된 보상 자세가 굳어버리면 통증 부위는 호전돼도 다른 곳에서 재발해요. 보상 패턴 자체를 끊는 것이 재활의 핵심이에요.',
    });
  } else {
    whyItems.push({
      icon: '⏰',
      text: '신경계가 잘못된 자세를 "정상"으로 학습하기까지 약 6-8주 걸려요. 그 전에 잡으면 1단계만 거치면 되지만, 굳어진 후엔 3단계 (이완 → 활성화 → 재학습)로 시간이 3배 들어요.',
    });
  }

  // 4. 변화 예측 (이슈별 × 주차별 DB) — 회원 친화 일상어
  const changeDB: Record<string, { week24: string; week68: string }> = {
    spine: {
      week24:
        '허리 자세 잡기를 시작하면 2~3주 안에 허리에 가는 부담이 줄어들어요. 오래 앉아있어도 덜 뻐근하고, 아침에 일어날 때 덜 뻣뻣한 게 먼저 느껴져요.',
      week68:
        '6~8주 정도 꾸준히 하면 허리 코어가 자동으로 잡혀서, 무거운 물건 들 때 허리가 먼저 단단해지는 보호 반응이 생겨요. 허리 통증 재발률도 눈에 띄게 줄어요.',
    },
    leftKnee: {
      week24:
        '엉덩이 옆 근육 강화 운동을 1~2주만 해도 계단 오를 때 무릎이 안으로 쏠리는 느낌이 줄어요. 엉덩이가 잡히기 시작하면 무릎이 즉시 좋아져요.',
      week68:
        '6~8주 후엔 달리기나 점프 착지 때 무릎 정렬이 자동으로 잡혀요. 계단 내려갈 때 무릎 시큰함이 줄고, 스쿼트 깊이도 자연스럽게 깊어져요.',
    },
    rightKnee: {
      week24:
        '엉덩이 옆 근육 강화 운동을 1~2주만 해도 계단 오를 때 무릎이 안으로 쏠리는 느낌이 줄어요. 엉덩이가 잡히기 시작하면 무릎이 즉시 좋아져요.',
      week68:
        '6~8주 후엔 달리기나 점프 착지 때 무릎 정렬이 자동으로 잡혀요. 계단 내려갈 때 무릎 시큰함이 줄고, 스쿼트 깊이도 자연스럽게 깊어져요.',
    },
    leftHip: {
      week24:
        '엉덩이 관절 스트레칭을 시작하면 2~3주 안에 앉았다 일어날 때 "뚝" 소리나 뻣뻣함이 줄어요. 골반이 부드러워지면 허리도 같이 편해져요.',
      week68:
        '6~8주 후엔 스쿼트나 데드리프트할 때 허리가 대신 일하지 않아요. 양반다리도 편해지고, 오래 걸어도 골반 주변이 덜 피로해요.',
    },
    rightHip: {
      week24:
        '엉덩이 관절 스트레칭을 시작하면 2~3주 안에 앉았다 일어날 때 "뚝" 소리나 뻣뻣함이 줄어요. 골반이 부드러워지면 허리도 같이 편해져요.',
      week68:
        '6~8주 후엔 스쿼트나 데드리프트할 때 허리가 대신 일하지 않아요. 양반다리도 편해지고, 오래 걸어도 골반 주변이 덜 피로해요.',
    },
    leftAnkle: {
      week24:
        '발목 스트레칭과 벽 운동을 2~3주 하면 스쿼트 내려갈 때 발뒤꿈치가 안 들리고 잘 붙어있어요. 발목이 부드러워지면 허리 부담도 즉시 줄어요.',
      week68:
        '6~8주 후엔 종아리도 부드러워져서 달리기·점프 후 착지 충격을 발목이 잘 흡수해요. 스쿼트 깊이와 안정감이 같이 좋아져요.',
    },
    rightAnkle: {
      week24:
        '발목 스트레칭과 벽 운동을 2~3주 하면 스쿼트 내려갈 때 발뒤꿈치가 안 들리고 잘 붙어있어요. 발목이 부드러워지면 허리 부담도 즉시 줄어요.',
      week68:
        '6~8주 후엔 종아리도 부드러워져서 달리기·점프 후 착지 충격을 발목이 잘 흡수해요. 스쿼트 깊이와 안정감이 같이 좋아져요.',
    },
    leftShoulder: {
      week24:
        '가슴 앞쪽 스트레칭과 등 운동을 2~3주 하면 팔을 들어올릴 때 어깨 앞 결림이 줄어요. 책상에서 일할 때 목·어깨 결림도 같이 줄어요.',
      week68:
        '6~8주 후엔 어깨 움직임이 자연스러워져서 벤치프레스나 오버헤드 운동할 때 어깨 불편함이 눈에 띄게 줄어요.',
    },
    rightShoulder: {
      week24:
        '가슴 앞쪽 스트레칭과 등 운동을 2~3주 하면 팔을 들어올릴 때 어깨 앞 결림이 줄어요. 책상에서 일할 때 목·어깨 결림도 같이 줄어요.',
      week68:
        '6~8주 후엔 어깨 움직임이 자연스러워져서 벤치프레스나 오버헤드 운동할 때 어깨 불편함이 눈에 띄게 줄어요.',
    },
    hipShift: {
      week24:
        '옆구리·엉덩이 강화 운동 2~3주만 해도 한 발로 서거나 계단 오를 때 골반이 덜 기울어져요.',
      week68:
        '6~8주 후엔 달리기·점프 때 좌우 균형이 잡혀서 한쪽에만 가던 부담이 양쪽에 고르게 나뉘어요.',
    },
  };

  const changes = { week24: '', week68: '' };
  if (!criticals.length) {
    changes.week24 =
      '지금 자세 좋아요. 이 단계에선 같은 무게로 더 깔끔하게, 더 가볍게 움직이는 질적 향상이 먼저 와요.';
    changes.week68 =
      '6~8주 후엔 근력과 체력이 눈에 띄게 좋아져요. 다칠 걱정 없이 무게를 점점 늘려도 되는 최적의 몸 상태예요.';
  } else {
    const topC = criticals[0];
    const topDB = changeDB[topC.jointKey];
    if (topDB) {
      changes.week24 = topDB.week24;
      changes.week68 = topDB.week68;
    } else {
      changes.week24 = `자세 잡기를 시작하면 2~3주 안에 해당 부위가 부드러워지고 잘못된 움직임이 줄어드는 게 느껴져요.`;
      changes.week68 = `6~8주 후엔 좋은 움직임이 몸에 익어서 의식하지 않아도 자연스럽게 유지돼요.`;
    }
  }

  // 5. PT 권장
  const ptRange = ptPlan?.totalRange || '12~20회';
  const totalSessions = ptPlan?.totalSessions || 12;
  let ptReason: string;
  if (!criticals.length) {
    ptReason = '지금 자세를 더 다듬고, 다치지 않는 몸을 만들기에 딱 좋은 시점이에요';
  } else {
    const recurrentCount = Object.values(rec).filter((d) => d.isRecurrent).length;
    if (recurrentCount >= 2) {
      ptReason = `잘못된 자세가 ${recurrentCount}곳에서 반복돼요. 혼자 고치기 어려워서, 트레이너가 옆에서 봐줘야 빨리 좋아져요`;
    } else if (criticals.length >= 2) {
      ptReason = '두 군데 이상에서 문제가 보여요. 차근차근 단계별로 잡아가야 해요';
    } else {
      ptReason = '찾아낸 잘못된 자세를 고치고, 좋은 움직임이 몸에 완전히 익을 때까지 필요한 기간이에요';
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
 * 세일즈 스크립트 5단계 — 트레이너 영업 funnel 2번째 단계.
 *
 * 전제: 트레이너 구독 funnel = ① 체형 분석 (회원이 결과 받음)
 *                              → ② 영업 스크립트 (트레이너가 상담 시 사용)
 *                              → ③ PT 결제
 *
 * 각 단계는 정량 수치 + 임상적 메커니즘 + 시간/비용 근거로 설득력 구성:
 *   1단계 [발견]: 정량 측정값 (각도, 반복률, 좌우차이) — "주관 X, 측정 O"
 *   2단계 [연쇄]: kinetic chain 보상 → 어떤 부상으로 진행되는지 임상 경로
 *   3단계 [방치 시나리오]: 단기/중기/장기 정량 (1-3개월 / 3-12개월 / 1-3년)
 *   4단계 [PT 처방 근거]: 세션수/단계별 NSCA·McGill·Boyle 기준 진행 + 혼자 못 잡는 이유
 *   5단계 [신경가소성 + 시간비용]: 6-8주 운동 패턴 신경계 고착 — "지금" 근거 제공
 * ─────────────────────────────────────────────────────────── */

// 관절별 kinetic chain 연쇄 작용 (해당 부위가 어떤 부상으로 진행되는지)
const CASCADE_CHAIN: Record<string, string> = {
  spine:
    '척추 기립근 과활성 → 추간판(디스크) 후방 압력 누적 → 디스크 후방 부풀음 → 신경근 압박 → 좌골신경통/디스크 탈출증',
  leftKnee:
    '중둔근 약화 → 대퇴골 내회전 → 슬개골 활주 궤도 이탈 → 슬개대퇴 통증증후군 → 반월상연골 손상',
  rightKnee:
    '중둔근 약화 → 대퇴골 내회전 → 슬개골 활주 궤도 이탈 → 슬개대퇴 통증증후군 → 반월상연골 손상',
  leftHip:
    '고관절 굴곡 제한 → 골반 후방 경사(Butt Wink) → 요추 보상적 굴곡 → 만성 요통 → 고관절 충돌증후군(FAI)',
  rightHip:
    '고관절 굴곡 제한 → 골반 후방 경사(Butt Wink) → 요추 보상적 굴곡 → 만성 요통 → 고관절 충돌증후군(FAI)',
  leftAnkle:
    '발목 배굴 제한 → 무릎 전방 쏠림 + 체간 전방 기울기 → 슬개건/요추 부하 가중 → 슬개건염 + 만성 요통',
  rightAnkle:
    '발목 배굴 제한 → 무릎 전방 쏠림 + 체간 전방 기울기 → 슬개건/요추 부하 가중 → 슬개건염 + 만성 요통',
  leftShoulder:
    '소흉근 단축 + 견갑 전방 경사 → 회전근개가 견봉에 매번 충돌 → 어깨 충돌증후군 → 회전근개 미세파열 → 완전파열',
  rightShoulder:
    '소흉근 단축 + 견갑 전방 경사 → 회전근개가 견봉에 매번 충돌 → 어깨 충돌증후군 → 회전근개 미세파열 → 완전파열',
};

function buildSalesScriptV5(args: BuildSummaryArgs): SalesScriptStage[] {
  const { criticals, member, recurrence, signature, ptPlan, totalReps, isOhs } = args;
  const rec = recurrence ?? {};
  const sig = signature ?? ({} as VideoSignature);
  const name = member?.name || '회원';
  const ptRange = ptPlan?.totalRange || '12~20회';
  const totalSessions = ptPlan?.totalSessions || 16;

  const recurrentIssues = Object.entries(rec).filter(([, d]) => d.isRecurrent);
  const hasRecurrent = recurrentIssues.length > 0;
  const top = criticals[0];
  const topDev = top ? Math.round(devOf(top.angle, top.normalRange)) : 0;
  const topName = top ? PLAIN_JOINT_NAME[top.jointKey] || top.jointName : '';
  const topCascade = top ? CASCADE_CHAIN[top.jointKey] : null;
  const topShortRisk = top ? CASCADE_DB[top.jointKey]?.short : '';
  const topMidRisk = top ? CASCADE_DB[top.jointKey]?.mid : '';
  const topLongRisk = top ? CASCADE_DB[top.jointKey]?.long : '';

  /* ─── 1단계 [발견] — 정량 측정값으로 시작. "주관 X, 측정 O" ─── */
  let step1: string;
  if (!criticals.length) {
    step1 =
      `${name}님 분석 결과: 안정성 ${sig.avgStability ?? '-'}점, ${sig.minKneeAngle ? `최저 무릎 각도 ${sig.minKneeAngle}°, ` : ''}` +
      `좌우 차이 ${sig.leftRightDiff ?? 0}°. 전반적으로 안정 범위에 들어와 있습니다. ` +
      `다만 ${totalReps > 0 ? `${totalReps}회 중 ` : ''}일관성 ${sig.consistencyScore ?? 100}점으로 ` +
      `움직임 질을 더 다듬을 여지가 있고, 이 단계에서 예방적 강화를 시작하면 부상 발생률을 50% 이상 낮출 수 있다는 게 NSCA 통계의 골자입니다.`;
  } else {
    const partsTop = `① ${topName}: 정상 범위에서 ${topDev}° 이탈`;
    const recPart = isOhs && hasRecurrent
      ? ` (${totalReps}회 중 ${recurrentIssues[0][1].count}회 반복 → 일시적 흔들림이 아닌 습관화된 패턴)`
      : '';
    const lrPart =
      sig.leftRightDiff !== undefined && sig.leftRightDiff >= 12
        ? `\n② 좌우 ${sig.leftRightJoint || ''} 비대칭: ${sig.leftRightDiff}° (한쪽 관절에 부하 1.5-2배 집중)`
        : '';
    const consistencyPart =
      sig.consistencyScore !== undefined && sig.consistencyScore < 65
        ? `\n③ 반복 일관성: ${sig.consistencyScore}점 (피로 누적 시 부상 위험 ↑↑)`
        : '';
    step1 =
      `${name}님 분석에서 측정된 핵심 수치입니다.\n${partsTop}${recPart}${lrPart}${consistencyPart}\n\n` +
      `주관적 느낌이 아니라 ${totalReps > 0 ? `${totalReps}회 OHS 영상에서 매 frame 측정한` : '영상 프레임별 측정'} 결과입니다.`;
  }

  /* ─── 2단계 [연쇄] — kinetic chain 메커니즘으로 부상 경로 명시 ─── */
  let step2: string;
  if (!criticals.length) {
    step2 =
      `현재 측정된 패턴 자체는 안정 범위입니다. 다만 안정성 ${sig.avgStability ?? '-'}점 수준에서 ` +
      `중량을 무리하게 올리거나 피로 누적 상황에서 폼이 무너지면 ` +
      `${sig.dominantJoint ? `${PLAIN_JOINT_NAME[sig.dominantJoint] || sig.dominantJoint} 부위가 ` : ''}` +
      `가장 먼저 흔들립니다. 예방적 강화의 의미가 여기에 있습니다.`;
  } else {
    const chainText = topCascade
      ? `${topName}의 ${topDev}° 이탈은 단일 관절 문제가 아니라 kinetic chain 연쇄 반응입니다:\n  ${topCascade}\n\n`
      : '';
    const painfx = member?.painAreas
      ? `현재 호소하시는 ${member.painAreas} 불편감도 이 연쇄 반응의 산물일 가능성이 높습니다.\n\n`
      : '';
    const recurrentText = recurrentIssues.length >= 2
      ? `반복 패턴이 ${recurrentIssues.length}곳에서 확인되어, 단일 부위 문제가 아니라 보상 사슬 전체에 걸쳐있습니다. `
      : '';
    step2 =
      chainText + painfx + recurrentText +
      `핵심: 통증이 없다고 안전한 게 아닙니다. ` +
      `매 스쿼트, 매 보행마다 동일 방향으로 부하가 누적되고 있다는 점이 측정으로 확인됐습니다.`;
  }

  /* ─── 3단계 [방치 시나리오] — 시간 단위 정량 (단기/중기/장기) ─── */
  let step3: string;
  if (!criticals.length) {
    step3 =
      `방치 시 시나리오: 현재 패턴이 더 무너지지 않더라도 만 35세 이후 근육 감소율이 매년 1-2%로 진행됩니다 (Sarcopenia, NIH 가이드). ` +
      `지금 강화 기반을 다져두면 5년 후 운동 능력 차이가 압도적으로 커집니다.`;
  } else {
    step3 =
      `이 패턴을 그대로 두면 임상적으로 흔한 진행 경로는 다음과 같습니다:\n\n` +
      `▸ 1-3개월: ${topShortRisk || '해당 부위 뻐근함, 일상 동작 시 시큰함 발생'}\n` +
      `▸ 3-12개월: ${topMidRisk || '만성 통증 자리잡기 시작, 보조 근육 과사용'}\n` +
      `▸ 1-3년: ${topLongRisk || '구조적 손상 진행, 수술/장기 재활 단계 진입 위험'}\n\n` +
      `각 단계는 평균치이며, 좌우 비대칭(${sig.leftRightDiff ?? 0}°)이 클수록 진행 속도가 1.5-2배 빨라집니다. ` +
      `한쪽 관절에 부하가 몰리는 구조 때문입니다.`;
  }

  /* ─── 4단계 [PT 처방 근거] — 단계별 NSCA/McGill/Boyle + 혼자 못 잡는 이유 ─── */
  let step4: string;
  if (!criticals.length) {
    step4 =
      `예방 단계 PT는 ${ptRange} (총 ${totalSessions}회)이 적정합니다.\n\n` +
      `▸ 초기 4-6회: FMS 기반 7개 패턴 평가 + 약한 사슬 식별\n` +
      `▸ 중기 6-10회: Dan John 5패턴(스쿼트/힌지/푸시/풀/캐리) 균형 강화\n` +
      `▸ 후반 4-8회: 점진적 과부하 (NSCA 매 2주 5-10% 증가)\n\n` +
      `혼자 운동 시 약점 부위만 회피하게 되어 불균형이 오히려 심해지는 경향이 있어, 평가 기반 프로그래밍이 효율적입니다.`;
  } else {
    const phaseDb: Record<string, string> = {
      spine: '척추 안정화(McGill Big 3) → 심부 코어 신경근 재교육 → 힙 힌지 패턴 통합',
      leftKnee: '중둔근 활성화 + IT밴드 이완 → 무릎 추적 재교육(미니밴드) → 단측 하지 강화',
      rightKnee: '중둔근 활성화 + IT밴드 이완 → 무릎 추적 재교육(미니밴드) → 단측 하지 강화',
      leftHip: '고관절 굴곡근 이완(Sahrmann) → 힙 힌지 패턴 + 후방 체인 → 복합 하체 강화',
      rightHip: '고관절 굴곡근 이완(Sahrmann) → 힙 힌지 패턴 + 후방 체인 → 복합 하체 강화',
      leftAnkle: '비복근/가자미근 이완 → 기능적 배굴 재훈련(체중 부하) → 동적 발목 안정성',
      rightAnkle: '비복근/가자미근 이완 → 기능적 배굴 재훈련(체중 부하) → 동적 발목 안정성',
      leftShoulder: '소흉근 이완 + 흉추 가동성 → 견갑 안정화 + YTW → 오버헤드 패턴 강화',
      rightShoulder: '소흉근 이완 + 흉추 가동성 → 견갑 안정화 + YTW → 오버헤드 패턴 강화',
    };
    const phaseText = top && phaseDb[top.jointKey] ? phaseDb[top.jointKey] : '문제 부위 평가 → 가동성/안정성 재교육 → 패턴 자동화';
    const recurrentReason = hasRecurrent
      ? `\n특히 ${name}님처럼 ${recurrentIssues[0][1].count}회 반복 패턴이 확인된 케이스는 본인이 무너지는 시점을 자각하지 못합니다. ` +
        `실시간 피드백(거울/언어/촉각 큐) 없이 자가 교정 시도하면 90% 이상이 보상 패턴을 더 강화합니다 (Cook FMS 통계).`
      : `\n발견된 패턴을 완전히 자동화하려면 외부 피드백 루프가 필수입니다. 본인 감각만으로는 ${topDev}° 차이를 느끼지 못합니다.`;
    step4 =
      `처방 근거: ${ptRange} (총 ${totalSessions}회). Boyle Joint-by-Joint + NSCA Periodization 기반.\n\n` +
      `진행 순서:\n  ${phaseText}\n${recurrentReason}`;
  }

  /* ─── 5단계 [신경가소성 + 시간 비용] — "지금" 시작 근거 ─── */
  const step5 =
    `"왜 지금이어야 하는가"의 근거:\n\n` +
    `▸ 신경가소성 임계: 잘못된 운동 패턴은 6-8주 안에 신경계가 "정상"으로 학습합니다 (motor learning 연구).\n` +
    `▸ 시간 비용 차이: 굳기 전 교정 = 1단계(재교육)만 / 굳어진 후 교정 = 3단계(이완→활성화→재교육), 평균 3배 시간.\n` +
    `▸ 부상 시작 vs 부상 후: 통증 시작 전 교정은 PT만으로 ${ptRange} 안에 해결 / 통증 발생 후엔 의료 비용 + 재활 + 재발 방지까지 6-12개월 + 비용 ${totalSessions * 5}만원+.\n\n` +
    `오늘 측정 결과를 보면 ${name}님은 ${
      criticals.length === 0 ? '예방 단계' :
      hasRecurrent ? '습관화 단계 진입 직전 (가장 결정적 시점)' :
      criticals.length >= 2 ? '복합 보상 단계 (조기 잡기 효율적)' :
      '초기 패턴 형성 단계 (교정 효율 최고)'
    }입니다. 지금 시작이 시간·비용 관점에서 합리적 선택입니다.`;

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
      exerciseRefs: curr.p1.exerciseRefs,
    });
    phases.push({
      num: 2,
      range: '5~9회',
      color: '#f59e0b',
      goal: curr.p2.goal,
      why: curr.p2.why,
      exercises: curr.p2.exercises,
      exerciseRefs: curr.p2.exerciseRefs,
    });
    if (base > 10) {
      phases.push({
        num: 3,
        range: `10~${base}회`,
        color: '#22c55e',
        goal: curr.p3.goal,
        why: curr.p3.why,
        exercises: curr.p3.exercises,
        exerciseRefs: curr.p3.exerciseRefs,
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
      exerciseRefs: curr.p1.exerciseRefs,
    });
    phases.push({
      num: 2,
      range: '6~12회',
      color: '#f59e0b',
      goal: curr.p2.goal,
      why: curr.p2.why,
      exercises: curr.p2.exercises,
      exerciseRefs: curr.p2.exerciseRefs,
    });
    phases.push({
      num: 3,
      range: `13~${base}회`,
      color: '#22c55e',
      goal: curr.p3.goal,
      why: curr.p3.why,
      exercises: curr.p3.exercises,
      exerciseRefs: curr.p3.exerciseRefs,
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
      exerciseRefs: curr.p1.exerciseRefs,
    });
    phases.push({
      num: 2,
      range: '7~14회',
      color: '#f59e0b',
      goal: curr.p2.goal,
      why: curr.p2.why,
      exercises: curr.p2.exercises,
      exerciseRefs: curr.p2.exerciseRefs,
    });
    phases.push({
      num: 3,
      range: `15~${mid}회`,
      color: '#06b6d4',
      goal: curr.p3.goal,
      why: curr.p3.why,
      exercises: curr.p3.exercises,
      exerciseRefs: curr.p3.exerciseRefs,
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
      exerciseRefs: [
        { id: 'turkish-get-up' },
        { id: 'barbell-back-squat' },
        { id: 'farmer-carry' },
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
  /** B-8: 풍부 카드용 ID 참조 (있으면 string[] 대신 우선 표시) */
  exerciseRefs?: ExerciseRef[];
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
      exerciseRefs: [
        { id: 'diaphragmatic-breathing' },
        { id: 'mcgill-curl-up' },
        { id: '90-90-hip-lift' },
        { id: 'cat-camel' },
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
      exerciseRefs: [
        { id: 'dead-bug' },
        { id: 'bird-dog' },
        { id: 'side-plank' },
        { id: 'pallof-press' },
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
      exerciseRefs: [
        { id: 'trap-bar-deadlift' },
        { id: 'goblet-squat' },
        { id: 'trx-row' },
        { id: 'farmer-carry' },
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
      exerciseRefs: [
        { id: 'foam-roll-tfl-itband' },
        { id: 'foam-roll-adductor' },
        { id: 'clamshell' },
        { id: 'side-lying-hip-abduction' },
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
      exerciseRefs: [
        { id: 'mini-band-side-walk' },
        { id: 'mini-band-squat' },
        { id: 'step-up' },
        { id: 'bulgarian-split-squat', note: '약한 쪽 먼저' },
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
      exerciseRefs: [
        { id: 'single-leg-squat' },
        { id: 'lateral-step-down' },
        { id: 'kb-suitcase-carry' },
        { id: 'box-step-down' },
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
      exerciseRefs: [
        { id: '90-90-hip-stretch' },
        { id: 'half-kneeling-hip-flexor-stretch' },
        { id: 'hip-cars' },
        { id: 'thomas-test-stretch' },
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
      exerciseRefs: [
        { id: 'hip-hinge' },
        { id: 'kb-deadlift' },
        { id: 'single-leg-rdl' },
        { id: 'glute-bridge' },
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
      exerciseRefs: [
        { id: 'trap-bar-deadlift' },
        { id: 'goblet-squat-to-box' },
        { id: 'lateral-lunge' },
        { id: 'farmer-carry' },
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
      exerciseRefs: [
        { id: 'gastroc-stretch' },
        { id: 'soleus-stretch' },
        { id: 'wall-ankle-mobility' },
        { id: 'ankle-cars' },
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
      exerciseRefs: [
        { id: 'heel-elevated-goblet-squat' },
        { id: 'banded-dorsiflexion' },
        { id: 'single-leg-calf-raise' },
        { id: 'slant-board-squat' },
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
      exerciseRefs: [
        { id: 'single-leg-balance' },
        { id: 'box-step-down' },
        { id: 'goblet-squat' },
        { id: 'turkish-get-up' },
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
      exerciseRefs: [
        { id: 'pec-minor-doorway-stretch' },
        { id: 'foam-roll-thoracic' },
        { id: 'wall-angel' },
        { id: 'sleeper-stretch', note: '내회전 제한 시' },
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
      exerciseRefs: [
        { id: 'band-face-pull' },
        { id: 'ytw-raises' },
        { id: 'kb-bottoms-up-press' },
        { id: 'side-lying-external-rotation' },
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
      exerciseRefs: [
        { id: 'half-kneeling-press' },
        { id: 'seated-cable-row' },
        { id: 'landmine-press' },
        { id: 'pull-up' },
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
      exerciseRefs: [
        { id: 'ankle-cars' },
        { id: 'hip-cars' },
        { id: 'diaphragmatic-breathing' },
        { id: 'hip-hinge' },
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
      exerciseRefs: [
        { id: 'goblet-squat' },
        { id: 'kb-deadlift' },
        { id: 'push-up' },
        { id: 'trx-row' },
        { id: 'farmer-carry' },
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
      exerciseRefs: [
        { id: 'barbell-back-squat' },
        { id: 'trap-bar-deadlift' },
        { id: 'pull-up' },
        { id: 'turkish-get-up' },
      ],
    },
  },
};

/* ───────────────────────────────────────────────────────────
 * 변화 체크 — 이전 분석과 현재 분석 비교 (form_ai_v17.html:9292 port).
 *
 * - 두 VideoSignature 비교 (avgStability, dominantJoint·Deviation, leftRightDiff)
 * - candidates에서 priority 정렬 후 최대 2개 changes만 반환 (UI 과부하 방지)
 * - '측정 사실'만 표시 — 원인 단정 금지 (예: "안정성 +8점", "왼쪽 무릎 −12°")
 * ─────────────────────────────────────────────────────────── */
function compareWithPreviousAnalysis(
  current: import('./state').VideoSignature | null,
  previous: import('./state').VideoSignature | null,
  previousAt?: string | null,
): ComparisonResult | null {
  if (!current || !previous) return null;

  // QC fix: dominantJoint는 'leftKnee' 같은 영문 키 — UI에 그대로 노출되면 어색.
  //   한글 라벨 매핑 (config.ts movement ranges의 name 필드와 일치).
  const PLAIN_JOINT_NAME: Record<string, string> = {
    leftKnee: '왼쪽 무릎',
    rightKnee: '오른쪽 무릎',
    leftHip: '왼쪽 고관절',
    rightHip: '오른쪽 고관절',
    leftAnkle: '왼쪽 발목',
    rightAnkle: '오른쪽 발목',
    leftShoulder: '왼쪽 어깨',
    rightShoulder: '오른쪽 어깨',
    spine: '척추 정렬',
    hipShift: '골반 좌우 이동',
    ankleDorsi: '발목 배굴',
    thoracicFlex: '체간 기울기',
    trunkLean: '체간 기울기',
    spineSymmetry: '척추 대칭',
    footOutward: '발 외회전',
    fhpAngle: '거북목',
    roundShoulder: '라운드숄더',
  };
  const labelOf = (k: string | null): string => (k ? PLAIN_JOINT_NAME[k] ?? k : '');

  const candidates: ComparisonChange[] = [];

  // ① 안정성 변화 (avgStability 5점 이상 차이)
  const stabDiff = current.avgStability - previous.avgStability;
  if (Math.abs(stabDiff) >= 5) {
    candidates.push({
      type: stabDiff > 0 ? 'improve' : 'worsen',
      label: stabDiff > 0 ? '개선' : '악화',
      metric: '움직임 안정성',
      text: `${stabDiff > 0 ? '+' : ''}${Math.round(stabDiff)}점 변화`,
      priority: 1,
    });
  }

  // ② 주요 이탈 각도 변화 (5° 이상). dominantJoint가 같으면 deviation 비교, 다르면 변화로 표기
  if (current.dominantJoint && previous.dominantJoint) {
    if (current.dominantJoint === previous.dominantJoint) {
      const devDiff = current.dominantDeviation - previous.dominantDeviation;
      if (Math.abs(devDiff) >= 5) {
        candidates.push({
          type: devDiff < 0 ? 'improve' : 'worsen',
          label: devDiff < 0 ? '개선' : '악화',
          metric: `${labelOf(current.dominantJoint)} 이탈 각도`,
          text: `${devDiff < 0 ? '−' : '+'}${Math.abs(Math.round(devDiff))}° 변화`,
          priority: 2,
        });
      }
    } else {
      candidates.push({
        type: 'change',
        label: '변화',
        metric: '주요 관찰 부위',
        text: `${labelOf(previous.dominantJoint)} → ${labelOf(current.dominantJoint)}`,
        priority: 3,
      });
    }
  }

  // ③ 좌우 비대칭 변화 (5° 이상)
  const asymmDiff = current.leftRightDiff - previous.leftRightDiff;
  if (Math.abs(asymmDiff) >= 5) {
    candidates.push({
      type: asymmDiff < 0 ? 'improve' : 'worsen',
      label: asymmDiff < 0 ? '개선' : '악화',
      metric: '좌우 비대칭',
      text: `${asymmDiff < 0 ? '−' : '+'}${Math.abs(Math.round(asymmDiff))}° 변화`,
      priority: 2,
    });
  }

  const changes = candidates.sort((a, b) => a.priority - b.priority).slice(0, 2);
  if (changes.length === 0) return null;

  return {
    comparedAt: new Date().toISOString(),
    previousAt: previousAt ?? null,
    changes,
  };
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
  buildMemberSummary,
  buildSalesScriptV5,
  calcPtPlan,
  compareWithPreviousAnalysis,
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
  compareWithPreviousAnalysis,
};
