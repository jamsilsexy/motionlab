import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { signOut, useAuth } from '@/lib/auth';

export default function HomeScreen() {
  const { user } = useAuth();

  const onSignOut = async () => {
    await signOut();
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 pt-6">
        <Text className="text-2xl font-bold text-gray-900">FORM AI</Text>
        <Text className="mt-1 text-sm text-gray-500">{user?.email ?? ''}</Text>

        <View className="mt-12 rounded-lg bg-gray-100 p-6">
          <Text className="text-base font-semibold text-gray-700">회원 목록</Text>
          <Text className="mt-2 text-sm text-gray-500">
            M3-2 단계에서 구현 예정 (Firestore에서 트레이너의 회원 목록 + 신규 등록)
          </Text>
        </View>

        <View className="flex-1" />

        <Pressable
          onPress={onSignOut}
          className="mb-2 items-center rounded-lg bg-gray-200 py-3 active:bg-gray-300"
        >
          <Text className="text-sm font-semibold text-gray-700">로그아웃</Text>
        </Pressable>
        <Text className="text-center text-[10px] text-gray-400">
          본 앱은 의료기기가 아니며 분석 결과는 참고용입니다.
        </Text>
      </View>
    </SafeAreaView>
  );
}
