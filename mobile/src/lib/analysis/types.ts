export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
}

export type RiskLevel = 'normal' | 'ignore' | 'warning' | 'danger';

export interface JointRange {
  min: number;
  max: number;
  name: string;
}

export interface MovementGuide {
  angle: string;
  frame: string;
  reps: string;
  height: string;
  extra: string;
}

export interface MovementCheck {
  ico: string;
  name: string;
  sub: string;
}

export interface Movement {
  id: string;
  icon: string;
  label: string;
  desc: string;
  isMain: boolean;
  isStatic?: boolean;
  supplement?: boolean;
  pairId?: string;
  guide: MovementGuide;
  checks: MovementCheck[];
  ranges: Record<string, JointRange>;
}

export interface SupplementMapEntry {
  priority: number;
  triggerJoints: string[];
  supplementId: string;
  reason: string;
}

export interface JointAngles {
  [jointName: string]: number | null;
}

export interface FrameAnalysis {
  timestamp: number;
  angles: JointAngles;
  hipShift?: number;
  visibility: number;
}

/* ─────────────────────────────────────────────────────────
   V2 결과 타입 (buildMemberSummary / buildSalesScriptV5 /
   calcPtPlan / NASMEngine.classifyPattern 의 return 형태).
   Phase A 에서는 mock 데이터로 채워 화면 검증.
   Phase B 에서 실 함수가 이 타입대로 채움.
   ──────────────────────────────────────────────────────── */

export type IssueSeverity = 'normal' | 'warning' | 'danger';

export interface SummaryProblem {
  jointKey: string;
  name: string;
  desc: string;
  severity: IssueSeverity;
  deviation: number;
  repCount?: number | null;
  repTotal?: number | null;
  isRecurrent?: boolean;
  /** 반복 시 발생 가능한 통증 — 예: "계단 내려갈 때 무릎 안쪽이 시큰거릴 수 있어요" */
  painRisk?: string;
  /** 현재 일상에서 불편함을 느낄 수 있는 상황 — 예: "오래 앉아 있으면 허리가 뻐근해요" */
  dailyImpact?: string;
  /** 누적 시나리오: 단기/중기/장기 부상 위험. 회원에게 부상의 진행 단계를 명시 */
  cascade?: { short: string; mid: string; long: string };
  /** 이슈 시점 캡쳐 사진 URI (영상 분석 path만, 라이브는 undefined) */
  frameDataUri?: string;
  /** 이슈 시점 33 landmark — SkeletonOverlay 그리기용 */
  landmarks?: Landmark[];
  /** 이슈 발생 시각 (ms) + 반복 인덱스 — 캡션용 */
  timeMs?: number;
  capRepIndex?: number;
}

export interface SummaryWhyItem {
  icon: string;
  text: string;
}

export interface SummaryChanges {
  week24: string;
  week68: string;
}

export interface MemberSummary {
  conclusion: string;
  problems: SummaryProblem[];
  whyItems: SummaryWhyItem[];
  changes: SummaryChanges;
  ptRange: string;
  ptReason: string;
  totalSessions: number;
}

export interface SalesScriptStage {
  step: 1 | 2 | 3 | 4 | 5;
  label: string;
  text: string;
}

export interface PtPlanPhase {
  num: number;
  range: string;
  color: string;
  goal: string;
  why: string;
  exercises: string[];
  /** B-8: 풍부 카드용 ID 참조 (있으면 string[] 대신 우선 표시) */
  exerciseRefs?: ExerciseRef[];
}

export interface PtPlan {
  totalSessions: number;
  totalRange: string;
  basis: string;
  phases: PtPlanPhase[];
  trainerMsg: string;
}

export interface NasmPattern {
  type: string;
  confidence: number;
  emoji: string;
}

export interface CompensationChain {
  chain: string[];
  text: string;
  root: string;
}

export interface MuscleDbEntry {
  label: string;
  overactive: string[];
  underactive: string[];
  phase1: string[];
  phase2: string[];
  phase3: string[];
  /** B-8: phase별 ExerciseRef 배열 (있으면 string[] 대신 우선 표시) */
  phase1Refs?: ExerciseRef[];
  phase2Refs?: ExerciseRef[];
  phase3Refs?: ExerciseRef[];
  cues: { wrong: string[]; right: string[] };
}

export interface StaticPoseIssue {
  name: string;
  severity: IssueSeverity;
  description?: string;
}

export interface StaticPoseResult {
  shoulderTilt: number;
  pelvisTilt: number;
  alignmentScore: number;
  recommendedSideDirection: 'left' | 'right' | null;
  recommendedSideMessage?: string;
  issues: StaticPoseIssue[];
  analyzedAt: string;
  photoUri?: string;
}

/* ─────────────────────────────────────────────────────────
   B-8 운동 처방 DB
   ──────────────────────────────────────────────────────── */

export type ExerciseCategory =
  | 'mobility' // 가동성 (스트레칭/SMR/CARs)
  | 'stability' // 안정성 (코어/호흡/관절 안정화)
  | 'strength' // 근력 (저항/복합 운동)
  | 'pattern'; // 패턴 재교육 (hinge/squat/carry/balance)

export type ExerciseRegion = 'ankle' | 'knee' | 'hip' | 'spine' | 'shoulder' | 'core';

export type ExerciseLevel = 1 | 2 | 3; // phase 매핑: 1=초기/이완, 2=재교육/안정화, 3=강화/통합

export interface ExerciseEntry {
  id: string;
  name: string; // 한글 표시명 (generic public domain)
  nameEn?: string; // 영문명 (참조용)
  category: ExerciseCategory;
  regions: ExerciseRegion[];
  level: ExerciseLevel;
  defaultSets: string; // 예: '3세트'
  defaultReps: string; // 예: '15회', '60초', '20걸음'
  equipment: string[]; // ['맨몸'], ['폼롤러'], ['미니밴드'], ['덤벨/케틀벨']
  cues?: string[]; // 코칭 큐 1-3개 (오감각 표현)
  effect?: string; // 한 줄 효과 (회원/트레이너 모두 이해)
  caution?: string; // 주의 사항 (선택)
}

/** phase 안에서 같은 운동도 다른 횟수로 처방 가능 — sets/reps override 허용 */
export interface ExerciseRef {
  id: string;
  setsOverride?: string;
  repsOverride?: string;
  note?: string; // phase-specific 메모 ("약한 쪽 먼저" 등)
}

/* ─────────────────────────────────────────────────────────
   변화 체크 (compareWithPreviousAnalysis 결과)
   form_ai_v17.html:9292 port — 이전 분석 대비 무엇이 변했는지
   ──────────────────────────────────────────────────────── */

export type ComparisonChangeType = 'improve' | 'worsen' | 'change';

export interface ComparisonChange {
  type: ComparisonChangeType;
  label: '개선' | '악화' | '변화';
  metric: string; // 예: '움직임 안정성', '왼쪽 무릎 이탈 각도'
  text: string; // 예: '+8점 변화', '−12° 변화'
  priority: number; // 1=가장 중요
}

export interface ComparisonResult {
  /** 측정 정보용 — 비교 시각 */
  comparedAt: string;
  /** 이전 분석 시각 (member.lastAnalyzedAt) */
  previousAt?: string | null;
  changes: ComparisonChange[];
}
