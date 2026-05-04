import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  analyzeVideoFile,
  AppConfig,
  SH,
  useAnalysisStore,
  type ResultState,
  type VideoAnalyzeProgress,
} from '@/lib/analysis';

/**
 * B-3 fix2 — 영상 파일 분석 화면 (라이브 카메라 대안).
 *
 * 흐름:
 * 1. 갤러리에서 영상 선택 (image-picker)
 * 2. analyzeVideoFile 호출 — 0.2s 간격 frame 추출 → PoseDetectionOnImage
 *    → frameHistory 누적 → SquatTracker.update → finalizeResult
 * 3. 종료 후 saveCurrentResult → advanceQueue → 다음 화면
 *
 * 라이브 카메라(camera.tsx)와 결과 호환. 동일 흐름 사용.
 */
export default function VideoAnalyzeScreen() {
  const router = useRouter();
  const { memberId } = useLocalSearchParams<{ memberId?: string }>();
  const session = useAnalysisStore((s) => s.session);
  const repIndex = useAnalysisStore((s) => s.squatTracker.repIndex);

  const [picking, setPicking] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [progress, setProgress] = useState<VideoAnalyzeProgress | null>(null);
  const [running, setRunning] = useState(false);
  const navigatedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const mvId = session.selectedMvId;
  const movement = AppConfig.MOVEMENTS.find((m) => m.id === mvId);
  const queueLen = session.analysisQueue.length;
  const stepNum = session.currentQueueIdx + 1;

  /* mvId 변경 시 화면 state 초기화 */
  useEffect(() => {
    navigatedRef.current = false;
    setVideoUri(null);
    setVideoDuration(0);
    setProgress(null);
    setRunning(false);
  }, [mvId]);

  /* 큐 컨텍스트 검증 */
  useEffect(() => {
    if (!queueLen || !mvId) {
      router.replace('/');
    }
  }, [queueLen, mvId, router]);

  const onPickVideo = async () => {
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('권한 필요', '갤러리 영상 분석을 위해 라이브러리 접근 권한이 필요합니다.');
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        videoMaxDuration: 30,
        quality: 1,
      });
      if (r.canceled || !r.assets?.[0]) return;
      const asset = r.assets[0];
      setVideoUri(asset.uri);
      // duration은 seconds 단위로 들어옴 (image-picker)
      const durMs = asset.duration ? Math.round(asset.duration) : 0;
      setVideoDuration(durMs);
    } catch (err) {
      Alert.alert('영상 선택 실패', (err as Error).message);
    } finally {
      setPicking(false);
    }
  };

  const onStart = async () => {
    if (!videoUri || running) return;
    setRunning(true);
    setProgress({ phase: 'extracting', current: 0, total: 0 });
    abortRef.current = new AbortController();

    // progress callback throttle — 매 frame setProgress 시 React re-render 비용 큼.
    // detecting 단계에서만 5 frame마다 갱신, 단계 전환은 항상 갱신.
    let lastProgressUpdate = 0;
    const onProgressThrottled = (p: VideoAnalyzeProgress) => {
      const now = Date.now();
      if (
        p.phase !== 'detecting' ||
        p.current === 0 ||
        p.current === p.total ||
        now - lastProgressUpdate >= 250
      ) {
        lastProgressUpdate = now;
        setProgress(p);
      }
    };

    const result = await analyzeVideoFile({
      videoUri,
      videoDurationMs: videoDuration,
      onProgress: onProgressThrottled,
      signal: abortRef.current.signal,
    });

    setRunning(false);

    if (!result.ok) {
      Alert.alert('분석 실패', result.error);
      setProgress(null);
      return;
    }

    if (result.frameCount === 0) {
      Alert.alert(
        '랜드마크 검출 실패',
        '영상에서 사람 자세를 감지하지 못했습니다. 전신이 잘 보이는 영상으로 다시 시도해주세요.',
      );
      setProgress(null);
      return;
    }

    finishStep();
  };

  const finishStep = () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;

    const finalResult = useAnalysisStore.getState().result;
    if (mvId) SH.saveCurrentResult(mvId, finalResult);
    const next = SH.advanceQueue();

    setTimeout(() => {
      if (!next) {
        const sess = useAnalysisStore.getState().session;
        const suppId = decideSupplementTest(
          sess.allResults,
          sess.analysisQueue,
          sess.supplementSkipped,
        );
        if (suppId) {
          SH.setSupplementId(suppId);
          router.replace(`/analysis/supplement?memberId=${memberId ?? ''}`);
          return;
        }
        router.replace(`/analysis/report?memberId=${memberId ?? ''}`);
        return;
      }
      const nextMv = AppConfig.MOVEMENTS.find((m) => m.id === next);
      if (nextMv?.isStatic) {
        router.replace(`/analysis/static-pose?memberId=${memberId ?? ''}`);
      } else {
        router.replace(`/analysis/video-analyze?memberId=${memberId ?? ''}`);
      }
    }, 600);
  };

  const onCancel = () => {
    if (running) {
      abortRef.current?.abort();
      setRunning(false);
      setProgress(null);
      return;
    }
    Alert.alert('분석 취소', '현재 단계 분석을 취소합니다.', [
      { text: '계속', style: 'cancel' },
      {
        text: '취소',
        style: 'destructive',
        onPress: () => {
          navigatedRef.current = true;
          router.replace(`/members/${memberId ?? ''}`);
        },
      },
    ]);
  };

  const goLiveCamera = () => {
    Alert.alert(
      '라이브 카메라로 전환',
      '회원이 그 자리에서 OHS를 수행하는 라이브 분석으로 전환합니다.\n\n이후 OHS 단계도 라이브 카메라로 진행됩니다 (다시 영상 분석으로 돌아오려면 카메라 화면 상단의 "🎥 영상으로" 버튼).',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '전환',
          onPress: () => router.replace(`/analysis/camera?memberId=${memberId ?? ''}`),
        },
      ],
    );
  };

  /* ── 렌더 ─────────────────────────────────────────────── */
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center border-b border-gray-200 px-4 py-3">
        <Pressable onPress={onCancel}>
          <Text className="text-base text-indigo-600">← {running ? '중단' : '취소'}</Text>
        </Pressable>
        <Text className="ml-4 flex-1 text-base font-semibold text-gray-900">
          {stepNum}/{queueLen} {movement?.icon} {movement?.label} (영상 분석)
        </Text>
      </View>

      <ScrollView className="flex-1 px-6 pt-4">
        <Text className="text-xs text-gray-500">회원</Text>
        <Text className="mt-0.5 text-base font-semibold text-gray-900">
          {session.memberData?.name || '미지정'}
        </Text>

        {movement && (
          <View className="mt-4 rounded-lg bg-indigo-50 p-3">
            <Text className="text-[11px] font-semibold text-indigo-700">
              📐 {movement.label} 영상 가이드
            </Text>
            <Text className="mt-1 text-[11px] leading-4 text-indigo-900">
              {movement.guide.angle}
              {'\n'}
              {movement.guide.frame}
              {'\n'}권장: {movement.guide.reps} (3-30초 영상)
            </Text>
          </View>
        )}

        {/* 영상 선택 */}
        <View className="mt-5">
          <Text className="text-xs font-semibold text-gray-700">분석 영상</Text>
          {videoUri ? (
            <View className="mt-1.5 rounded-lg border border-green-300 bg-green-50 p-4">
              <Text className="text-sm font-semibold text-green-800">✓ 영상 선택 완료</Text>
              <Text className="mt-1 text-[11px] text-gray-600" numberOfLines={1}>
                {videoUri.split('/').pop()}
              </Text>
              {videoDuration > 0 && (
                <Text className="mt-0.5 text-[11px] text-gray-500">
                  길이 {(videoDuration / 1000).toFixed(1)}초
                </Text>
              )}
              {!running && (
                <Pressable onPress={onPickVideo} className="mt-2">
                  <Text className="text-xs text-indigo-600">다른 영상 선택</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <Pressable
              onPress={onPickVideo}
              disabled={picking || running}
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

        {/* 진행도 */}
        {progress && (
          <View className="mt-5 rounded-lg border border-gray-200 bg-white p-4">
            <Text className="text-xs font-semibold text-gray-700">분석 진행</Text>
            <View className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
              <View
                className="h-full bg-indigo-600"
                style={{
                  width: `${progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%` as `${number}%`,
                }}
              />
            </View>
            <Text className="mt-2 text-xs text-gray-500">
              {progress.phase === 'extracting' && `프레임 추출 ${progress.current}/${progress.total}`}
              {progress.phase === 'detecting' && `포즈 검출 ${progress.current}/${progress.total}`}
              {progress.phase === 'finalizing' && '결과 정리 중…'}
              {progress.phase === 'done' && '완료'}
              {progress.phase === 'error' && (progress.message ?? '에러')}
            </Text>
            {repIndex > 0 && (
              <Text className="mt-1 text-[11px] text-indigo-600">
                감지된 반복: {repIndex}회
              </Text>
            )}
          </View>
        )}

        {/* 라이브 카메라로 전환 옵션 — secondary action.
            우연한 클릭 방지:
              1) 첫 OHS step (stepNum === 2 — static_pose 다음 ohs_front) 에서만 노출
                 → ohs_side 등 후속 step에서는 옵션 자체가 사라져 우발 클릭 불가
              2) outline 버튼 + 명확한 hit-area
              3) confirmation Alert (goLiveCamera) */}
        {!running && !videoUri && stepNum === 2 && (
          <View className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <Text className="text-[11px] font-semibold text-gray-500">또는</Text>
            <Pressable
              onPress={goLiveCamera}
              className="mt-2 self-start rounded-md border border-gray-300 bg-white px-3 py-2 active:bg-gray-100"
            >
              <Text className="text-xs font-semibold text-gray-700">
                📷 라이브 카메라로 전환
              </Text>
            </Pressable>
            <Text className="mt-1.5 text-[11px] text-gray-500">
              회원이 그 자리에서 OHS 수행 시 사용 · 두 번째 단계부터는 잠금
            </Text>
          </View>
        )}

        <View className="h-24" />
      </ScrollView>

      <View className="border-t border-gray-200 px-6 py-3">
        <Pressable
          onPress={onStart}
          disabled={!videoUri || running}
          className={`items-center rounded-lg py-3.5 ${
            videoUri && !running ? 'bg-indigo-600 active:bg-indigo-700' : 'bg-gray-300'
          }`}
        >
          {running ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-base font-semibold text-white">분석 시작</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function decideSupplementTest(
  allResults: Record<string, ResultState>,
  alreadyInQueue: string[],
  skipped: boolean,
): string | null {
  if (skipped) return null;
  const triggerJoints = new Set<string>();
  for (const r of Object.values(allResults)) {
    for (const c of r.criticalIssues) {
      if (c.severity === 'danger' || (c.repeatCount ?? 0) >= 3) {
        triggerJoints.add(c.jointKey);
      }
    }
  }
  if (triggerJoints.size === 0) return null;
  const matched = AppConfig.SUPPLEMENT_MAP.find((m) =>
    m.triggerJoints.some((j) => triggerJoints.has(j)),
  );
  if (!matched) return null;
  if (alreadyInQueue.includes(matched.supplementId)) return null;
  return matched.supplementId;
}
