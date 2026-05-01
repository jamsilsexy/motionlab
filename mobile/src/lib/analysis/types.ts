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
