import { Canvas, Path, Skia, useCanvasRef, type SkPath } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  type LayoutChangeEvent,
  Modal,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { type AgreedTerms, saveConsent } from '@/lib/consent';

interface Props {
  visible: boolean;
  memberId: string;
  memberName?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConsentModal({ visible, memberId, memberName, onCancel, onConfirm }: Props) {
  const [agreedDataCollection, setAgreedDataCollection] = useState(false);
  const [agreedAiAnalysis, setAgreedAiAnalysis] = useState(false);
  const [agreedRetention, setAgreedRetention] = useState(false);
  const [paths, setPaths] = useState<SkPath[]>([]);
  const currentPathRef = useRef<SkPath | null>(null);
  const [size, setSize] = useState({ width: 0, height: 180 });
  const canvasRef = useCanvasRef();
  const [busy, setBusy] = useState(false);

  // 모달 열릴 때 초기화
  useEffect(() => {
    if (visible) {
      setAgreedDataCollection(false);
      setAgreedAiAnalysis(false);
      setAgreedRetention(false);
      setPaths([]);
      currentPathRef.current = null;
      setBusy(false);
    }
  }, [visible]);

  const hasInk = paths.length > 0;
  const allChecked = agreedDataCollection && agreedAiAnalysis && agreedRetention;
  const canConfirm = hasInk && allChecked && !busy;

  const onCanvasLayout = (e: LayoutChangeEvent) => {
    const { width } = e.nativeEvent.layout;
    setSize((s) => (s.width === width ? s : { ...s, width }));
  };

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .onBegin((e) => {
          const newPath = Skia.Path.Make();
          newPath.moveTo(e.x, e.y);
          currentPathRef.current = newPath;
          setPaths((prev) => [...prev, newPath]);
        })
        .onUpdate((e) => {
          if (!currentPathRef.current) return;
          currentPathRef.current.lineTo(e.x, e.y);
          // Skia Path는 mutable — re-render 트리거 위해 array 새로 생성
          setPaths((prev) => [...prev]);
        })
        .onEnd(() => {
          currentPathRef.current = null;
        }),
    [],
  );

  const clearSig = () => {
    setPaths([]);
    currentPathRef.current = null;
  };

  const submit = async () => {
    if (!canConfirm) return;
    const image = canvasRef.current?.makeImageSnapshot();
    const base64 = image?.encodeToBase64();
    if (!base64) {
      Alert.alert('서명 캡처 실패', '서명을 다시 시도해 주세요.');
      return;
    }
    const dataUrl = `data:image/png;base64,${base64}`;
    const agreedTerms: AgreedTerms = {
      dataCollection: agreedDataCollection,
      aiAnalysis: agreedAiAnalysis,
      retentionUntilEnd: agreedRetention,
    };
    setBusy(true);
    try {
      await saveConsent(memberId, dataUrl, agreedTerms);
      onConfirm();
    } catch (err) {
      Alert.alert('동의 저장 실패', (err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/85 px-4">
        <View className="w-full max-w-sm rounded-2xl bg-white">
          <View className="border-b border-gray-200 px-5 py-4">
            <Text className="text-base font-bold text-gray-900">회원 동의서</Text>
            <Text className="mt-1 text-xs text-gray-500">
              {(memberName ?? '회원') + '님께 직접 받아주세요'}
            </Text>
          </View>

          <View className="px-5 py-4">
            <CheckRow
              checked={agreedDataCollection}
              onChange={setAgreedDataCollection}
              label="개인정보(이름·신체정보·체형 사진/영상) 수집·이용에 동의합니다"
            />
            <CheckRow
              checked={agreedAiAnalysis}
              onChange={setAgreedAiAnalysis}
              label="AI 자세 분석 결과의 트레이닝 활용에 동의합니다 (의료 진단 아님)"
            />
            <CheckRow
              checked={agreedRetention}
              onChange={setAgreedRetention}
              label="PT 회원 기간 종료 시까지 데이터 보관에 동의합니다"
            />

            <View className="mt-4">
              <View className="mb-1.5 flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-gray-700">서명</Text>
                <Pressable onPress={clearSig}>
                  <Text className="text-xs text-indigo-600">지우기</Text>
                </Pressable>
              </View>
              <View
                onLayout={onCanvasLayout}
                className="rounded-lg border border-gray-300 bg-gray-50"
                style={{ height: 180 }}
              >
                {size.width > 0 && (
                  <GestureDetector gesture={gesture}>
                    <Canvas ref={canvasRef} style={{ width: size.width, height: size.height }}>
                      {paths.map((p, i) => (
                        <Path
                          key={i}
                          path={p}
                          color="#111827"
                          style="stroke"
                          strokeWidth={2.5}
                          strokeJoin="round"
                          strokeCap="round"
                        />
                      ))}
                    </Canvas>
                  </GestureDetector>
                )}
              </View>
              {!hasInk && (
                <Text className="mt-1 text-[10px] text-gray-400">위 영역에 서명해 주세요</Text>
              )}
            </View>
          </View>

          <View className="flex-row border-t border-gray-200">
            <Pressable
              onPress={onCancel}
              disabled={busy}
              className="flex-1 items-center py-3.5 active:bg-gray-50"
            >
              <Text className="text-base text-gray-600">취소</Text>
            </Pressable>
            <View className="w-px bg-gray-200" />
            <Pressable
              onPress={submit}
              disabled={!canConfirm}
              className={`flex-1 items-center py-3.5 ${canConfirm ? 'active:bg-indigo-50' : ''}`}
            >
              {busy ? (
                <ActivityIndicator color="#4f46e5" />
              ) : (
                <Text
                  className={`text-base font-semibold ${
                    canConfirm ? 'text-indigo-600' : 'text-gray-300'
                  }`}
                >
                  동의 완료
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <Pressable onPress={() => onChange(!checked)} className="mb-2.5 flex-row items-start">
      <View
        className={`mr-3 mt-0.5 h-5 w-5 items-center justify-center rounded border-2 ${
          checked ? 'border-indigo-600 bg-indigo-600' : 'border-gray-300 bg-white'
        }`}
      >
        {checked && <Text className="text-xs font-bold text-white">✓</Text>}
      </View>
      <Text className="flex-1 text-sm leading-5 text-gray-700">{label}</Text>
    </Pressable>
  );
}
