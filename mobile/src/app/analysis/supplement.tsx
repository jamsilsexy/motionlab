import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppConfig, type ResultState, SH, useAnalysisStore } from '@/lib/analysis';

/**
 * M5-A5 — 보완 테스트 추천 (web v17 _goToSupplementOrResult).
 * OHS 단계 끝나면 결과 따라 hip_hinge / lunge / wall_angel 추천. 사용자 수락 시 큐에 push.
 *
 * Phase B에서 AnalysisEngine.decideSupplementTest() 실 함수로 교체.
 */
export default function SupplementScreen() {
  const router = useRouter();
  const { memberId } = useLocalSearchParams<{ memberId?: string }>();
  const session = useAnalysisStore((s) => s.session);
  const suppId = session.supplementId;
  const supplement = AppConfig.MOVEMENTS.find((m) => m.id === suppId);
  const reason = useReasonForSupplement(suppId);

  useEffect(() => {
    if (!suppId) {
      router.replace(`/analysis/report?memberId=${memberId ?? ''}`);
    }
  }, [suppId, memberId, router]);

  if (!suppId || !supplement) return null;

  const onAccept = () => {
    SH.appendToQueue(suppId);
    SH.advanceQueue(); // 새로 추가된 단계로 이동
    SH.setSupplementId(null);
    router.replace(`/analysis/video-analyze?memberId=${memberId ?? ''}`);
  };

  const onSkip = () => {
    SH.markSupplementSkipped();
    SH.setSupplementId(null);
    router.replace(`/analysis/report?memberId=${memberId ?? ''}`);
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center border-b border-gray-200 px-4 py-3">
        <Text className="flex-1 text-base font-semibold text-gray-900">보완 테스트 추천</Text>
      </View>

      <ScrollView className="flex-1 px-6 pt-6">
        <View className="items-center">
          <Text className="text-5xl">{supplement.icon}</Text>
          <Text className="mt-3 text-xl font-bold text-gray-900">{supplement.label}</Text>
          <Text className="mt-1 text-xs text-gray-500">보완 테스트 (선택)</Text>
        </View>

        <View className="mt-6 rounded-lg bg-indigo-50 p-4">
          <Text className="text-xs font-semibold text-indigo-700">왜 추천하나요?</Text>
          <Text className="mt-1.5 text-sm leading-6 text-indigo-900">{reason}</Text>
        </View>

        <View className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <Text className="text-xs font-semibold text-gray-700">{supplement.label} 안내</Text>
          <Text className="mt-1.5 text-xs leading-5 text-gray-600">{supplement.desc}</Text>
        </View>

        <View className="mt-4 rounded-lg bg-gray-50 p-4">
          <Text className="text-xs font-semibold text-gray-700">선택 옵션</Text>
          <Text className="mt-1 text-xs leading-5 text-gray-600">
            • 진행하면 OHS 분석 결과 위에 보완 데이터가 더해져 더 정확한 처방이 가능해집니다.
            {'\n'}• 건너뛰면 현재까지의 데이터로 즉시 종합 리포트를 확인합니다.
          </Text>
        </View>

        <View className="h-24" />
      </ScrollView>

      <View className="flex-row border-t border-gray-200 px-6 py-3">
        <Pressable
          onPress={onSkip}
          className="mr-2 flex-1 items-center rounded-lg border border-gray-300 py-3.5 active:bg-gray-50"
        >
          <Text className="text-base font-semibold text-gray-700">건너뛰기</Text>
        </Pressable>
        <Pressable
          onPress={onAccept}
          className="ml-2 flex-1 items-center rounded-lg bg-indigo-600 py-3.5 active:bg-indigo-700"
        >
          <Text className="text-base font-semibold text-white">진행</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function useReasonForSupplement(suppId: string | null): string {
  const allResults = useAnalysisStore((s) => s.session.allResults);
  if (!suppId) return '';
  const triggerJoints = collectTriggerJoints(allResults);
  const entry = AppConfig.SUPPLEMENT_MAP.find((m) =>
    m.triggerJoints.some((j) => triggerJoints.has(j)),
  );
  return entry?.reason ?? '추가 데이터 수집을 권장합니다.';
}

function collectTriggerJoints(allResults: Record<string, ResultState>): Set<string> {
  const set = new Set<string>();
  for (const r of Object.values(allResults)) {
    for (const c of r.criticalIssues) {
      set.add(c.jointKey);
    }
  }
  return set;
}
