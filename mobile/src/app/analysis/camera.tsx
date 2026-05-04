import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { MediapipeCamera } from 'react-native-mediapipe-posedetection';

import {
  AnalysisEngine,
  AppConfig,
  SH,
  useAnalysisStore,
  useLivePoseAnalysis,
  type ResultState,
} from '@/lib/analysis';

/**
 * B-3 — 라이브 카메라 분석 화면.
 *
 * upload.tsx (영상 파일) → camera.tsx (라이브 frame processor) 교체.
 *
 * 흐름:
 * 1. 카메라 권한 요청
 * 2. 가이드 카드 표시 (현 mvId 기준)
 * 3. "분석 시작" → 3초 카운트다운 → isAnalyzing=true
 * 4. OHS: SquatTracker rep 수가 SQUAT.TARGET_REPS 도달 OR 30초 경과 → 자동 정지
 *    그 외: 사용자가 "분석 종료" 버튼
 * 5. 정지 → AnalysisEngine.finalizeResult() → saveCurrentResult → advanceQueue → 다음 화면
 *
 * MediaPipe frame processor는 useLivePoseAnalysis hook 안에서 onResults
 *   콜백으로 33 landmark 받아 store 누적. SquatTracker도 자동 update.
 */
export default function CameraAnalysisScreen() {
  const router = useRouter();
  const { memberId } = useLocalSearchParams<{ memberId?: string }>();
  const session = useAnalysisStore((s) => s.session);
  const repIndex = useAnalysisStore((s) => s.squatTracker.repIndex);
  const trackerPhase = useAnalysisStore((s) => s.squatTracker.phase);
  const frameCount = useAnalysisStore((s) => s.realtime.frameCount);
  const currentAngles = useAnalysisStore((s) => s.realtime.currentAngles);

  const [permission, setPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [phase, setPhase] = useState<'idle' | 'counting' | 'analyzing' | 'finalizing'>('idle');
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const navigatedRef = useRef(false);
  // repIndex 최신값을 effect 안에서 참조하기 위한 ref (의존성에 넣으면 effect 재실행되어 타이머 reset 됨)
  const repIndexRef = useRef(0);

  const mvId = session.selectedMvId;
  const movement = AppConfig.MOVEMENTS.find((m) => m.id === mvId);
  const queueLen = session.analysisQueue.length;
  const stepNum = session.currentQueueIdx + 1;
  const isOhs = mvId.startsWith('ohs');
  const targetReps = AppConfig.SQUAT.TARGET_REPS;

  const device = useCameraDevice('back');
  const solution = useLivePoseAnalysis({ isAnalyzing: phase === 'analyzing' });
  const { resetSession } = solution;

  // store repIndex → ref 동기화 (의존성에 넣지 않기 위함)
  repIndexRef.current = repIndex;

  /* ── mvId 변경 시 화면 state 초기화 (advanceQueue 후 같은 path replace 대응) ── */
  useEffect(() => {
    navigatedRef.current = false;
    setPhase('idle');
    setElapsed(0);
    setCountdown(0);
    resetSession();
  }, [mvId, resetSession]);

  /* ── 권한 ─────────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setPermission(status === 'granted' ? 'granted' : 'denied');
    })();
  }, []);

  /* ── 큐 컨텍스트 검증 ─────────────────────────────────── */
  useEffect(() => {
    if (!session.analysisQueue.length || !mvId) {
      router.replace('/');
    }
  }, [session.analysisQueue.length, mvId, router]);

  /* ── 카운트다운 ─────────────────────────────────────────
     주의: solution 객체는 매 render 새 reference라 deps에 넣지 말 것 (무한 reset).
     resetSession 호출은 startAnalysis 시점으로 옮김. */
  useEffect(() => {
    if (phase !== 'counting') return;
    setCountdown(3);
    const id = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          clearInterval(id);
          setPhase('analyzing');
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  /* ── 분석 진행 시간 + 자동 종료 (OHS rep 도달 / 30초) ───
     repIndex는 ref로 참조 (deps에 넣으면 rep 1회 → 타이머 재시작) */
  useEffect(() => {
    if (phase !== 'analyzing') return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      const t = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(t);
      const done =
        (isOhs && repIndexRef.current >= targetReps && t >= 5) || t >= 30;
      if (done) {
        clearInterval(id);
        finalize();
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isOhs, targetReps]);

  /* ── 분석 종료 + 다음 화면 ────────────────────────────── */
  const finalize = () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    setPhase('finalizing');

    try {
      AnalysisEngine.finalizeResult();
    } catch (err) {
      console.warn('[camera] finalizeResult failed:', err);
    }

    const finalResult = useAnalysisStore.getState().result;
    if (mvId) SH.saveCurrentResult(mvId, finalResult);
    const next = SH.advanceQueue();

    setTimeout(() => {
      if (!next) {
        // 큐 끝 — 보완 테스트 추천
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
        router.replace(`/analysis/camera?memberId=${memberId ?? ''}`);
      }
    }, 600);
  };

  const startAnalysis = () => {
    if (phase !== 'idle') return;
    resetSession();
    setPhase('counting');
  };

  const cancelAnalysis = () => {
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

  /* ── 렌더 ─────────────────────────────────────────────── */
  if (permission === 'pending') {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-black">
        <ActivityIndicator color="#fff" />
        <Text className="mt-3 text-sm text-white">카메라 권한 확인 중…</Text>
      </SafeAreaView>
    );
  }

  if (permission === 'denied') {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-base font-semibold text-gray-900">카메라 권한이 필요합니다</Text>
        <Text className="mt-2 text-center text-xs text-gray-600">
          체형 분석은 라이브 카메라로 진행합니다. 설정에서 카메라 접근을 허용한 뒤 다시 시도해주세요.
        </Text>
        <Pressable
          onPress={() => router.replace('/')}
          className="mt-6 rounded-lg bg-indigo-600 px-6 py-3"
        >
          <Text className="text-sm font-semibold text-white">홈으로</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-black">
        <Text className="text-sm text-white">카메라 디바이스를 찾을 수 없습니다</Text>
      </SafeAreaView>
    );
  }

  const goVideoAnalyze = () => {
    router.replace(`/analysis/video-analyze?memberId=${memberId ?? ''}`);
  };

  return (
    <View className="flex-1 bg-black">
      <MediapipeCamera
        style={{ flex: 1 }}
        solution={solution}
        activeCamera="back"
        resizeMode="cover"
      />

      {/* 상단 가이드 / 헤더 */}
      <SafeAreaView edges={['top']} className="absolute left-0 right-0 top-0">
        <View className="flex-row items-center px-4 py-3">
          <Pressable onPress={cancelAnalysis} disabled={phase === 'finalizing'}>
            <Text className="text-sm font-semibold text-white">← 취소</Text>
          </Pressable>
          <Text className="ml-4 flex-1 text-sm font-semibold text-white">
            {stepNum}/{queueLen} {movement?.icon} {movement?.label}
          </Text>
          {phase === 'idle' && (
            <Pressable onPress={goVideoAnalyze}>
              <Text className="text-xs font-semibold text-indigo-300">🎥 영상으로</Text>
            </Pressable>
          )}
        </View>

        {phase === 'idle' && movement && (
          <View className="mx-4 mt-2 rounded-lg bg-black/70 p-3">
            <Text className="text-[11px] font-semibold text-indigo-300">📐 촬영 가이드</Text>
            <Text className="mt-1 text-[11px] leading-4 text-white">
              {movement.guide.angle}
              {'\n'}
              {movement.guide.frame}
              {'\n'}
              {movement.guide.height}
              {'\n'}
              <Text className="text-[11px] text-indigo-300">권장: {movement.guide.reps}</Text>
            </Text>
          </View>
        )}
      </SafeAreaView>

      {/* 카운트다운 오버레이 */}
      {phase === 'counting' && (
        <View className="pointer-events-none absolute inset-0 items-center justify-center">
          <Text className="text-9xl font-black text-white" style={{ textShadowColor: '#000', textShadowRadius: 8 }}>
            {countdown}
          </Text>
        </View>
      )}

      {/* 분석 중 진행도 */}
      {phase === 'analyzing' && (
        <SafeAreaView edges={['top']} className="absolute left-0 right-0 top-16 items-center">
          <View className="rounded-full bg-red-600 px-3 py-1">
            <Text className="text-[11px] font-bold text-white">● 분석 중 {elapsed}s</Text>
          </View>
          {isOhs && (
            <View className="mt-2 rounded-lg bg-black/70 px-3 py-1.5">
              <Text className="text-xs font-semibold text-white">
                반복 {repIndex} / {targetReps}회
              </Text>
            </View>
          )}
          <View className="mt-1 rounded-lg bg-black/40 px-3 py-1">
            <Text className="text-[10px] text-white">frame {frameCount}</Text>
          </View>
          {/* 디버그 패널 — rep 카운트 디버깅용. 안정화 후 제거 가능 */}
          <View className="mt-1 rounded-lg bg-black/60 px-3 py-1">
            <Text className="text-[10px] text-yellow-200">
              L무릎 {currentAngles.leftKnee ?? '-'}° / R무릎 {currentAngles.rightKnee ?? '-'}° ·{' '}
              phase:{trackerPhase}
            </Text>
          </View>
        </SafeAreaView>
      )}

      {/* 종료 처리 중 */}
      {phase === 'finalizing' && (
        <View className="absolute inset-0 items-center justify-center bg-black/60">
          <ActivityIndicator color="#fff" size="large" />
          <Text className="mt-3 text-sm font-semibold text-white">분석 결과 정리 중…</Text>
        </View>
      )}

      {/* 하단 컨트롤 */}
      <SafeAreaView edges={['bottom']} className="absolute left-0 right-0 bottom-0">
        <View className="px-6 pb-4">
          {phase === 'idle' && (
            <Pressable
              onPress={startAnalysis}
              className="items-center rounded-xl bg-indigo-600 py-4 active:bg-indigo-700"
            >
              <Text className="text-base font-bold text-white">분석 시작</Text>
              <Text className="mt-0.5 text-[10px] text-indigo-200">
                3초 카운트다운 후 자동 시작
              </Text>
            </Pressable>
          )}
          {phase === 'analyzing' && (
            <Pressable
              onPress={finalize}
              className="items-center rounded-xl bg-red-600 py-4 active:bg-red-700"
            >
              <Text className="text-base font-bold text-white">분석 종료</Text>
              <Text className="mt-0.5 text-[10px] text-red-200">
                자동 종료: {isOhs ? `${targetReps}회 반복 또는 30초` : '30초'}
              </Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

/* 보완 테스트 결정 — run.tsx에서 그대로 이전 */
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
