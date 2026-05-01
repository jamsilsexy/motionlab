import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppConfig, SH, useAnalysisStore } from '@/lib/analysis';

/**
 * M5-A1 — upload (영상 분석 단계).
 * 큐의 현재 mvId가 영상이라는 가정하에 동작.
 * static_pose는 static-pose.tsx 에서 별도 처리.
 */
export default function VideoUploadScreen() {
  const router = useRouter();
  const { memberId } = useLocalSearchParams<{ memberId?: string }>();
  const session = useAnalysisStore((s) => s.session);
  const [picking, setPicking] = useState(false);

  const mvId = session.selectedMvId;
  const movement = AppConfig.MOVEMENTS.find((m) => m.id === mvId);
  const queueLen = session.analysisQueue.length;
  const stepNum = session.currentQueueIdx + 1;

  useEffect(() => {
    // 큐 컨텍스트가 없거나 static_pose 단계면 정합성 확보
    if (!queueLen) {
      router.replace('/');
      return;
    }
    if (movement?.isStatic) {
      router.replace(`/analysis/static-pose?memberId=${memberId ?? ''}`);
    }
  }, [queueLen, movement?.isStatic, memberId, router]);

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
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        videoMaxDuration: 30,
        quality: 1,
      });
      if (r.canceled || !r.assets?.[0]) return;
      SH.setSessionVideo(r.assets[0].uri);
    } catch (err) {
      Alert.alert('영상 선택 실패', (err as Error).message);
    } finally {
      setPicking(false);
    }
  };

  const onStart = () => {
    if (!session.videoUri) {
      Alert.alert('영상 필요', '먼저 영상을 선택해 주세요.');
      return;
    }
    router.push(`/analysis/run?memberId=${memberId ?? ''}`);
  };

  const skipStep = () => {
    Alert.alert('단계 건너뛰기', `${movement?.label ?? '현재 단계'} 분석을 건너뛰시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '건너뛰기',
        style: 'destructive',
        onPress: () => {
          const next = SH.advanceQueue();
          if (!next) {
            router.replace(`/analysis/report?memberId=${memberId ?? ''}`);
          } else {
            const nextMv = AppConfig.MOVEMENTS.find((m) => m.id === next);
            if (nextMv?.isStatic) {
              router.replace(`/analysis/static-pose?memberId=${memberId ?? ''}`);
            }
            // 영상이면 같은 화면 (state 갱신으로 자동 reflow)
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center border-b border-gray-200 px-4 py-3">
        <Pressable onPress={() => router.back()}>
          <Text className="text-base text-indigo-600">← 뒤로</Text>
        </Pressable>
        <Text className="ml-4 flex-1 text-base font-semibold text-gray-900">
          {stepNum}/{queueLen} {movement?.label ?? '영상 업로드'}
        </Text>
        <Pressable onPress={skipStep}>
          <Text className="text-sm text-gray-500">건너뛰기</Text>
        </Pressable>
      </View>

      <ScrollView className="flex-1 px-6 pt-4" keyboardShouldPersistTaps="handled">
        <Text className="text-xs text-gray-500">회원</Text>
        <Text className="mt-0.5 text-base font-semibold text-gray-900">
          {session.memberData?.name || '미지정'}
        </Text>

        {session.staticPoseResult?.recommendedSideMessage && mvId === 'ohs_side' && (
          <View className="mt-4 rounded-lg bg-yellow-50 p-3">
            <Text className="text-xs font-semibold text-yellow-800">
              📍 정적 분석 기반 측면 촬영 가이드
            </Text>
            <Text className="mt-1 text-xs leading-5 text-yellow-900">
              {session.staticPoseResult.recommendedSideMessage}
            </Text>
          </View>
        )}

        {movement && (
          <View className="mt-4 rounded-lg bg-indigo-50 p-4">
            <Text className="text-xs font-semibold text-indigo-700">
              {movement.icon} {movement.label} 촬영 가이드
            </Text>
            <Text className="mt-1.5 text-xs leading-5 text-indigo-900">
              📐 {movement.guide.angle}
              {'\n'}🎯 {movement.guide.frame}
              {'\n'}🔢 {movement.guide.reps}
              {'\n'}📏 {movement.guide.height}
            </Text>
            {movement.guide.extra && (
              <Text className="mt-2 text-[11px] italic leading-5 text-indigo-800">
                {movement.guide.extra}
              </Text>
            )}
          </View>
        )}

        {movement?.checks && movement.checks.length > 0 && (
          <View className="mt-3">
            <Text className="text-xs font-semibold text-gray-700">분석 항목</Text>
            <View className="mt-1.5 flex-row flex-wrap">
              {movement.checks.map((c, i) => (
                <View
                  key={i}
                  className="mb-1.5 mr-1.5 flex-row items-center rounded-full bg-gray-100 px-2.5 py-1"
                >
                  <Text className="mr-1 text-xs">{c.ico}</Text>
                  <Text className="text-[11px] text-gray-700">{c.name}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View className="mt-5">
          <Text className="text-xs font-semibold text-gray-700">분석 영상</Text>
          {session.videoUri ? (
            <View className="mt-1.5 rounded-lg border border-green-300 bg-green-50 p-4">
              <Text className="text-sm font-semibold text-green-800">✓ 영상 선택 완료</Text>
              <Text className="mt-1 text-[11px] text-gray-600" numberOfLines={1}>
                {session.videoUri}
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

        <View className="mt-6">
          <Text className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            전체 진행 상황
          </Text>
          <View className="mt-2">
            {session.analysisQueue.map((id, i) => {
              const m = AppConfig.MOVEMENTS.find((mv) => mv.id === id);
              const isCurrent = i === session.currentQueueIdx;
              const isDone = i < session.currentQueueIdx;
              return (
                <View
                  key={id}
                  className={`mb-1.5 flex-row items-center rounded-lg border px-3 py-2 ${
                    isCurrent
                      ? 'border-indigo-300 bg-indigo-50'
                      : isDone
                        ? 'border-green-200 bg-green-50'
                        : 'border-gray-200 bg-white'
                  }`}
                >
                  <Text className="mr-2 text-base">
                    {isDone ? '✅' : isCurrent ? '▶️' : '⏳'}
                  </Text>
                  <Text
                    className={`flex-1 text-sm ${
                      isCurrent
                        ? 'font-semibold text-indigo-800'
                        : isDone
                          ? 'text-green-800'
                          : 'text-gray-500'
                    }`}
                  >
                    {m?.icon} {m?.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View className="h-24" />
      </ScrollView>

      <View className="border-t border-gray-200 px-6 py-3">
        <Pressable
          onPress={onStart}
          disabled={!session.videoUri}
          className={`items-center rounded-lg py-3.5 ${
            session.videoUri ? 'bg-indigo-600 active:bg-indigo-700' : 'bg-gray-300'
          }`}
        >
          <Text className="text-base font-semibold text-white">분석 시작</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
