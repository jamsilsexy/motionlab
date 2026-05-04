import type { Capture } from './state';
import type {
  CompensationChain,
  JointAngles,
  MuscleDbEntry,
  NasmPattern,
  StaticPoseIssue,
  StaticPoseResult,
} from './types';

/* ═══════════════════════════════════════════════════════════
 * NASMEngine (web v17 10339-10728 풀이전):
 *   - MUSCLE_DB: 관절별 과활성/억제/3단계 처방/코칭 큐
 *   - CHAIN_DB: 보상 체인 시나리오
 *   - classifyPattern: criticals + angles + staticResult → 패턴 점수화
 *   - selectChain: criticals → 가장 적합한 보상 체인
 *
 * web 버전의 renderPatternSection / renderCoachingCues / renderNASMPrescription
 *   는 HTML 빌더라 mobile에서는 RN 컴포넌트가 직접 데이터 읽어 그림.
 * ═══════════════════════════════════════════════════════════ */

/* B-8: 각 관절·이슈별 phase1/2/3 → string[]은 fallback (구버전 호환),
   phase1Refs/phase2Refs/phase3Refs는 EXERCISE_DB id 참조 — 카드 UI에서 우선 사용.
   exercise-db.ts의 ExerciseEntry로 한글명/sets/reps/cues/effect를 자동 채움. */
export const MUSCLE_DB: Record<string, MuscleDbEntry> = {
  leftKnee: {
    label: '왼쪽 무릎 Valgus',
    overactive: ['내전근', '대퇴근막장근(TFL)', '비복근'],
    underactive: ['중둔근', '대둔근', '내측광근(VMO)'],
    phase1: [
      '폼롤러: 내전근 롤링 60초',
      '폼롤러: TFL/IT밴드 롤링 60초',
      '비복근 스트레칭 30초 × 3',
    ],
    phase1Refs: [
      { id: 'foam-roll-adductor' },
      { id: 'foam-roll-tfl-itband' },
      { id: 'gastroc-stretch' },
    ],
    phase2: [
      'Clamshell 15회 × 3세트',
      'Side-lying Hip Abduction 15회 × 3',
      'Monster Walk (밴드) 20보 × 3',
    ],
    phase2Refs: [
      { id: 'clamshell' },
      { id: 'side-lying-hip-abduction' },
      { id: 'mini-band-side-walk', note: '약한 쪽 먼저' },
    ],
    phase3: ['고블릿 스쿼트 (무릎 정렬 유지) 10회 × 3', '싱글레그 스쿼트 8회 × 3'],
    phase3Refs: [
      { id: 'goblet-squat' },
      { id: 'single-leg-squat' },
    ],
    cues: {
      wrong: ['무릎 벌려요', '발 안으로 넣어요'],
      right: ['발바닥 바깥쪽 세 곳 눌러', '엉덩이로 바닥 밀어내듯이'],
    },
  },
  rightKnee: {
    label: '오른쪽 무릎 Valgus',
    overactive: ['내전근', '대퇴근막장근(TFL)', '비복근'],
    underactive: ['중둔근', '대둔근', '내측광근(VMO)'],
    phase1: ['폼롤러: 내전근 롤링 60초', '폼롤러: TFL/IT밴드 롤링 60초'],
    phase1Refs: [{ id: 'foam-roll-adductor' }, { id: 'foam-roll-tfl-itband' }],
    phase2: ['Clamshell 15회 × 3세트', 'Side-lying Hip Abduction 15회 × 3'],
    phase2Refs: [{ id: 'clamshell' }, { id: 'side-lying-hip-abduction' }],
    phase3: ['고블릿 스쿼트 10회 × 3', '싱글레그 스쿼트 8회 × 3'],
    phase3Refs: [{ id: 'goblet-squat' }, { id: 'single-leg-squat' }],
    cues: { wrong: ['무릎 벌려요'], right: ['발바닥 바깥쪽 눌러', '엉덩이로 밀어내듯이'] },
  },
  spine: {
    label: '허리 굴곡 패턴',
    overactive: ['척추 기립근', '요방형근', '장요근'],
    underactive: ['복횡근', '다열근', '골반저근'],
    phase1: ['폼롤러 흉추 신전 30초 × 3', '고양이-낙타 스트레칭 10회'],
    phase1Refs: [{ id: 'foam-roll-thoracic' }, { id: 'cat-camel' }, { id: 'diaphragmatic-breathing' }],
    phase2: ['Dead Bug 10회 × 3', 'Bird Dog 10회 × 3', 'Plank (복압 유지) 30초 × 3'],
    phase2Refs: [{ id: 'dead-bug' }, { id: 'bird-dog' }, { id: 'plank' }],
    phase3: ['박스 스쿼트 (척추 중립) 10회 × 3', '루마니안 데드리프트 10회 × 3'],
    phase3Refs: [{ id: 'goblet-squat-to-box' }, { id: 'kb-deadlift' }],
    cues: {
      wrong: ['허리 세워요', '가슴 펴요', '배 집어넣어요'],
      right: ['갈비뼈 내리고 숨 잡아', '배꼽을 등쪽으로', '키 1cm 커진다고 생각하고'],
    },
  },
  leftHip: {
    label: '왼쪽 고관절 가동성',
    overactive: ['장요근', '대퇴직근', '햄스트링'],
    underactive: ['대둔근', '심부 외회전근군'],
    phase1: ['런지 스트레칭 (장요근) 30초 × 3', '90/90 고관절 스트레칭 60초 × 3'],
    phase1Refs: [
      { id: 'half-kneeling-hip-flexor-stretch' },
      { id: '90-90-hip-stretch' },
      { id: 'hip-cars' },
    ],
    phase2: [
      'Glute Bridge 15회 × 3',
      'Single-leg Glute Bridge 10회 × 3',
      'Hip CARs 5회 × 3',
    ],
    phase2Refs: [
      { id: 'glute-bridge' },
      { id: 'single-leg-glute-bridge' },
      { id: 'hip-hinge' },
    ],
    phase3: ['고블릿 스쿼트 (깊이 개선) 10회', 'Bulgarian Split Squat 8회 × 3'],
    phase3Refs: [{ id: 'goblet-squat' }, { id: 'bulgarian-split-squat' }],
    cues: {
      wrong: ['엉덩이 뒤로 빼요', '깊이 내려가요'],
      right: ['엉덩이를 두 발 사이로', '고관절부터 접어'],
    },
  },
  rightHip: {
    label: '오른쪽 고관절 가동성',
    overactive: ['장요근', '대퇴직근', '햄스트링'],
    underactive: ['대둔근', '심부 외회전근군'],
    phase1: ['런지 스트레칭 30초 × 3', '90/90 고관절 스트레칭 60초 × 3'],
    phase1Refs: [{ id: 'half-kneeling-hip-flexor-stretch' }, { id: '90-90-hip-stretch' }],
    phase2: ['Glute Bridge 15회 × 3', 'Single-leg Glute Bridge 10회 × 3'],
    phase2Refs: [{ id: 'glute-bridge' }, { id: 'single-leg-glute-bridge' }],
    phase3: ['고블릿 스쿼트 10회', 'Bulgarian Split Squat 8회 × 3'],
    phase3Refs: [{ id: 'goblet-squat' }, { id: 'bulgarian-split-squat' }],
    cues: {
      wrong: ['엉덩이 뒤로 빼요'],
      right: ['엉덩이를 두 발 사이로', '고관절부터 접어'],
    },
  },
  leftAnkle: {
    label: '발목 배굴 제한',
    overactive: ['비복근', '가자미근', '후경골근'],
    underactive: ['전경골근', '장비골근'],
    phase1: ['종아리 폼롤러 롤링 60초', '벽 스트레칭 (발목 배굴) 30초 × 3'],
    phase1Refs: [
      { id: 'foam-roll-calf' },
      { id: 'gastroc-stretch' },
      { id: 'soleus-stretch' },
    ],
    phase2: ['Ankle CARs 10회 × 3', '발목 배굴 밴드 저항 15회 × 3'],
    phase2Refs: [
      { id: 'ankle-cars' },
      { id: 'banded-dorsiflexion' },
      { id: 'wall-ankle-mobility' },
    ],
    phase3: ['웨지 보조 스쿼트 → 일반 스쿼트 점진 전환'],
    phase3Refs: [{ id: 'heel-elevated-goblet-squat' }, { id: 'slant-board-squat' }],
    cues: {
      wrong: ['발꿈치 들리지 마요'],
      right: ['발꿈치 땅에 붙이고 무릎 앞으로', '정강이가 신발 앞으로'],
    },
  },
  rightAnkle: {
    label: '발목 배굴 제한',
    overactive: ['비복근', '가자미근'],
    underactive: ['전경골근'],
    phase1: ['종아리 폼롤러 롤링 60초', '종아리 스트레칭 30초 × 3'],
    phase1Refs: [{ id: 'foam-roll-calf' }, { id: 'gastroc-stretch' }],
    phase2: ['Ankle CARs 10회 × 3'],
    phase2Refs: [{ id: 'ankle-cars' }, { id: 'banded-dorsiflexion' }],
    phase3: ['웨지 보조 스쿼트'],
    phase3Refs: [{ id: 'heel-elevated-goblet-squat' }],
    cues: { wrong: ['발꿈치 들리지 마요'], right: ['발꿈치 땅에 붙이고 무릎 앞으로'] },
  },
  leftShoulder: {
    label: '어깨 정렬 이탈',
    overactive: ['대흉근', '소흉근', '광배근', '상부 승모근'],
    underactive: ['중·하부 승모근', '전거근', '회전근개'],
    phase1: [
      '소흉근 스트레칭 30초 × 3',
      '광배근 스트레칭 30초 × 3',
      '폼롤러 흉추 신전 30초 × 3',
    ],
    phase1Refs: [
      { id: 'pec-minor-doorway-stretch' },
      { id: 'lat-stretch' },
      { id: 'foam-roll-thoracic' },
    ],
    phase2: ['Wall Slide 15회 × 3', '밴드 Face Pull 15회 × 3', 'Prone Y-T-W 10회 × 3'],
    phase2Refs: [
      { id: 'wall-slide' },
      { id: 'band-face-pull' },
      { id: 'ytw-raises' },
    ],
    phase3: ['PVC 오버헤드 스쿼트 10회', '케이블 오버헤드 프레스 10회 × 3'],
    phase3Refs: [
      { id: 'half-kneeling-press' },
      { id: 'landmine-press' },
      { id: 'pull-up' },
    ],
    cues: {
      wrong: ['팔 더 올려요', '어깨 내려요'],
      right: ['귀 옆에 팔 붙여', '겨드랑이로 호두 깨듯이', '날개뼈 뒤 주머니에 넣어'],
    },
  },
  rightShoulder: {
    label: '어깨 정렬 이탈',
    overactive: ['대흉근', '소흉근', '광배근'],
    underactive: ['중·하부 승모근', '전거근'],
    phase1: ['소흉근 스트레칭 30초 × 3', '폼롤러 흉추 신전 30초 × 3'],
    phase1Refs: [{ id: 'pec-minor-doorway-stretch' }, { id: 'foam-roll-thoracic' }],
    phase2: ['Wall Slide 15회 × 3', '밴드 Face Pull 15회 × 3'],
    phase2Refs: [{ id: 'wall-slide' }, { id: 'band-face-pull' }],
    phase3: ['PVC 오버헤드 스쿼트 10회'],
    phase3Refs: [{ id: 'half-kneeling-press' }, { id: 'landmine-press' }],
    cues: { wrong: ['어깨 내려요'], right: ['귀 옆에 팔 붙여', '날개뼈 뒤로'] },
  },
  ankleDorsi: {
    label: '발목 배굴 제한 (측면)',
    overactive: ['비복근', '가자미근'],
    underactive: ['전경골근'],
    phase1: ['종아리 폼롤러 60초', '솔레우스 스트레칭 (무릎 구부리고) 30초 × 3'],
    phase1Refs: [{ id: 'foam-roll-calf' }, { id: 'soleus-stretch' }],
    phase2: ['Ankle CARs', '경사판 스쿼트'],
    phase2Refs: [{ id: 'ankle-cars' }, { id: 'wall-ankle-mobility' }],
    phase3: ['박스 스쿼트 깊이 점진적 증가'],
    phase3Refs: [{ id: 'slant-board-squat' }, { id: 'heel-elevated-goblet-squat' }],
    cues: { wrong: ['발꿈치 들리지 마요'], right: ['발꿈치 지면 유지하며 무릎 밀어'] },
  },
  thoracicFlex: {
    label: '흉추 가동성 제한',
    overactive: ['흉추 신전근', '광배근'],
    underactive: ['전거근', '흉추 신전근'],
    phase1: ['폼롤러 흉추 신전 30초 × 3', '오픈 북 스트레칭 10회 × 3'],
    phase1Refs: [{ id: 'foam-roll-thoracic' }, { id: 'open-book' }, { id: 'cat-camel' }],
    phase2: ['Cat-Camel 10회 × 3', '흉추 회전 운동 10회 × 3'],
    phase2Refs: [{ id: 'wall-angel' }, { id: 'open-book' }, { id: 'band-face-pull' }],
    phase3: ['팔 들고 스쿼트 (흉추 신전 유지)'],
    phase3Refs: [{ id: 'half-kneeling-press' }, { id: 'pull-up' }],
    cues: { wrong: ['가슴 펴요'], right: ['흉골을 천장 쪽으로', '등을 길게 늘여'] },
  },
};

const CHAIN_DB: Record<string, CompensationChain> = {
  'ankle+knee': {
    chain: [
      '발목 배굴 제한',
      '정강이 전진 불가',
      '발 외회전 보상',
      '무릎 Valgus 발생',
      '상체 전방 기울기',
      '팔 전방 쏠림',
    ],
    text: '발목이 충분히 접히지 않아 정강이가 앞으로 못 나가고, 이를 보상하기 위해 발이 바깥으로 돌아가면서 무릎이 안으로 무너집니다. 상체는 균형을 위해 앞으로 기울어지고 팔도 귀 옆을 유지하지 못합니다.',
    root: '발목',
  },
  'hip+spine': {
    chain: ['고관절 굴곡 제한', '골반 후방 경사(Butt Wink)', '요추 굴곡 보상'],
    text: '고관절이 충분히 접히지 않아 깊이 내려갈수록 골반이 뒤로 말리고, 허리가 대신 구부러지면서 디스크에 압박이 집중됩니다.',
    root: '고관절',
  },
  'shoulder+spine': {
    chain: ['흉추 가동성 제한', '어깨 굴곡 범위 제한', '팔 전방 이동', '허리 과신전 보상'],
    text: '등이 굳어 있어 팔을 완전히 수직으로 들지 못합니다. 이를 보상하기 위해 팔이 앞으로 쏠리거나 허리가 과하게 꺾입니다.',
    root: '흉추',
  },
  'ankle+knee+hip': {
    chain: [
      '발목 제한',
      '무릎 Valgus',
      '고관절 내회전',
      '골반 불안정',
      '코어 무력화',
      '흉추 굴곡',
      '팔 전방',
    ],
    text: '발목→무릎→고관절→골반→코어→흉추→어깨까지 전신이 연쇄적으로 보상하는 복합 패턴입니다. 근본 원인은 발목이지만 모든 관절이 영향을 받고 있어요.',
    root: '발목 (전신 연쇄)',
  },
  'knee+hip': {
    chain: ['고관절 외회전 제어 부족', '무릎 내측 편위', '골반 시프팅'],
    text: '고관절에서 무릎을 제어하는 힘이 부족해 무릎이 안으로 무너지고, 이것이 골반의 좌우 이동을 유발합니다.',
    root: '고관절 제어',
  },
  'spine+hip': {
    chain: ['코어 안정성 부족', '골반 전방 경사', '요추 과신전', '둔근 억제'],
    text: '코어 근육이 골반을 잡아주지 못해 골반이 앞으로 기울어지고, 허리가 과하게 꺾이는 패턴이 형성됩니다.',
    root: '코어',
  },
};

/* ───────────────────────────────────────────────────────────
 * 패턴 분류 (criticals + angles + static pose → confidence 점수)
 * ─────────────────────────────────────────────────────────── */
function classifyPattern(
  criticals: Capture[],
  angles: JointAngles,
  staticResult: StaticPoseResult | null,
): NasmPattern[] {
  const has = (key: string) =>
    criticals.some((c) => c.jointKey === key || c.jointKey.toLowerCase().includes(key));
  const hasKnee = has('knee');
  const hasHip = has('hip');
  const hasSpine = has('spine');
  const hasShoulder = has('shoulder');

  const m = angles ?? {};
  const ankleLimited =
    (m.ankleDorsi != null && m.ankleDorsi < 25) ||
    (m.footOutward != null && m.footOutward > 28);
  const trunkForward = m.trunkLean != null && m.trunkLean > 38;
  const thoracicIssue = m.thoracicFlex != null && m.thoracicFlex > 35;
  const hipShiftIssue = m.hipShift != null && m.hipShift > 10;

  // staticResult.issues는 mobile에서 { name, severity, description } 형태 — web의 i.key는 mobile에 없음.
  // 정적 자세 이슈명에 키워드 매칭으로 대체.
  const hasPelvisIssue = staticResult?.issues?.some(
    (i: StaticPoseIssue) => i.name.includes('골반') || i.name.toLowerCase().includes('pelvis'),
  );
  const hasRoundShoulder = staticResult?.issues?.some(
    (i: StaticPoseIssue) => i.name.includes('라운드') || i.name.toLowerCase().includes('round'),
  );

  const patterns: NasmPattern[] = [];

  // 발목 제한형
  let ankleScore = 0;
  if (ankleLimited) ankleScore += 35;
  if (trunkForward) ankleScore += 25;
  if (hasKnee) ankleScore += 25;
  if (m.footOutward != null && m.footOutward > 25) ankleScore += 15;
  if (ankleScore >= 50) {
    patterns.push({ type: '발목 제한형', confidence: Math.min(ankleScore, 92), emoji: '🦶' });
  }

  // 고관절 제어 부족형
  let hipScore = 0;
  if (hasKnee) hipScore += 30;
  if (hasHip) hipScore += 30;
  if (hipShiftIssue) hipScore += 25;
  if (hasPelvisIssue) hipScore += 15;
  if (hipScore >= 50) {
    patterns.push({ type: '고관절 제어 부족형', confidence: Math.min(hipScore, 90), emoji: '🍑' });
  }

  // 흉추 제한형
  let thorScore = 0;
  if (hasShoulder) thorScore += 30;
  if (hasSpine) thorScore += 25;
  if (thoracicIssue) thorScore += 30;
  if (hasRoundShoulder) thorScore += 15;
  if (thorScore >= 50) {
    patterns.push({ type: '흉추 제한형', confidence: Math.min(thorScore, 88), emoji: '🔵' });
  }

  // 코어 안정성 부족형
  let coreScore = 0;
  if (hasSpine) coreScore += 35;
  if (hipShiftIssue) coreScore += 25;
  if (hasShoulder && hasSpine) coreScore += 20;
  if (hasPelvisIssue) coreScore += 20;
  if (coreScore >= 50) {
    patterns.push({ type: '코어 안정성 부족형', confidence: Math.min(coreScore, 85), emoji: '💪' });
  }

  return patterns.sort((a, b) => b.confidence - a.confidence);
}

/* ───────────────────────────────────────────────────────────
 * 보상 체인 선택 (criticals → 가장 적합한 chain 한 개)
 * ─────────────────────────────────────────────────────────── */
function selectChain(criticals: Capture[]): CompensationChain | null {
  const hasKnee = criticals.some(
    (c) => c.jointKey.includes('Knee') || c.jointKey.includes('Ankle'),
  );
  const hasHip = criticals.some((c) => c.jointKey.includes('Hip'));
  const hasSpine = criticals.some((c) => c.jointKey === 'spine');
  const hasShoulder = criticals.some((c) => c.jointKey.includes('Shoulder'));

  if (hasKnee && hasHip && hasSpine) return CHAIN_DB['ankle+knee+hip'];
  if (hasKnee && hasHip) return CHAIN_DB['knee+hip'];
  if (hasKnee) return CHAIN_DB['ankle+knee'];
  if (hasHip && hasSpine) return CHAIN_DB['hip+spine'];
  if (hasShoulder && hasSpine) return CHAIN_DB['shoulder+spine'];
  if (hasSpine && hasHip) return CHAIN_DB['spine+hip'];
  return null;
}

export const NASMEngine = {
  MUSCLE_DB,
  CHAIN_DB,
  classifyPattern,
  selectChain,
};

export { classifyPattern, selectChain };
