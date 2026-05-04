import {
  Canvas,
  Circle,
  Group,
  Image as SkiaImage,
  Line,
  vec,
  useImage,
} from '@shopify/react-native-skia';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { AppConfig, type Landmark } from '@/lib/analysis';

/* ───────────────────────────────────────────────────────────
 * 캡쳐 사진 위에 33개 MediaPipe landmark + skeleton 연결선 오버레이.
 *
 * highlightJointKey가 있으면 해당 관절(예: leftKnee)을 빨간색으로 강조,
 *   그 외 visibility 충분한 landmark는 녹색.
 * ─────────────────────────────────────────────────────────── */
interface Props {
  imageUri: string;
  landmarks: Landmark[];
  highlightJointKey?: string;
  /** danger=빨강, warning=주황. highlightJointKey 점/선에 적용 */
  severity?: 'warning' | 'danger';
  /** 컨테이너 비율. 영상 세로 촬영(9:16) 또는 정면 사진 케이스 */
  aspectRatio?: number;
}

const COLORS = {
  dotOk: '#22c55e',
  dotWarn: '#f59e0b',
  dotCrit: '#ef4444',
  lineOk: 'rgba(108,99,255,0.85)',
  lineWarn: 'rgba(245,158,11,0.85)',
  lineCrit: 'rgba(239,68,68,0.95)',
  lineDim: 'rgba(255,255,255,0.45)',
};

// jointKey → 강조할 landmark 인덱스 집합 (양 끝 관절도 같이 빨강)
const HIGHLIGHT_INDICES: Record<string, number[]> = {
  leftKnee: [AppConfig.LM.L_HIP, AppConfig.LM.L_KNEE, AppConfig.LM.L_ANKLE],
  rightKnee: [AppConfig.LM.R_HIP, AppConfig.LM.R_KNEE, AppConfig.LM.R_ANKLE],
  leftHip: [AppConfig.LM.L_SHOULDER, AppConfig.LM.L_HIP, AppConfig.LM.L_KNEE],
  rightHip: [AppConfig.LM.R_SHOULDER, AppConfig.LM.R_HIP, AppConfig.LM.R_KNEE],
  leftAnkle: [AppConfig.LM.L_KNEE, AppConfig.LM.L_ANKLE, AppConfig.LM.L_HEEL],
  rightAnkle: [AppConfig.LM.R_KNEE, AppConfig.LM.R_ANKLE, AppConfig.LM.R_HEEL],
  leftShoulder: [AppConfig.LM.L_ELBOW, AppConfig.LM.L_SHOULDER, AppConfig.LM.L_HIP],
  rightShoulder: [AppConfig.LM.R_ELBOW, AppConfig.LM.R_SHOULDER, AppConfig.LM.R_HIP],
  spine: [
    AppConfig.LM.L_SHOULDER,
    AppConfig.LM.R_SHOULDER,
    AppConfig.LM.L_HIP,
    AppConfig.LM.R_HIP,
    AppConfig.LM.L_KNEE,
    AppConfig.LM.R_KNEE,
  ],
  hipShift: [AppConfig.LM.L_HIP, AppConfig.LM.R_HIP],
};

export function SkeletonOverlay({
  imageUri,
  landmarks,
  highlightJointKey,
  severity = 'warning',
  aspectRatio = 9 / 16,
}: Props) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const skiaImage = useImage(imageUri);

  const highlightSet = new Set(
    highlightJointKey ? (HIGHLIGHT_INDICES[highlightJointKey] ?? []) : [],
  );
  const highlightLineColor = severity === 'danger' ? COLORS.lineCrit : COLORS.lineWarn;
  const highlightDotColor = severity === 'danger' ? COLORS.dotCrit : COLORS.dotWarn;

  return (
    <View
      style={{ width: '100%', aspectRatio }}
      onLayout={(e) =>
        setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      {size && skiaImage && (
        <Canvas style={{ width: size.w, height: size.h }}>
          <SkiaImage
            image={skiaImage}
            x={0}
            y={0}
            width={size.w}
            height={size.h}
            fit="cover"
          />

          <Group>
            {AppConfig.SKEL_CONN.map(([a, b], idx) => {
              const A = landmarks[a];
              const B = landmarks[b];
              if (!A || !B) return null;
              if ((A.visibility ?? 1) < 0.4 || (B.visibility ?? 1) < 0.4) return null;
              const isHi = highlightSet.has(a) && highlightSet.has(b);
              const color = isHi ? highlightLineColor : COLORS.lineDim;
              return (
                <Line
                  key={`l${idx}`}
                  p1={vec(A.x * size.w, A.y * size.h)}
                  p2={vec(B.x * size.w, B.y * size.h)}
                  color={color}
                  strokeWidth={isHi ? 3 : 1.6}
                />
              );
            })}

            {landmarks.map((lm, i) => {
              if ((lm.visibility ?? 1) < 0.4) return null;
              const isHi = highlightSet.has(i);
              return (
                <Circle
                  key={`d${i}`}
                  cx={lm.x * size.w}
                  cy={lm.y * size.h}
                  r={isHi ? 5 : 3}
                  color={isHi ? highlightDotColor : COLORS.dotOk}
                />
              );
            })}
          </Group>
        </Canvas>
      )}

      {!skiaImage && size && (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#9ca3af', fontSize: 11 }}>이미지 로드 중…</Text>
        </View>
      )}
    </View>
  );
}
