import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type Capture, useAnalysisStore } from '@/lib/analysis';

export default function ReportScreen() {
  const router = useRouter();
  const result = useAnalysisStore((s) => s.result);
  const session = useAnalysisStore((s) => s.session);
  const member = session.memberData;

  const score = result.overallScore;
  const riskColor = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
  const riskLabel = score >= 80 ? '양호' : score >= 60 ? '주의' : '위험';

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center border-b border-gray-200 px-4 py-3">
        <Pressable onPress={() => router.replace('/')}>
          <Text className="text-base text-indigo-600">← 홈</Text>
        </Pressable>
        <Text className="ml-4 flex-1 text-base font-semibold text-gray-900">분석 리포트</Text>
      </View>

      <ScrollView className="flex-1 px-6 pt-4">
        <Text className="text-xs text-gray-500">회원</Text>
        <Text className="mt-0.5 text-base font-semibold text-gray-900">
          {member?.name || '미지정'}
        </Text>
        <Text className="mt-0.5 text-xs text-gray-400">
          {new Date().toLocaleDateString('ko-KR')} · {labelMv(session.selectedMvId)}
        </Text>

        <View className="mt-6 items-center rounded-2xl border border-gray-200 bg-white p-6">
          <Text className="text-xs text-gray-500">종합 점수</Text>
          <Text className="mt-2 text-6xl font-bold" style={{ color: riskColor }}>
            {score}
          </Text>
          <Text className="mt-1 text-sm font-semibold" style={{ color: riskColor }}>
            {riskLabel}
          </Text>
        </View>

        <View className="mt-6">
          <Text className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            핵심 이슈 ({result.criticalIssues.length})
          </Text>
          {result.criticalIssues.length === 0 ? (
            <View className="mt-2 rounded-lg bg-green-50 p-4">
              <Text className="text-sm text-green-800">
                ✓ 큰 문제 없음 — 전반적인 움직임 패턴이 양호합니다
              </Text>
            </View>
          ) : (
            result.criticalIssues.map((c, i) => (
              <IssueCard key={c.id} index={i + 1} capture={c} />
            ))
          )}
        </View>

        <View className="mt-8 rounded-lg bg-yellow-50 p-4">
          <Text className="text-xs font-semibold text-yellow-800">⚠️ 베타 안내</Text>
          <Text className="mt-1 text-xs leading-5 text-yellow-900">
            현재 mock 데이터로 화면 흐름 검증 중. 실기기 빌드(M4) 후 실제 MediaPipe Pose 분석
            결과로 교체. V2에서 sales script / 회원 요약 / PT 권장 회차 / NASM 처방까지 풀 통합
            예정.
          </Text>
        </View>

        <Text className="mt-6 text-center text-[10px] text-gray-400">
          본 앱은 의료기기가 아니며 분석 결과는 참고용입니다.
        </Text>

        <View className="h-24" />
      </ScrollView>

      <View className="px-6 pb-4">
        <Pressable
          onPress={() => router.replace('/')}
          className="items-center rounded-lg bg-indigo-600 py-3.5 active:bg-indigo-700"
        >
          <Text className="text-base font-semibold text-white">완료</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function IssueCard({ index, capture }: { index: number; capture: Capture }) {
  const sevColor = capture.severity === 'danger' ? '#ef4444' : '#f59e0b';
  const sevLabel = capture.severity === 'danger' ? '위험' : '주의';
  const dev = Math.max(
    capture.normalRange.min - capture.angle,
    capture.angle - capture.normalRange.max,
    0,
  );

  return (
    <View className="mt-2 rounded-lg border border-gray-200 bg-white p-4">
      <View className="flex-row items-center">
        <View
          className="mr-3 h-7 w-7 items-center justify-center rounded-full"
          style={{ backgroundColor: sevColor }}
        >
          <Text className="text-xs font-bold text-white">{index}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-gray-900">{capture.jointName}</Text>
          <Text className="mt-0.5 text-xs" style={{ color: sevColor }}>
            {sevLabel} · {Math.round(dev)}° 이탈
          </Text>
        </View>
      </View>
      {(capture.repeatCount ?? 0) > 0 && (
        <Text className="mt-2 text-xs text-gray-600">
          반복 {capture.repeatCount}회 · 빈도 {Math.round((capture.repeatRate ?? 0) * 100)}%
        </Text>
      )}
    </View>
  );
}

function labelMv(mvId: string): string {
  switch (mvId) {
    case 'ohs_front':
      return 'OHS 정면';
    case 'ohs_side':
      return 'OHS 측면';
    case 'hip_hinge':
      return '힙 힌지';
    case 'lunge':
      return '런지';
    case 'wall_angel':
      return 'Wall Angel';
    case 'static_pose':
      return '정적 기립';
    default:
      return mvId || '-';
  }
}
