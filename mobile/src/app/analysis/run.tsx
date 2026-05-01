import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AppConfig,
  type Capture,
  type JointRange,
  type JointSummaryEntry,
  SH,
  useAnalysisStore,
} from '@/lib/analysis';

/**
 * M5-A3 — 큐 단계별 mock 분석 진행.
 * 끝나면 saveCurrentResult → advanceQueue → 다음 화면 자동 라우팅.
 *
 * Phase B 에서 mock 진행 → 실제 MediaPipe Pose 파이프라인으로 교체.
 */
export default function AnalysisRunScreen() {
  const router = useRouter();
  const { memberId } = useLocalSearchParams<{ memberId?: string }>();
  const session = useAnalysisStore((s) => s.session);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('영상 로딩 중');
  const navigatedRef = useRef(false);

  const mvId = session.selectedMvId;
  const movement = AppConfig.MOVEMENTS.find((m) => m.id === mvId);
  const queueLen = session.analysisQueue.length;
  const stepNum = session.currentQueueIdx + 1;

  useEffect(() => {
    if (!session.videoUri || !mvId) {
      router.back();
      return;
    }
    if (navigatedRef.current) return;

    const phases: { p: number; label: string }[] = [
      { p: 10, label: '영상 로딩 중' },
      { p: 25, label: '프레임 추출 중' },
      { p: 50, label: 'MediaPipe Pose 분석 중' },
      { p: 75, label: '관절 각도 계산 중' },
      { p: 90, label: '이슈 분류 중' },
      { p: 100, label: '리포트 생성 중' },
    ];
    let i = 0;
    const id = setInterval(() => {
      if (i >= phases.length) {
        clearInterval(id);
        if (navigatedRef.current) return;
        navigatedRef.current = true;
        finishStep();
        return;
      }
      setProgress(phases[i].p);
      setPhase(phases[i].label);
      i += 1;
    }, 600);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishStep = () => {
    if (!mvId) {
      router.replace('/');
      return;
    }
    injectMockResult(mvId);
    const finalResult = useAnalysisStore.getState().result;
    SH.saveCurrentResult(mvId, finalResult);
    const next = SH.advanceQueue();
    if (!next) {
      router.replace(`/analysis/report?memberId=${memberId ?? ''}`);
      return;
    }
    const nextMv = AppConfig.MOVEMENTS.find((m) => m.id === next);
    if (nextMv?.isStatic) {
      router.replace(`/analysis/static-pose?memberId=${memberId ?? ''}`);
    } else {
      router.replace(`/analysis/upload?memberId=${memberId ?? ''}`);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-4xl">{movement?.icon ?? '🏋️'}</Text>
        <Text className="mt-2 text-xs text-gray-500">
          {stepNum}/{queueLen} {movement?.label ?? ''}
        </Text>
        <Text className="mt-3 text-base font-semibold text-gray-900">{phase}</Text>

        <View className="mt-6 w-full max-w-xs">
          <View className="h-2 overflow-hidden rounded-full bg-gray-200">
            <View
              className="h-full bg-indigo-600"
              style={{ width: `${progress}%` as `${number}%` }}
            />
          </View>
          <Text className="mt-2 text-center text-xs text-gray-500">{progress}%</Text>
        </View>

        <View className="mt-12 max-w-xs rounded-lg bg-yellow-50 p-4">
          <Text className="text-xs font-semibold text-yellow-800">⚠️ Phase A 베타 안내</Text>
          <Text className="mt-1 text-xs leading-5 text-yellow-900">
            mock 데이터로 흐름 검증 중. Phase B 통합 후 실제 MediaPipe Pose 분석으로 교체됩니다.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

/* mock 결과 주입 — Phase B 에서 실제 파이프라인 교체 시 제거 */
function injectMockResult(mvId: string) {
  const movement = AppConfig.MOVEMENTS.find((m) => m.id === mvId);
  if (!movement) return;

  const ranges = movement.ranges as unknown as Record<string, JointRange>;

  // mvId별로 mock issue를 다르게 — 큐 단계마다 결과가 달라 보이도록
  const seed = simpleHash(mvId);
  const issueKeys = pickIssueKeys(Object.keys(ranges), seed);

  const jointSummary: Record<string, JointSummaryEntry> = {};
  Object.entries(ranges).forEach(([key, range]) => {
    const isMockIssue = issueKeys.includes(key);
    const worst = isMockIssue ? range.min - 12 : range.min + 5;
    jointSummary[key] = {
      avg: Math.round((range.min + range.max) / 2 - (isMockIssue ? 8 : 0)),
      min: range.min - (isMockIssue ? 12 : 5),
      max: range.max,
      worst,
      risk: isMockIssue ? 'danger' : 'normal',
      name: range.name,
      range,
      issueRate: isMockIssue ? 0.6 : 0.05,
      totalFrames: 120,
    };
  });

  const criticalIssues: Capture[] = issueKeys.map((k, i) => {
    const range = ranges[k] ?? { min: 50, max: 130, name: k };
    return {
      id: `mock-${mvId}-${i}`,
      jointKey: k,
      jointName: range.name,
      angle: range.min - (10 + i * 2),
      normalRange: range,
      severity: i === 0 ? 'danger' : 'warning',
      expertClass: 'CRITICAL',
      timeMs: 2000 + i * 1500,
      repeatCount: 3 - Math.min(i, 2),
      repeatRate: 0.6 - i * 0.1,
      isRepresentative: true,
    };
  });

  SH.setJointSummary(jointSummary);
  SH.setCritical(criticalIssues);
  SH.setScore(60 + (seed % 25));
  SH.setResult({ isComplete: true });
}

function pickIssueKeys(keys: string[], seed: number): string[] {
  // 2~3개를 결정적으로 선택 (mvId 기반)
  const n = 2 + (seed % 2);
  const sorted = [...keys].sort();
  const out: string[] = [];
  for (let i = 0; i < n && i < sorted.length; i += 1) {
    out.push(sorted[(seed + i * 7) % sorted.length]);
  }
  return Array.from(new Set(out));
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
