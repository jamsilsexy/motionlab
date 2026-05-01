import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAnalysisStore } from '@/lib/analysis';

export default function AnalysisRunScreen() {
  const router = useRouter();
  const { memberId } = useLocalSearchParams<{ memberId?: string }>();
  const session = useAnalysisStore((s) => s.session);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center border-b border-gray-200 px-4 py-3">
        <Pressable onPress={() => router.back()}>
          <Text className="text-base text-indigo-600">← 뒤로</Text>
        </Pressable>
        <Text className="ml-4 flex-1 text-base font-semibold text-gray-900">분석 진행</Text>
      </View>

      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-base text-gray-700">회원 ID: {memberId ?? '미지정'}</Text>
        <Text className="mt-2 text-sm text-gray-600">운동: {session.selectedMvId || '-'}</Text>
        <Text className="mt-1 text-[11px] text-gray-400" numberOfLines={1}>
          영상 URI: {session.videoUri ?? '-'}
        </Text>
        <Text className="mt-6 text-center text-sm text-gray-500">
          M3-5 단계에서 비디오 → 프레임 → MediaPipe Pose 분석 파이프라인 구현 예정
        </Text>
      </View>
    </SafeAreaView>
  );
}
