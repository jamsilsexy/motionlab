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
  title: string;
  body: string;
}

export interface PtPlanPhase {
  phase: number;
  weeks: string;
  goal: string;
  sessions: number;
}

export interface PtPlan {
  totalSessions: number;
  totalRange: string;
  weeklyFrequency: number;
  phases: PtPlanPhase[];
}

export interface NasmPattern {
  name: string;
  severity: IssueSeverity;
  rootCause: string;
  compensationChain: string[];
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
