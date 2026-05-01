import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppConfig, type Member, SH } from '@/lib/analysis';
import { getMember } from '@/lib/members';

type MvId = 'ohs_front' | 'ohs_side';

export default function VideoUploadScreen() {
  const router = useRouter();
  const { memberId } = useLocalSearchParams<{ memberId?: string }>();
  const [member, setMember] = useState<Member | null>(null);
  const [mvId, setMvId] = useState<MvId>('ohs_front');
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!memberId) {
        if (active) setLoading(false);
        return;
      }
      try {
        const m = await getMember(memberId);
        if (active) setMember(m);
      } catch {
        // ignore — 회원 정보 없어도 분석은 가능
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [memberId]);

  const onPickVideo = async () => {
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          '권한 필요',
          '영상 분석을 위해 사진/영상 라이브러리 접근 권한이 필요합니다.',
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        videoMaxDuration: 30,
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setVideoUri(result.assets[0].uri);
    } catch (err) {
      Alert.alert('영상 선택 실패', (err as Error).message);
    } finally {
      setPicking(false);
    }
  };

  const onStart = () => {
    if (!videoUri || !memberId) {
      Alert.alert('영상 필요', '먼저 영상을 선택해 주세요.');
      return;
    }
    SH.setMovement(mvId);
    SH.setSessionVideo(videoUri);
    if (member) SH.setSessionMember(member);
    router.push(`/analysis/run?memberId=${memberId}`);
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#4f46e5" />
      </SafeAreaView>
    );
  }

  const movementInfo = AppConfig.MOVEMENTS.find((m) => m.id === mvId);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center border-b border-gray-200 px-4 py-3">
        <Pressable onPress={() => router.back()}>
          <Text className="text-base text-indigo-600">← 뒤로</Text>
        </Pressable>
        <Text className="ml-4 flex-1 text-base font-semibold text-gray-900">영상 업로드</Text>
      </View>

      <View className="flex-1 px-6 pt-4">
        <Text className="text-xs text-gray-500">회원</Text>
        <Text className="mt-0.5 text-base font-semibold text-gray-900">
          {member?.name || '미지정'}
        </Text>

        <Text className="mt-6 text-xs font-semibold text-gray-700">분석 운동</Text>
        <View className="mt-1.5 flex-row overflow-hidden rounded-lg border border-gray-300">
          <Pressable
            onPress={() => setMvId('ohs_front')}
            className={`flex-1 items-center py-2.5 ${
              mvId === 'ohs_front' ? 'bg-indigo-600' : 'bg-white active:bg-gray-100'
            }`}
          >
            <Text
              className={`text-sm ${
                mvId === 'ohs_front' ? 'font-semibold text-white' : 'text-gray-700'
              }`}
            >
              OHS 정면
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMvId('ohs_side')}
            className={`flex-1 items-center border-l border-gray-300 py-2.5 ${
              mvId === 'ohs_side' ? 'bg-indigo-600' : 'bg-white active:bg-gray-100'
            }`}
          >
            <Text
              className={`text-sm ${
                mvId === 'ohs_side' ? 'font-semibold text-white' : 'text-gray-700'
              }`}
            >
              OHS 측면
            </Text>
          </Pressable>
        </View>

        {movementInfo && (
          <View className="mt-3 rounded-lg bg-indigo-50 p-4">
            <Text className="text-xs font-semibold text-indigo-700">
              {movementInfo.label} 촬영 가이드
            </Text>
            <Text className="mt-1.5 text-xs leading-5 text-indigo-900">
              📐 {movementInfo.guide.angle}
              {'\n'}🎯 {movementInfo.guide.frame}
              {'\n'}🔢 {movementInfo.guide.reps}
              {'\n'}📏 {movementInfo.guide.height}
            </Text>
          </View>
        )}

        <View className="mt-6">
          <Text className="text-xs font-semibold text-gray-700">분석 영상</Text>
          {videoUri ? (
            <View className="mt-1.5 rounded-lg border border-green-300 bg-green-50 p-4">
              <Text className="text-sm font-semibold text-green-800">✓ 영상 선택 완료</Text>
              <Text className="mt-1 text-[11px] text-gray-600" numberOfLines={1}>
                {videoUri}
              </Text>
              <Pressable onPress={onPickVideo} className="mt-2">
                <Text className="text-xs text-indigo-600">다른 영상 선택</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={onPickVideo}
              disabled={picking}
              className="mt-1.5 items-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 py-12 active:bg-gray-100"
            >
              {picking ? (
                <ActivityIndicator color="#4f46e5" />
              ) : (
                <>
                  <Text className="text-3xl">🎥</Text>
                  <Text className="mt-2 text-sm font-semibold text-gray-700">
                    갤러리에서 영상 선택
                  </Text>
                  <Text className="mt-1 text-xs text-gray-500">최대 30초, MP4/MOV 권장</Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      </View>

      <View className="px-6 pb-4">
        <Pressable
          onPress={onStart}
          disabled={!videoUri}
          className={`items-center rounded-lg py-3.5 ${
            videoUri ? 'bg-indigo-600 active:bg-indigo-700' : 'bg-gray-300'
          }`}
        >
          <Text className="text-base font-semibold text-white">분석 시작</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
