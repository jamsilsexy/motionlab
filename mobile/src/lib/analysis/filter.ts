import { AppConfig } from './config';
import {
  AnalysisState,
  type Capture,
  type JointSummaryEntry,
  type Member,
  type RecurrenceData,
  type VideoSignature,
} from './state';
import { devOf } from './utils';

interface ClassifiedCapture extends Capture {
  expertClass: 'CRITICAL' | 'COMPENSATION' | 'IGNORE';
  critConditions: string[];
  isBottomFrame?: boolean;
}

const CATEGORY_MAP: Record<string, string> = {
  leftKnee: 'knee',
  rightKnee: 'knee',
  leftHip: 'hip',
  rightHip: 'hip',
  leftAnkle: 'ankle',
  rightAnkle: 'ankle',
  leftShoulder: 'shoulder',
  rightShoulder: 'shoulder',
  spine: 'spine',
};

const MIRROR_MAP: Record<string, string> = {
  leftKnee: 'rightKnee',
  rightKnee: 'leftKnee',
  leftHip: 'rightHip',
  rightHip: 'leftHip',
  leftAnkle: 'rightAnkle',
  rightAnkle: 'leftAnkle',
  leftShoulder: 'rightShoulder',
  rightShoulder: 'leftShoulder',
};

const PATTERN_WEIGHTS: Record<string, number> = {
  spine: 30,
  leftKnee: 20,
  rightKnee: 20,
  leftHip: 15,
  rightHip: 15,
  leftShoulder: 12,
  rightShoulder: 12,
  leftAnkle: 10,
  rightAnkle: 10,
  leftElbow: 5,
  rightElbow: 5,
};

function patternWeight(jointKey: string): number {
  return PATTERN_WEIGHTS[jointKey] ?? 5;
}

function representScore(c: ClassifiedCapture, rec: Record<string, RecurrenceData>): number {
  const recRate = (rec[c.jointKey]?.rate ?? 0) * 50;
  const dev = devOf(c.angle, c.normalRange ?? { min: 0, max: 180, name: '' });
  const dangerBonus = c.severity === 'danger' ? 15 : 0;
  const bottomBonus = c.isBottomFrame ? 10 : 0;
  return recRate + dev * 0.5 + dangerBonus + bottomBonus;
}

/**
 * 단일 capture 분류 (CRITICAL / COMPENSATION / IGNORE).
 * 7가지 조건(C1~C7) 중 만족 개수에 따라 분류.
 */
function classify(
  capture: Capture,
  summary: Record<string, JointSummaryEntry>,
  rec: Record<string, RecurrenceData>,
): ClassifiedCapture {
  const cfg = AppConfig.EXPERT;
  const member: Partial<Member> = AnalysisState.session.memberData ?? {};
  const conditions: string[] = [];

  // C1: 관절별 임계값 — 어깨/발목/척추 민감도 향상
  const dev = devOf(capture.angle, capture.normalRange);
  const jointThreshold =
    cfg.JOINT_DEVIATION_DEG[capture.jointKey] ?? cfg.CRITICAL_DEVIATION_DEG;
  if (dev >= jointThreshold) conditions.push('C1:큰 각도 이탈');

  // C2: 반복 패턴 (rep 기반 또는 frame 밀도 fallback)
  const jsum = summary[capture.jointKey];
  const repData = rec[capture.jointKey];
  if (repData?.isRecurrent) {
    conditions.push(`C2:반복 패턴(${repData.count}/${repData.total ?? 1}회)`);
  } else if (jsum && jsum.issueRate > 0.15) {
    conditions.push('C2:반복 패턴');
  }

  // C3: 좌우 비대칭 (15도 이상)
  const mk = MIRROR_MAP[capture.jointKey];
  if (mk && summary[mk]) {
    const diff = Math.abs((jsum?.avg ?? 0) - (summary[mk].avg ?? 0));
    if (diff > 15) conditions.push('C3:좌우 비대칭');
  }

  // C4: 척추 연쇄
  if (capture.jointKey !== 'spine' && summary.spine?.risk === 'danger') {
    conditions.push('C4:척추 연쇄 영향');
  }

  // C5: 인바디 비대칭 입력 연관
  if (
    member.asymmetry === 'significant' &&
    (capture.jointKey.includes('left') || capture.jointKey.includes('right'))
  ) {
    conditions.push('C5:인바디 비대칭 연관');
  }

  // C6: 부상 이력 재발 위험
  const injuryRaw = member.injuryHistory;
  if (injuryRaw && capture.jointKey) {
    const injL = String(injuryRaw).toLowerCase();
    const jk = capture.jointKey.toLowerCase();
    const related =
      (jk.includes('knee') && injL.includes('무릎')) ||
      (jk.includes('hip') && injL.includes('고관절')) ||
      (jk.includes('shoulder') && (injL.includes('어깨') || injL.includes('회전근'))) ||
      (jk.includes('ankle') && (injL.includes('발목') || injL.includes('인대')));
    if (related) conditions.push('C6:부상 이력 재발 위험');
  }

  // C7: 고반복률 단독 승격 (3회+ + dev 10도+)
  if (
    repData &&
    repData.count >= cfg.RECURRENCE_MIN_COUNT &&
    dev >= 10 &&
    !conditions.some((c) => c.startsWith('C2'))
  ) {
    conditions.push(`C7:고반복(${repData.count}회) 단독 승격`);
  }

  let expertClass: ClassifiedCapture['expertClass'];
  if (conditions.length >= cfg.CRITICAL_MIN_CONDITIONS) expertClass = 'CRITICAL';
  else if (conditions.length >= 1) expertClass = 'COMPENSATION';
  else expertClass = 'IGNORE';

  return { ...capture, expertClass, critConditions: conditions };
}

/**
 * captures + summary + recurrence + signature → MAX_CRITICAL_OUTPUT개 critical 선정.
 * - 같은 관절에서 가장 설득력 있는 프레임 1개
 * - 카테고리 중복 제거 (좌/우 무릎 → 더 심한 쪽만)
 * - signature 기반 정렬 (dominantJoint > topRecurrent > deviation > patternWeight)
 */
function selectCriticals(
  captures: Capture[],
  summary: Record<string, JointSummaryEntry>,
  recurrence: Record<string, RecurrenceData>,
  signature: VideoSignature,
): Capture[] {
  const cfg = AppConfig.EXPERT;
  const rec = recurrence ?? {};
  const sig = signature ?? ({} as VideoSignature);
  const classified = captures.map((c) => classify(c, summary, rec));

  // 같은 관절에서 가장 설득력 있는 1개 (대표 프레임)
  const bestPerJoint: Record<string, ClassifiedCapture> = {};
  classified.forEach((c) => {
    const existing = bestPerJoint[c.jointKey];
    if (!existing) {
      bestPerJoint[c.jointKey] = c;
      return;
    }
    if (representScore(c, rec) > representScore(existing, rec)) {
      bestPerJoint[c.jointKey] = c;
    }
  });

  // CRITICAL만 필터
  const criticals = Object.values(bestPerJoint).filter((c) => c.expertClass === 'CRITICAL');

  // signature 기반 정렬
  criticals.sort((a, b) => {
    const isDomA = a.jointKey === sig.dominantJoint ? 20 : 0;
    const isDomB = b.jointKey === sig.dominantJoint ? 20 : 0;
    const isTopA = a.jointKey === sig.topRecurrentJoint ? 15 : 0;
    const isTopB = b.jointKey === sig.topRecurrentJoint ? 15 : 0;
    const recA = (rec[a.jointKey]?.rate ?? 0) * 40;
    const recB = (rec[b.jointKey]?.rate ?? 0) * 40;
    const devA = devOf(a.angle, a.normalRange) * 0.6;
    const devB = devOf(b.angle, b.normalRange) * 0.6;
    const wA = patternWeight(a.jointKey);
    const wB = patternWeight(b.jointKey);
    return isDomB + isTopB + recB + devB + wB - (isDomA + isTopA + recA + devA + wA);
  });

  // 카테고리별 최대 1개 (좌/우 같은 부위 중복 제거)
  const seenCategory = new Set<string>();
  const deduped: ClassifiedCapture[] = [];
  criticals.forEach((c) => {
    const cat = CATEGORY_MAP[c.jointKey] ?? c.jointKey;
    if (seenCategory.has(cat)) return;
    seenCategory.add(cat);
    deduped.push(c);
  });

  return deduped.slice(0, cfg.MAX_CRITICAL_OUTPUT);
}

export const ExpertFilter = {
  selectCriticals,
};

export { selectCriticals };
