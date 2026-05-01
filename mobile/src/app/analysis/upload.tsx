import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function VideoUploadScreen() {
  const router = useRouter();
  const { memberId } = useLocalSearchParams<{ memberId?: string }>();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center border-b border-gray-200 px-4 py-3">
        <Pressable onPress={() => router.back()}>
          <Text className="text-base text-indigo-600">← 뒤로</Text>
        </Pressable>
        <Text className="ml-4 flex-1 text-base font-semibold text-gray-900">영상 선택</Text>
      </View>
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-base text-gray-700">회원 ID: {memberId ?? '미지정'}</Text>
        <Text className="mt-4 text-center text-sm text-gray-500">
          M3-4 단계에서 expo-image-picker로 갤러리 비디오 선택 구현
        </Text>
      </View>
    </SafeAreaView>
  );
}
