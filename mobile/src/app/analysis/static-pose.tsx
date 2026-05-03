import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  analyzeStaticPose,
  AppConfig,
  SH,
  type StaticPoseResult,
  useAnalysisStore,
} from '@/lib/analysis';

/**
 * M5-A2 — static_pose 화면 (큐의 첫 단계).
 * 사진 1장 → 정면 정렬 mock 분석 → 좌/우 OHS 측면 촬영 방향 추천 → 다음 단계 자동 진입.
 *
 * Phase B 에서 StaticPoseAnalyzer.analyze() 실 함수로 mockAnalyze 교체.
 */
export default function StaticPoseScreen() {
  const router = useRouter();
  const { memberId } = useLocalSearchParams<{ memberId?: string }>();
  const session = useAnalysisStore((s) => s.session);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<StaticPoseResult | null>(null);

  const movement = AppConfig.MOVEMENTS.find((m) => m.id === 'static_pose');

  useEffect(() => {
    // 큐 컨텍스트가 없으면 (직접 URL 진입 등) 회원 목록으로 보냄
    if (!session.analysisQueue.length) {
      router.replace('/');
    }
  }, [session.analysisQueue.length, router]);

  const pickPhoto = async () => {
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('권한 필요', '체형 사진 분석을 위해 사진 라이브러리 접근 권한이 필요합니다.');
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      if (r.canceled || !r.assets?.[0]) return;
      setPhotoUri(r.assets[0].uri);
      setResult(null);
    } catch (err) {
      Alert.alert('사진 선택 실패', (err as Error).message);
    } finally {
      setPicking(false);
    }
  };

  const runAnalysis = async () => {
    if (!photoUri) return;
    setAnalyzing(true);
    try {
      const r = await analyzeStaticPose(photoUri);
      const result = buildStaticPoseResult(photoUri, r);
      SH.setStaticPoseResult(result);
      // OHS 측면 방향이 결정됐으면 가이드에 반영 (web v17 로직)
      if (result.recommendedSideDirection) {
        const ohsSide = AppConfig.MOVEMENTS.find((m) => m.id === 'ohs_side');
        if (ohsSide && result.recommendedSideMessage) {
          ohsSide.guide.angle = result.recommendedSideMessage;
        }
      }
      setResult(result);
    } catch (err) {
      Alert.alert(
        '분석 실패',
        `정적 자세 분석에 실패했습니다.\n${(err as Error).message}\n다른 사진으로 다시 시도해주세요.`,
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const goNext = () => {
    const next = SH.advanceQueue();
    if (!next) {
      router.replace(`/analysis/report?memberId=${memberId ?? ''}`);
      return;
    }
    // 다음은 OHS 정면(영상). camera 화면으로.
    router.replace(`/analysis/camera?memberId=${memberId ?? ''}`);
  };

  const skipStep = () => {
    Alert.alert(
      '정적 분석 건너뛰기',
      '정적 분석 없이 OHS 영상 분석으로 넘어가시겠습니까? 좌우 비대칭 자동 감지를 건너뜁니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '건너뛰기',
          style: 'destructive',
          onPress: () => {
            SH.setStaticPoseResult(null);
            goNext();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center border-b border-gray-200 px-4 py-3">
        <Pressable onPress={() => router.back()} disabled={analyzing}>
          <Text className="text-base text-indigo-600">← 회원</Text>
        </Pressable>
        <Text className="ml-4 flex-1 text-base font-semibold text-gray-900">
          1/3 정적 자세 분석
        </Text>
        <Pressable onPress={skipStep} disabled={analyzing}>
          <Text className="text-sm text-gray-500">건너뛰기</Text>
        </Pressable>
      </View>

      <ScrollView className="flex-1 px-6 pt-4" keyboardShouldPersistTaps="handled">
        <Text className="text-xs text-gray-500">회원</Text>
        <Text className="mt-0.5 text-base font-semibold text-gray-900">
          {session.memberData?.name || '미지정'}
        </Text>

        {movement && (
          <View className="mt-5 rounded-lg bg-indigo-50 p-4">
            <Text className="text-xs font-semibold text-indigo-700">
              {movement.icon} {movement.label} 촬영 가이드
            </Text>
            <Text className="mt-1.5 text-xs leading-5 text-indigo-900">
              📐 {movement.guide.angle}
              {'\n'}🎯 {movement.guide.frame}
              {'\n'}📏 {movement.guide.height}
            </Text>
          </View>
        )}

        <View className="mt-5">
          <Text className="text-xs font-semibold text-gray-700">정면 사진</Text>
          {photoUri ? (
            <View className="mt-1.5">
              <View className="overflow-hidden rounded-lg border border-gray-300 bg-gray-50">
                <Image
                  source={{ uri: photoUri }}
                  style={{ width: '100%', height: 320 }}
                  contentFit="cover"
                />
              </View>
              <Pressable onPress={pickPhoto} disabled={analyzing} className="mt-2">
                <Text className="text-xs text-indigo-600">다른 사진 선택</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={pickPhoto}
              disabled={picking}
              className="mt-1.5 items-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 py-12 active:bg-gray-100"
            >
              {picking ? (
                <ActivityIndicator color="#4f46e5" />
              ) : (
                <>
                  <Text className="text-3xl">🧍</Text>
                  <Text className="mt-2 text-sm font-semibold text-gray-700">
                    정면 자세 사진 선택
                  </Text>
                  <Text className="mt-1 text-xs text-gray-500">
                    회원이 정면을 보고 자연스럽게 선 모습
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </View>

        {result && <StaticResultCard result={result} />}

        <View className="h-32" />
      </ScrollView>

      <View className="border-t border-gray-200 px-6 py-3">
        {result ? (
          <Pressable
            onPress={goNext}
            className="items-center rounded-lg bg-indigo-600 py-3.5 active:bg-indigo-700"
          >
            <Text className="text-base font-semibold text-white">다음 (OHS 정면 분석)</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={runAnalysis}
            disabled={!photoUri || analyzing}
            className={`items-center rounded-lg py-3.5 ${
              photoUri && !analyzing ? 'bg-indigo-600 active:bg-indigo-700' : 'bg-gray-300'
            }`}
          >
            {analyzing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-base font-semibold text-white">정적 분석 시작</Text>
            )}
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

function StaticResultCard({ result }: { result: StaticPoseResult }) {
  const scoreColor =
    result.alignmentScore >= 80 ? '#22c55e' : result.alignmentScore >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <View className="mt-5 rounded-2xl border border-gray-200 bg-white p-5">
      <Text className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        정렬 분석 결과
      </Text>
      <View className="mt-2 flex-row items-baseline">
        <Text className="text-4xl font-bold" style={{ color: scoreColor }}>
          {result.alignmentScore}
        </Text>
        <Text className="ml-1 text-sm text-gray-500">/ 100</Text>
      </View>

      <View className="mt-4">
        <RowKV k="좌우 어깨 기울기" v={`${result.shoulderTilt.toFixed(1)}°`} />
        <RowKV k="좌우 골반 기울기" v={`${result.pelvisTilt.toFixed(1)}°`} />
      </View>

      {result.issues.length > 0 && (
        <View className="mt-3">
          <Text className="text-xs font-semibold text-gray-700">발견된 이슈</Text>
          {result.issues.map((it, i) => (
            <View key={i} className="mt-1.5 flex-row">
              <Text
                className="mr-1.5 text-xs"
                style={{
                  color:
                    it.severity === 'danger'
                      ? '#ef4444'
                      : it.severity === 'warning'
                        ? '#f59e0b'
                        : '#22c55e',
                }}
              >
                ●
              </Text>
              <Text className="flex-1 text-xs text-gray-700">
                {it.name}
                {it.description ? ` — ${it.description}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      {result.recommendedSideMessage && (
        <View className="mt-4 rounded-lg bg-yellow-50 p-3">
          <Text className="text-xs font-semibold text-yellow-800">
            📍 OHS 측면 촬영 권장 방향
          </Text>
          <Text className="mt-1 text-xs leading-5 text-yellow-900">
            {result.recommendedSideMessage}
          </Text>
        </View>
      )}

    </View>
  );
}

function RowKV({ k, v }: { k: string; v: string }) {
  return (
    <View className="flex-row justify-between py-1">
      <Text className="text-xs text-gray-500">{k}</Text>
      <Text className="text-xs font-semibold text-gray-800">{v}</Text>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────
   analyzeStaticPose 결과 → StaticPoseResult 변환 + 이슈 분류
   - shoulderTilt/pelvisTilt: ±3°=warning, ±5°=danger (config.ts [R7])
   - fhpDeviation: > 15°=warning, > 40°=danger (config.ts [R5] CVA cut-off)
   - roundShoulderAngle: < 160°=warning (config.ts roundShoulder range)
   ───────────────────────────────────────────────────────────── */
function buildStaticPoseResult(
  photoUri: string,
  r: Awaited<ReturnType<typeof analyzeStaticPose>>,
): StaticPoseResult {
  const issues: StaticPoseResult['issues'] = [];
  const shoulderAbs = Math.abs(r.shoulderTilt);
  const pelvisAbs = Math.abs(r.pelvisTilt);

  if (shoulderAbs >= 3) {
    issues.push({
      name: '어깨 좌우 비대칭',
      severity: shoulderAbs >= 5 ? 'danger' : 'warning',
      description: `${r.shoulderTilt > 0 ? '우측' : '좌측'} 어깨가 ${shoulderAbs.toFixed(1)}° 높음`,
    });
  }
  if (pelvisAbs >= 3) {
    issues.push({
      name: '골반 좌우 기울기',
      severity: pelvisAbs >= 5 ? 'danger' : 'warning',
      description: `${r.pelvisTilt > 0 ? '우측' : '좌측'} 골반이 ${pelvisAbs.toFixed(1)}° 높음`,
    });
  }
  if (r.fhpDeviation != null && r.fhpDeviation > 15) {
    issues.push({
      name: '거북목 (FHP)',
      severity: r.fhpDeviation > 40 ? 'danger' : 'warning',
      description: `CVA 추정 ${r.cva ?? '-'}° (정상 ≥ 50°), 전방 이탈 ${r.fhpDeviation}°`,
    });
  }
  if (r.roundShoulderAngle != null && r.roundShoulderAngle < 160) {
    issues.push({
      name: '라운드숄더',
      severity: r.roundShoulderAngle < 145 ? 'danger' : 'warning',
      description: `어깨 정렬 ${r.roundShoulderAngle}° (정상 160-180°)`,
    });
  }

  if (issues.length === 0) {
    issues.push({
      name: '전반적 정렬 양호',
      severity: 'normal',
      description: '주요 비대칭/거북목/라운드숄더 패턴이 발견되지 않음',
    });
  }

  // 정렬 점수: 비대칭 + FHP + 라운드숄더 감점
  let score = 100;
  score -= Math.min(20, shoulderAbs * 4);
  score -= Math.min(20, pelvisAbs * 4);
  if (r.fhpDeviation != null) score -= Math.min(25, r.fhpDeviation * 0.6);
  if (r.roundShoulderAngle != null && r.roundShoulderAngle < 180) {
    score -= Math.min(20, (180 - r.roundShoulderAngle) * 1.2);
  }
  const alignmentScore = Math.max(20, Math.min(100, Math.round(score)));

  // 측면 촬영 방향: 골반/어깨가 더 기운 쪽을 카메라에 보이게
  let dir: 'left' | 'right' | null = null;
  let message: string | undefined;
  const dominantTilt = shoulderAbs >= pelvisAbs ? r.shoulderTilt : r.pelvisTilt;
  if (Math.abs(dominantTilt) >= 2) {
    dir = dominantTilt > 0 ? 'right' : 'left';
    message =
      dir === 'right'
        ? '회원의 우측이 카메라를 향하도록 (회원 기준 우측면 촬영)'
        : '회원의 좌측이 카메라를 향하도록 (회원 기준 좌측면 촬영)';
  }

  return {
    shoulderTilt: r.shoulderTilt,
    pelvisTilt: r.pelvisTilt,
    alignmentScore,
    recommendedSideDirection: dir,
    recommendedSideMessage: message,
    issues,
    analyzedAt: new Date().toISOString(),
    photoUri,
  };
}
