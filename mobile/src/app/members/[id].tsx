import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function MemberDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center border-b border-gray-200 px-4 py-3">
        <Pressable onPress={() => router.back()}>
          <Text className="text-base text-indigo-600">← 목록</Text>
        </Pressable>
        <Text className="ml-4 flex-1 text-base font-semibold text-gray-900">회원 상세</Text>
      </View>

      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-base text-gray-700">회원 ID: {id}</Text>
        <Text className="mt-4 text-center text-sm text-gray-500">
          M3-3 단계에서 회원 상세 + 분석 시작 흐름 (ConsentModal → VideoUpload → Analysis)
          구현 예정
        </Text>
      </View>
    </SafeAreaView>
  );
}
