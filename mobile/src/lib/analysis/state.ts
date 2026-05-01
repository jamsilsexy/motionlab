import { create } from 'zustand';

import { AppConfig } from './config';
import { load, store } from './storage';
import type {
  JointAngles,
  JointRange,
  Landmark,
  MemberSummary,
  NasmPattern,
  PtPlan,
  SalesScriptStage,
  StaticPoseResult,
} from './types';

export type MemberGender = '' | 'male' | 'female';
export type MemberExperience = '' | 'beginner' | 'intermediate' | 'advanced';
export type MemberGoal = 'weight' | 'performance' | 'rehab' | 'general';
export type MemberAsymmetry = 'none' | 'minor' | 'significant';

export interface Member {
  id: string;
  name?: string;
  gender?: MemberGender;
  age?: number;
  experience?: MemberExperience;
  height?: number;
  weight?: number;
  bodyFat?: number;
  muscleMass?: number;
  asymmetry?: MemberAsymmetry;
  goal?: MemberGoal;
  painAreas?: string;
  injuryHistory?: string;
  notes?: string;
  createdAt?: string;
  lastAnalysis?: string | null;
  consentedAt?: string | null;
}

export interface Capture {
  id: string;
  jointKey: string;
  jointName: string;
  angle: number;
  normalRange: JointRange;
  severity: 'warning' | 'danger';
  expertClass?: string;
  timeMs: number;
  frameDataUri?: string;
  repIndex?: number;
  repeatCount?: number;
  repeatRate?: number;
  isRepresentative?: boolean;
}

export interface SquatRep {
  repNum: number;
  startMs: number;
  endMs: number;
  minKneeAngle: number;
  score: number;
  bottomMs: number;
  issues?: string[];
}

export interface RecurrenceData {
  count: number;
  total?: number;
  rate: number;
  isRecurrent: boolean;
  repNums?: number[];
  jointName?: string;
}

export interface JointSummaryEntry {
  avg: number;
  min: number;
  max: number;
  worst: number;
  risk: 'normal' | 'ignore' | 'warning' | 'danger';
  name: string;
  range: JointRange;
  issueRate: number;
  totalFrames: number;
  rawFrames?: number;
  filteredOut?: number;
}

export interface VideoSignature {
  dominantJoint: string | null;
  dominantDeviation: number;
  leftRightDiff: number;
  leftRightJoint: string;
  topRecurrentJoint: string | null;
  topRecurrentRate: number;
  avgStability: number;
  minKneeAngle: number | null;
  maxSpineFlexion: number;
  worstRepNum: number | null;
  bestRepNum: number | null;
  consistencyScore: number;
  mvId?: string;
}

export interface FrameRecord {
  timeMs: number;
  angles: JointAngles;
  landmarks?: Landmark[];
}

export interface ResultState {
  isComplete: boolean;
  captures: Capture[];
  criticalIssues: Capture[];
  jointSummary: Record<string, JointSummaryEntry>;
  overallScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  sqReps: SquatRep[];
  recurrence: Record<string, RecurrenceData>;
  videoSignature: VideoSignature | null;
  previousSignature: VideoSignature | null;
  analyzedMovements?: string[];
  memberSummary: MemberSummary | null;
  salesScript: SalesScriptStage[] | null;
  ptPlan: PtPlan | null;
  nasmPatterns: NasmPattern[] | null;
}

export interface SessionState {
  memberId: string | null;
  memberData: Member | null;
  videoUri: string | null;
  selectedMvId: string;
  analysisQueue: string[];
  currentQueueIdx: number;
  allResults: Record<string, ResultState>;
  staticPoseResult: StaticPoseResult | null;
  supplementId: string | null;
  supplementSkipped: boolean;
}

export interface RealtimeState {
  isPoseReady: boolean;
  isPlaying: boolean;
  frameCount: number;
  lastPoseMs: number;
  currentLandmarks: Landmark[] | null;
  currentAngles: JointAngles;
  frameHistory: FrameRecord[];
  lastCaptureTimes: Record<string, number>;
}

export interface CurrentRepData {
  repNum: number;
  startMs: number;
  minKneeAngle: number;
  bottomMs: number;
  bottomLandmarks: Landmark[] | null;
  bottomAngles: JointAngles;
}

export interface BestFrameData {
  deviation: number;
  timeMs: number;
  landmarks: Landmark[];
  angles: JointAngles;
  repIndex: number;
}

export interface SquatTrackerState {
  phase: 'idle' | 'descending' | 'ascending';
  reps: SquatRep[];
  currentRep: CurrentRepData | null;
  hipYHistory: number[];
  repIndex: number;
  issueReps: Record<string, Set<number>>;
  bestFrames: Record<string, BestFrameData>;
  repCaptures: Record<string, boolean>;
}

interface AnalysisStore {
  members: Member[];
  session: SessionState;
  realtime: RealtimeState;
  squatTracker: SquatTrackerState;
  result: ResultState;

  setSessionMember: (m: Member) => void;
  setSessionVideo: (uri: string) => void;
  setMovement: (id: string) => void;
  resetSession: () => void;
  resetRealtime: () => void;
  resetSquatTracker: () => void;
  resetResult: () => void;
  addCapture: (c: Capture) => void;
  setJointSummary: (s: Record<string, JointSummaryEntry>) => void;
  setCritical: (l: Capture[]) => void;
  setScore: (n: number) => void;
  setSqReps: (reps: SquatRep[]) => void;
  setRecurrence: (r: Record<string, RecurrenceData>) => void;
  setVideoSignature: (sig: VideoSignature) => void;
  upsertMember: (m: Member) => Promise<void>;
  loadMembersFromStorage: () => Promise<void>;

  setRealtime: (patch: Partial<RealtimeState>) => void;
  setSquatTracker: (patch: Partial<SquatTrackerState>) => void;
  setResult: (patch: Partial<ResultState>) => void;

  // 분석 큐 (v17 흐름: static_pose → ohs_front → ohs_side → 보완)
  startAnalysisQueue: (queue: string[]) => void;
  appendToQueue: (mvId: string) => void;
  advanceQueue: () => string | null;
  saveCurrentResult: (mvId: string, result: ResultState) => void;
  setStaticPoseResult: (r: StaticPoseResult | null) => void;
  setSupplementId: (id: string | null) => void;
  markSupplementSkipped: () => void;
}

const emptySession = (): SessionState => ({
  memberId: null,
  memberData: null,
  videoUri: null,
  selectedMvId: '',
  analysisQueue: [],
  currentQueueIdx: 0,
  allResults: {},
  staticPoseResult: null,
  supplementId: null,
  supplementSkipped: false,
});

const emptyRealtime = (): RealtimeState => ({
  isPoseReady: false,
  isPlaying: false,
  frameCount: 0,
  lastPoseMs: 0,
  currentLandmarks: null,
  currentAngles: {},
  frameHistory: [],
  lastCaptureTimes: {},
});

const emptyTracker = (): SquatTrackerState => ({
  phase: 'idle',
  reps: [],
  currentRep: null,
  hipYHistory: [],
  repIndex: 0,
  issueReps: {},
  bestFrames: {},
  repCaptures: {},
});

const emptyResult = (prevSig: VideoSignature | null = null): ResultState => ({
  isComplete: false,
  captures: [],
  criticalIssues: [],
  jointSummary: {},
  overallScore: 0,
  riskLevel: 'low',
  sqReps: [],
  recurrence: {},
  videoSignature: null,
  previousSignature: prevSig,
  memberSummary: null,
  salesScript: null,
  ptPlan: null,
  nasmPatterns: null,
});

export const useAnalysisStore = create<AnalysisStore>((set, get) => ({
  members: [],
  session: emptySession(),
  realtime: emptyRealtime(),
  squatTracker: emptyTracker(),
  result: emptyResult(),

  setSessionMember: (m) =>
    set((s) => ({
      session: { ...s.session, memberData: { ...m }, memberId: m.id },
    })),

  setSessionVideo: (uri) =>
    set((s) => ({ session: { ...s.session, videoUri: uri } })),

  setMovement: (id) =>
    set((s) => ({ session: { ...s.session, selectedMvId: id } })),

  resetSession: () => set({ session: emptySession() }),
  resetRealtime: () => set({ realtime: emptyRealtime() }),
  resetSquatTracker: () => set({ squatTracker: emptyTracker() }),
  resetResult: () => {
    const prev = get().result.videoSignature;
    set({ result: emptyResult(prev) });
  },

  addCapture: (c) =>
    set((s) => {
      if (s.result.captures.length >= AppConfig.CAPTURE.MAX_COUNT) return s;
      return { result: { ...s.result, captures: [...s.result.captures, c] } };
    }),

  setJointSummary: (summary) =>
    set((s) => ({ result: { ...s.result, jointSummary: summary } })),

  setCritical: (l) =>
    set((s) => ({ result: { ...s.result, criticalIssues: l } })),

  setScore: (n) =>
    set((s) => ({
      result: {
        ...s.result,
        overallScore: n,
        riskLevel: n >= 80 ? 'low' : n >= 60 ? 'medium' : 'high',
      },
    })),

  setSqReps: (reps) =>
    set((s) => ({ result: { ...s.result, sqReps: reps } })),

  setRecurrence: (r) =>
    set((s) => ({ result: { ...s.result, recurrence: r } })),

  setVideoSignature: (sig) =>
    set((s) => ({ result: { ...s.result, videoSignature: sig } })),

  upsertMember: async (m) => {
    set((s) => {
      const i = s.members.findIndex((x) => x.id === m.id);
      const next = [...s.members];
      if (i >= 0) next[i] = { ...next[i], ...m };
      else next.push(m);
      return { members: next };
    });
    await store('formAI_members', get().members);
  },

  loadMembersFromStorage: async () => {
    const m = await load<Member[]>('formAI_members', []);
    set({ members: m });
  },

  setRealtime: (patch) =>
    set((s) => ({ realtime: { ...s.realtime, ...patch } })),

  setSquatTracker: (patch) =>
    set((s) => ({ squatTracker: { ...s.squatTracker, ...patch } })),

  setResult: (patch) =>
    set((s) => ({ result: { ...s.result, ...patch } })),

  startAnalysisQueue: (queue) =>
    set((s) => ({
      session: {
        ...s.session,
        analysisQueue: [...queue],
        currentQueueIdx: 0,
        allResults: {},
        staticPoseResult: null,
        supplementId: null,
        supplementSkipped: false,
        selectedMvId: queue[0] ?? '',
      },
      result: emptyResult(),
    })),

  appendToQueue: (mvId) =>
    set((s) => {
      if (s.session.analysisQueue.includes(mvId)) return s;
      return {
        session: {
          ...s.session,
          analysisQueue: [...s.session.analysisQueue, mvId],
        },
      };
    }),

  advanceQueue: () => {
    const s = get().session;
    const nextIdx = s.currentQueueIdx + 1;
    if (nextIdx >= s.analysisQueue.length) {
      set((curr) => ({
        session: { ...curr.session, currentQueueIdx: nextIdx },
      }));
      return null;
    }
    const nextMv = s.analysisQueue[nextIdx];
    set((curr) => ({
      session: {
        ...curr.session,
        currentQueueIdx: nextIdx,
        selectedMvId: nextMv,
        videoUri: null,
      },
      result: emptyResult(curr.result.videoSignature),
    }));
    return nextMv;
  },

  saveCurrentResult: (mvId, result) =>
    set((s) => ({
      session: {
        ...s.session,
        allResults: { ...s.session.allResults, [mvId]: result },
      },
    })),

  setStaticPoseResult: (r) =>
    set((s) => ({ session: { ...s.session, staticPoseResult: r } })),

  setSupplementId: (id) =>
    set((s) => ({ session: { ...s.session, supplementId: id } })),

  markSupplementSkipped: () =>
    set((s) => ({ session: { ...s.session, supplementSkipped: true } })),
}));

/**
 * 분석 lib (engine/tracker/filter)에서 hook 외부에서 store를 읽기 위한 proxy.
 * `AppState.session.selectedMvId` 같은 기존 코드 패턴을 거의 그대로 유지.
 */
export const AnalysisState = {
  get session() {
    return useAnalysisStore.getState().session;
  },
  get realtime() {
    return useAnalysisStore.getState().realtime;
  },
  get squatTracker() {
    return useAnalysisStore.getState().squatTracker;
  },
  get result() {
    return useAnalysisStore.getState().result;
  },
  get members() {
    return useAnalysisStore.getState().members;
  },
};

/**
 * SH (State Helper) — 기존 코드 패턴 유지. 모든 액션은 Zustand setState 경유.
 */
export const SH = {
  setSessionMember: (m: Member) => useAnalysisStore.getState().setSessionMember(m),
  setSessionVideo: (uri: string) => useAnalysisStore.getState().setSessionVideo(uri),
  setMovement: (id: string) => useAnalysisStore.getState().setMovement(id),
  resetSession: () => useAnalysisStore.getState().resetSession(),
  resetRealtime: () => useAnalysisStore.getState().resetRealtime(),
  resetSquatTracker: () => useAnalysisStore.getState().resetSquatTracker(),
  resetResult: () => useAnalysisStore.getState().resetResult(),
  addCapture: (c: Capture) => useAnalysisStore.getState().addCapture(c),
  setJointSummary: (s: Record<string, JointSummaryEntry>) =>
    useAnalysisStore.getState().setJointSummary(s),
  setCritical: (l: Capture[]) => useAnalysisStore.getState().setCritical(l),
  setScore: (n: number) => useAnalysisStore.getState().setScore(n),
  setSqReps: (r: SquatRep[]) => useAnalysisStore.getState().setSqReps(r),
  setRecurrence: (r: Record<string, RecurrenceData>) =>
    useAnalysisStore.getState().setRecurrence(r),
  setVideoSignature: (sig: VideoSignature) => useAnalysisStore.getState().setVideoSignature(sig),
  upsertMember: (m: Member) => useAnalysisStore.getState().upsertMember(m),
  loadMembers: () => useAnalysisStore.getState().loadMembersFromStorage(),
  setRealtime: (patch: Partial<RealtimeState>) => useAnalysisStore.getState().setRealtime(patch),
  setSquatTracker: (patch: Partial<SquatTrackerState>) =>
    useAnalysisStore.getState().setSquatTracker(patch),
  setResult: (patch: Partial<ResultState>) => useAnalysisStore.getState().setResult(patch),

  startAnalysisQueue: (queue: string[]) =>
    useAnalysisStore.getState().startAnalysisQueue(queue),
  appendToQueue: (mvId: string) => useAnalysisStore.getState().appendToQueue(mvId),
  advanceQueue: () => useAnalysisStore.getState().advanceQueue(),
  saveCurrentResult: (mvId: string, result: ResultState) =>
    useAnalysisStore.getState().saveCurrentResult(mvId, result),
  setStaticPoseResult: (r: StaticPoseResult | null) =>
    useAnalysisStore.getState().setStaticPoseResult(r),
  setSupplementId: (id: string | null) => useAnalysisStore.getState().setSupplementId(id),
  markSupplementSkipped: () => useAnalysisStore.getState().markSupplementSkipped(),
};
