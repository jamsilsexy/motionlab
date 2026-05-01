import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type Member } from '@/lib/analysis';
import { signOut, useAuth } from '@/lib/auth';
import { listMembers } from '@/lib/members';

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMembers = useCallback(async () => {
    try {
      const list = await listMembers();
      setMembers(list);
    } catch (err) {
      Alert.alert('회원 목록 불러오기 실패', (err as Error).message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      await fetchMembers();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [fetchMembers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMembers();
    setRefreshing(false);
  }, [fetchMembers]);

  const onSignOut = async () => {
    Alert.alert('로그아웃', '정말 로그아웃하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 pt-4">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-xl font-bold text-gray-900">회원 목록</Text>
            <Text className="mt-0.5 text-xs text-gray-500">{user?.email ?? ''}</Text>
          </View>
          <Pressable
            onPress={onSignOut}
            className="rounded-md bg-gray-100 px-3 py-1.5 active:bg-gray-200"
          >
            <Text className="text-xs text-gray-700">로그아웃</Text>
          </Pressable>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#4f46e5" />
          </View>
        ) : (
          <FlatList
            data={members}
            keyExtractor={(m) => m.id}
            className="mt-4"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ItemSeparatorComponent={() => <View className="h-2" />}
            ListEmptyComponent={
              <View className="mt-12 items-center px-6">
                <Text className="text-base text-gray-700">아직 등록된 회원이 없습니다</Text>
                <Text className="mt-2 text-center text-sm text-gray-500">
                  아래 + 새 회원 등록 버튼으로 첫 회원을 추가하세요
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => router.push(`/members/${item.id}`)}
                className="rounded-lg border border-gray-200 bg-white p-4 active:bg-gray-50"
              >
                <Text className="text-base font-semibold text-gray-900">
                  {item.name || '이름 없음'}
                </Text>
                <Text className="mt-1 text-xs text-gray-500">
                  {[
                    item.gender === 'male' ? '남' : item.gender === 'female' ? '여' : null,
                    item.age ? `${item.age}세` : null,
                    item.goal && goalLabel(item.goal),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {item.lastAnalysis && (
                  <Text className="mt-1 text-[11px] text-gray-400">
                    마지막 분석: {new Date(item.lastAnalysis).toLocaleDateString('ko-KR')}
                  </Text>
                )}
              </Pressable>
            )}
          />
        )}

        <Pressable
          onPress={() => router.push('/members/new')}
          className="mb-3 mt-3 items-center rounded-lg bg-indigo-600 py-3.5 active:bg-indigo-700"
        >
          <Text className="text-base font-semibold text-white">+ 새 회원 등록</Text>
        </Pressable>

        <Text className="text-center text-[10px] text-gray-400">
          본 앱은 의료기기가 아니며 분석 결과는 참고용입니다.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function goalLabel(g: string): string {
  switch (g) {
    case 'weight':
      return '체중 감량';
    case 'performance':
      return '퍼포먼스';
    case 'rehab':
      return '재활';
    default:
      return '일반 건강';
  }
}
