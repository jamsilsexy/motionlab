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
 * M3-5 Lean 베타: mock 진행 시뮬레이션 + mock 결과 주입.
 * 실기기 빌드 (M4) 후 실제 MediaPipe Pose 파이프라인으로 교체.
 */
export default function AnalysisRunScreen() {
  const router = useRouter();
  const { memberId } = useLocalSearchParams<{ memberId?: string }>();
  const session = useAnalysisStore((s) => s.session);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('영상 로딩 중');
  const navigatedRef = useRef(false);

  useEffect(() => {
    if (!session.videoUri) {
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
        if (!navigatedRef.current) {
          navigatedRef.current = true;
          injectMockResult();
          router.replace(`/analysis/report?memberId=${memberId ?? ''}`);
        }
        return;
      }
      setProgress(phases[i].p);
      setPhase(phases[i].label);
      i += 1;
    }, 700);

    return () => clearInterval(id);
  }, [session.videoUri, memberId, router]);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-4xl">🏋️</Text>
        <Text className="mt-4 text-base font-semibold text-gray-900">{phase}</Text>

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
          <Text className="text-xs font-semibold text-yellow-800">⚠️ 베타 안내</Text>
          <Text className="mt-1 text-xs leading-5 text-yellow-900">
            현재는 mock 데이터로 화면 흐름 검증. 실기기 빌드(M4) 후 실제 MediaPipe Pose 분석으로
            교체.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

/* mock 결과 주입 — 실제 파이프라인 교체 시 이 함수 제거 */
function injectMockResult() {
  const mvId = useAnalysisStore.getState().session.selectedMvId || 'ohs_front';
  const movement = AppConfig.MOVEMENTS.find((m) => m.id === mvId);
  if (!movement) return;

  const ranges = movement.ranges as unknown as Record<string, JointRange>;

  const jointSummary: Record<string, JointSummaryEntry> = {};
  Object.entries(ranges).forEach(([key, range]) => {
    const isMockIssue = ['leftKnee', 'spine', 'leftHip'].includes(key);
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

  const criticalIssues: Capture[] = [
    {
      id: 'mock-1',
      jointKey: 'leftKnee',
      jointName: '왼쪽 무릎',
      angle: (ranges.leftKnee?.min ?? 55) - 12,
      normalRange: ranges.leftKnee ?? { min: 55, max: 130, name: '왼쪽 무릎' },
      severity: 'danger',
      expertClass: 'CRITICAL',
      timeMs: 2500,
      repeatCount: 3,
      repeatRate: 0.6,
      isRepresentative: true,
    },
    {
      id: 'mock-2',
      jointKey: 'spine',
      jointName: '척추 정렬',
      angle: 138,
      normalRange: ranges.spine ?? { min: 148, max: 180, name: '척추 정렬' },
      severity: 'warning',
      expertClass: 'CRITICAL',
      timeMs: 4200,
      repeatCount: 4,
      repeatRate: 0.8,
      isRepresentative: true,
    },
    {
      id: 'mock-3',
      jointKey: 'leftHip',
      jointName: '왼쪽 고관절',
      angle: 38,
      normalRange: ranges.leftHip ?? { min: 50, max: 120, name: '왼쪽 고관절' },
      severity: 'warning',
      expertClass: 'CRITICAL',
      timeMs: 5800,
      repeatCount: 2,
      repeatRate: 0.4,
      isRepresentative: true,
    },
  ];

  SH.setJointSummary(jointSummary);
  SH.setCritical(criticalIssues);
  SH.setScore(67);
  SH.setResult({ isComplete: true });
}
