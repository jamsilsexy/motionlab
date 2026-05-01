import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AppConfig,
  type Capture,
  type MemberSummary,
  type NasmPattern,
  type PtPlan,
  type ResultState,
  type SalesScriptStage,
  type StaticPoseResult,
  useAnalysisStore,
} from '@/lib/analysis';

/**
 * M5-A4 — 종합 리포트.
 * 큐 모든 단계의 결과(allResults) + staticPoseResult 를 묶어 표시.
 * Phase A: sales script / member summary / PT plan / NASM 패턴은 mock 으로 채움.
 * Phase B: V2 lib 함수들이 이 자리에 실제 데이터를 넣음.
 */
export default function ReportScreen() {
  const router = useRouter();
  const session = useAnalysisStore((s) => s.session);
  const member = session.memberData;

  // 모든 큐 결과 종합
  const overall = useMemo(() => buildOverall(session.allResults), [session.allResults]);
  const memberSummary = useMemo(
    () => buildMockMemberSummary(overall, member?.goal ?? 'general'),
    [overall, member?.goal],
  );
  const salesScript = useMemo(
    () => buildMockSalesScript(overall, member?.name ?? '회원'),
    [overall, member?.name],
  );
  const ptPlan = useMemo(() => buildMockPtPlan(overall), [overall]);
  const nasmPatterns = useMemo(() => buildMockNasmPatterns(overall), [overall]);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center border-b border-gray-200 px-4 py-3">
        <Pressable onPress={() => router.replace('/')}>
          <Text className="text-base text-indigo-600">← 홈</Text>
        </Pressable>
        <Text className="ml-4 flex-1 text-base font-semibold text-gray-900">분석 리포트</Text>
      </View>

      <ScrollView className="flex-1 px-6 pt-4">
        <Text className="text-xs text-gray-500">회원</Text>
        <Text className="mt-0.5 text-base font-semibold text-gray-900">
          {member?.name || '미지정'}
        </Text>
        <Text className="mt-0.5 text-xs text-gray-400">
          {new Date().toLocaleDateString('ko-KR')} · {session.analysisQueue.length}개 단계 분석
        </Text>

        <ScoreCard score={overall.score} />

        {session.staticPoseResult && (
          <StaticPoseSection result={session.staticPoseResult} />
        )}

        <Tab1MemberSummary summary={memberSummary} />
        <Tab2NasmPatterns patterns={nasmPatterns} />
        <Tab3SalesScript stages={salesScript} />
        <PtPlanCard plan={ptPlan} />

        <PerStageResults allResults={session.allResults} />

        <View className="mt-8 rounded-lg bg-yellow-50 p-4">
          <Text className="text-xs font-semibold text-yellow-800">⚠️ Phase A 베타 안내</Text>
          <Text className="mt-1 text-xs leading-5 text-yellow-900">
            현재 mock 데이터로 화면 흐름 검증 중. Phase B에서 NASMEngine + buildSalesScriptV5 +
            buildMemberSummary + calcPtPlan 풀 함수가 연결됩니다.
          </Text>
        </View>

        <Text className="mt-6 text-center text-[10px] text-gray-400">
          본 앱은 의료기기가 아니며 분석 결과는 참고용입니다.
        </Text>

        <View className="h-24" />
      </ScrollView>

      <View className="border-t border-gray-200 px-6 py-3">
        <Pressable
          onPress={() => router.replace('/')}
          className="items-center rounded-lg bg-indigo-600 py-3.5 active:bg-indigo-700"
        >
          <Text className="text-base font-semibold text-white">완료</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sections
   ───────────────────────────────────────────────────────────── */

function ScoreCard({ score }: { score: number }) {
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
  const label = score >= 80 ? '양호' : score >= 60 ? '주의' : '위험';
  return (
    <View className="mt-6 items-center rounded-2xl border border-gray-200 bg-white p-6">
      <Text className="text-xs text-gray-500">종합 점수 (전체 단계 평균)</Text>
      <Text className="mt-2 text-6xl font-bold" style={{ color }}>
        {score}
      </Text>
      <Text className="mt-1 text-sm font-semibold" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}

function StaticPoseSection({ result }: { result: StaticPoseResult }) {
  return (
    <View className="mt-6">
      <Text className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        🧍 정적 자세 분석
      </Text>
      <View className="mt-2 rounded-lg border border-gray-200 bg-white p-4">
        <View className="flex-row justify-between">
          <Text className="text-xs text-gray-500">정렬 점수</Text>
          <Text className="text-xs font-semibold text-gray-800">{result.alignmentScore}/100</Text>
        </View>
        <View className="mt-1 flex-row justify-between">
          <Text className="text-xs text-gray-500">어깨 기울기</Text>
          <Text className="text-xs text-gray-800">{result.shoulderTilt.toFixed(1)}°</Text>
        </View>
        <View className="mt-1 flex-row justify-between">
          <Text className="text-xs text-gray-500">골반 기울기</Text>
          <Text className="text-xs text-gray-800">{result.pelvisTilt.toFixed(1)}°</Text>
        </View>
        {result.issues.length > 0 && (
          <View className="mt-3">
            {result.issues.map((it, i) => (
              <View key={i} className="mt-1 flex-row">
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
      </View>
    </View>
  );
}

function Tab1MemberSummary({ summary }: { summary: MemberSummary }) {
  return (
    <View className="mt-6">
      <Text className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        📋 회원용 요약 (1단계: 한 줄 결론)
      </Text>
      <View className="mt-2 rounded-lg border border-gray-200 bg-white p-4">
        <Text className="text-sm leading-6 text-gray-800">{summary.conclusion}</Text>
      </View>

      <Text className="mt-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
        핵심 문제 ({summary.problems.length})
      </Text>
      {summary.problems.map((p, i) => (
        <View key={i} className="mt-2 rounded-lg border border-gray-200 bg-white p-4">
          <View className="flex-row items-center">
            <View
              className="mr-3 h-7 w-7 items-center justify-center rounded-full"
              style={{
                backgroundColor:
                  p.severity === 'danger' ? '#ef4444' : p.severity === 'warning' ? '#f59e0b' : '#22c55e',
              }}
            >
              <Text className="text-xs font-bold text-white">{i + 1}</Text>
            </View>
            <Text className="flex-1 text-sm font-semibold text-gray-900">{p.name}</Text>
          </View>
          <Text className="mt-2 text-xs leading-5 text-gray-700">{p.desc}</Text>
          {p.repCount != null && p.repTotal != null && (
            <Text className="mt-1 text-[11px] text-gray-500">
              반복 {p.repCount}/{p.repTotal}회 감지
            </Text>
          )}
        </View>
      ))}

      <Text className="mt-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
        왜 문제인가
      </Text>
      {summary.whyItems.map((w, i) => (
        <View key={i} className="mt-1.5 flex-row">
          <Text className="mr-2 text-base">{w.icon}</Text>
          <Text className="flex-1 text-xs leading-5 text-gray-700">{w.text}</Text>
        </View>
      ))}

      <Text className="mt-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
        예상 변화
      </Text>
      <View className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <Text className="text-xs font-semibold text-gray-700">2-4주차 (신경근 적응기)</Text>
        <Text className="mt-1 text-xs leading-5 text-gray-600">{summary.changes.week24}</Text>
        <Text className="mt-3 text-xs font-semibold text-gray-700">6-8주차 (구조적 변화기)</Text>
        <Text className="mt-1 text-xs leading-5 text-gray-600">{summary.changes.week68}</Text>
      </View>
    </View>
  );
}

function Tab2NasmPatterns({ patterns }: { patterns: NasmPattern[] }) {
  if (patterns.length === 0) return null;
  return (
    <View className="mt-6">
      <Text className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        🧬 NASM 패턴 분류 (보상 사슬)
      </Text>
      {patterns.map((p, i) => (
        <View key={i} className="mt-2 rounded-lg border border-gray-200 bg-white p-4">
          <View className="flex-row items-center">
            <Text className="flex-1 text-sm font-semibold text-gray-900">{p.name}</Text>
            <View
              className="rounded px-2 py-0.5"
              style={{
                backgroundColor:
                  p.severity === 'danger' ? '#fee2e2' : p.severity === 'warning' ? '#fef3c7' : '#dcfce7',
              }}
            >
              <Text
                className="text-[10px] font-semibold"
                style={{
                  color:
                    p.severity === 'danger' ? '#991b1b' : p.severity === 'warning' ? '#92400e' : '#166534',
                }}
              >
                {p.severity === 'danger' ? '심각' : p.severity === 'warning' ? '주의' : '경미'}
              </Text>
            </View>
          </View>
          <Text className="mt-2 text-xs leading-5 text-gray-700">{p.rootCause}</Text>
          {p.compensationChain.length > 0 && (
            <View className="mt-2 flex-row flex-wrap">
              {p.compensationChain.map((c, j) => (
                <View key={j} className="mb-1 mr-1 flex-row items-center">
                  <Text className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
                    {c}
                  </Text>
                  {j < p.compensationChain.length - 1 && (
                    <Text className="mx-1 text-xs text-gray-400">→</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function Tab3SalesScript({ stages }: { stages: SalesScriptStage[] }) {
  return (
    <View className="mt-6">
      <Text className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        💼 영업 스크립트 (5단계 — 트레이너용)
      </Text>
      {stages.map((s) => (
        <View key={s.step} className="mt-2 rounded-lg border border-gray-200 bg-white p-4">
          <Text className="text-xs font-semibold text-indigo-700">
            {s.step}단계 — {s.title}
          </Text>
          <Text className="mt-1.5 text-xs leading-5 text-gray-700">{s.body}</Text>
        </View>
      ))}
    </View>
  );
}

function PtPlanCard({ plan }: { plan: PtPlan }) {
  return (
    <View className="mt-6">
      <Text className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        🗓 PT 권장 (NSCA 기반)
      </Text>
      <View className="mt-2 rounded-lg border border-gray-200 bg-white p-4">
        <View className="flex-row items-baseline">
          <Text className="text-2xl font-bold text-indigo-600">{plan.totalSessions}</Text>
          <Text className="ml-1 text-sm text-gray-500">회 ({plan.totalRange})</Text>
        </View>
        <Text className="mt-0.5 text-xs text-gray-500">
          주 {plan.weeklyFrequency}회 권장
        </Text>
        <View className="mt-3">
          {plan.phases.map((ph, i) => (
            <View key={i} className="mt-1.5 flex-row">
              <Text className="w-12 text-xs text-gray-500">{ph.weeks}</Text>
              <View className="flex-1">
                <Text className="text-xs font-semibold text-gray-800">
                  {ph.phase}단계 · {ph.goal}
                </Text>
                <Text className="text-[11px] text-gray-500">{ph.sessions}회</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function PerStageResults({ allResults }: { allResults: Record<string, ResultState> }) {
  const entries = Object.entries(allResults);
  if (entries.length === 0) return null;
  return (
    <View className="mt-6">
      <Text className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        🔬 단계별 상세 ({entries.length})
      </Text>
      {entries.map(([mvId, result]) => {
        const mv = AppConfig.MOVEMENTS.find((m) => m.id === mvId);
        return (
          <View key={mvId} className="mt-2 rounded-lg border border-gray-200 bg-white p-4">
            <Text className="text-sm font-semibold text-gray-900">
              {mv?.icon} {mv?.label ?? mvId}
            </Text>
            <Text className="mt-0.5 text-xs text-gray-500">
              점수 {result.overallScore} · 핵심 이슈 {result.criticalIssues.length}개
            </Text>
            {result.criticalIssues.slice(0, 3).map((c, i) => (
              <IssueRow key={c.id} index={i + 1} capture={c} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function IssueRow({ index, capture }: { index: number; capture: Capture }) {
  const sevColor = capture.severity === 'danger' ? '#ef4444' : '#f59e0b';
  const dev = Math.max(
    capture.normalRange.min - capture.angle,
    capture.angle - capture.normalRange.max,
    0,
  );
  return (
    <View className="mt-2 flex-row items-center border-t border-gray-100 pt-2">
      <View
        className="mr-2 h-5 w-5 items-center justify-center rounded-full"
        style={{ backgroundColor: sevColor }}
      >
        <Text className="text-[10px] font-bold text-white">{index}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-xs font-semibold text-gray-900">{capture.jointName}</Text>
        <Text className="text-[11px]" style={{ color: sevColor }}>
          {Math.round(dev)}° 이탈 · 반복 {capture.repeatCount ?? 0}회
        </Text>
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────
   Mock builders — Phase B 에서 V2 함수들로 교체
   ───────────────────────────────────────────────────────────── */

interface OverallStats {
  score: number;
  topIssues: Capture[];
  totalIssues: number;
  movementCount: number;
}

function buildOverall(allResults: Record<string, ResultState>): OverallStats {
  const entries = Object.values(allResults);
  if (entries.length === 0) {
    return { score: 0, topIssues: [], totalIssues: 0, movementCount: 0 };
  }
  const scores = entries.map((r) => r.overallScore).filter((n) => n > 0);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const allCriticals = entries.flatMap((r) => r.criticalIssues);
  // 같은 jointKey 중에서 가장 큰 이탈만 유지
  const byJoint = new Map<string, Capture>();
  for (const c of allCriticals) {
    const existing = byJoint.get(c.jointKey);
    if (!existing) {
      byJoint.set(c.jointKey, c);
      continue;
    }
    const devNew = Math.max(c.normalRange.min - c.angle, c.angle - c.normalRange.max, 0);
    const devOld = Math.max(
      existing.normalRange.min - existing.angle,
      existing.angle - existing.normalRange.max,
      0,
    );
    if (devNew > devOld) byJoint.set(c.jointKey, c);
  }
  const topIssues = Array.from(byJoint.values())
    .sort((a, b) => (b.severity === 'danger' ? 1 : 0) - (a.severity === 'danger' ? 1 : 0))
    .slice(0, 4);
  return {
    score: avgScore,
    topIssues,
    totalIssues: allCriticals.length,
    movementCount: entries.length,
  };
}

function buildMockMemberSummary(stats: OverallStats, goal: string): MemberSummary {
  if (stats.topIssues.length === 0) {
    return {
      conclusion:
        '전반적인 움직임 패턴이 양호합니다. 현재 폼을 유지하면서 점진적으로 강도를 높이는 단계로 넘어갈 수 있습니다.',
      problems: [],
      whyItems: [
        {
          icon: '🌱',
          text: '예방적 강화: 잘 잡힌 움직임 패턴을 더 깊이 자동화하면 부상 위험이 크게 줄어듭니다.',
        },
      ],
      changes: {
        week24: '신경근 효율성이 더 정교해져 같은 무게로도 동작이 가벼워집니다.',
        week68: '구조적 적응으로 측정 가능한 근력·지구력 향상이 나타납니다.',
      },
      ptRange: '8~12회',
      ptReason: '현재 패턴을 더욱 고도화하고 부상 예방 기반을 만드는 데 최적입니다.',
      totalSessions: 10,
    };
  }

  const top = stats.topIssues[0];
  const dev = Math.max(top.normalRange.min - top.angle, top.angle - top.normalRange.max, 0);
  const goalLines: Record<string, string> = {
    weight: '이 상태에서 운동 강도를 높이면 효율보다 부상 위험이 먼저 올라갑니다.',
    performance: '이 패턴을 미교정 상태에서 중량을 올리면 부상으로 이어집니다.',
    rehab: '지금 패턴 교정이 재활 목표 달성의 가장 빠른 길입니다.',
    general: '일상 동작에서도 이 패턴이 반복되고 있을 가능성이 높습니다.',
  };

  return {
    conclusion: `${top.jointName}에서 ${Math.round(dev)}° 이탈 패턴이 가장 두드러집니다. ${goalLines[goal] ?? goalLines.general}`,
    problems: stats.topIssues.slice(0, 3).map((c, i) => ({
      jointKey: c.jointKey,
      name: c.jointName,
      desc: mockProblemDesc(c.jointKey, Math.round(dev)),
      severity: c.severity,
      deviation: Math.round(dev),
      repCount: c.repeatCount ?? null,
      repTotal: 5,
      isRecurrent: (c.repeatCount ?? 0) >= 3,
    })),
    whyItems: [
      {
        icon: '⚠️',
        text: `반복 ${stats.totalIssues}건의 이탈 패턴이 누적되면 관절·디스크에 누적 스트레스가 쌓입니다.`,
      },
      {
        icon: '🔗',
        text: '발목→무릎→허리→어깨는 연결돼 있어 한 부위의 제한이 전신 보상을 만듭니다.',
      },
    ],
    changes: {
      week24:
        'McGill·Boyle 연구 기반: 신경근 적응기 2-4주 내 일상 동작에서 변화 체감. 계단·앉기·일어서기 등에서 뻣뻣함 감소.',
      week68:
        '구조적 변화기 6-8주 후 교정 패턴이 자동화됨. 의식하지 않아도 올바른 정렬이 유지되어 PT 강도 상향 가능.',
    },
    ptRange: '12~20회',
    ptReason: `${stats.totalIssues}건 패턴 중 일부는 반복 패턴으로, 혼자 교정이 어렵고 전문가 피드백이 있어야 빠르게 개선됩니다.`,
    totalSessions: 16,
  };
}

function mockProblemDesc(jointKey: string, dev: number): string {
  const map: Record<string, string> = {
    spine: `요추-골반 복합체의 안정화 기전이 무너져 ${dev}° 굴곡이 발생합니다. 척추 기립근 과활성과 디스크 후방 압력 증가의 주원인.`,
    leftKnee: `중둔근 통제력 부족으로 대퇴골이 내회전되며 무릎이 ${dev}° 안으로 쏠립니다. 반월상 연골/내측 인대에 비정상 전단력.`,
    rightKnee: `중둔근 통제력 부족으로 대퇴골이 내회전되며 무릎이 ${dev}° 안으로 쏠립니다. 반월상 연골/내측 인대에 비정상 전단력.`,
    leftHip: `고관절 굴곡 가동 ${dev}° 제한 → 하강 시 골반 후방 경사(Butt Wink) → 요추 보상 굴곡으로 허리 부하 증가.`,
    rightHip: `고관절 굴곡 가동 ${dev}° 제한 → 하강 시 골반 후방 경사(Butt Wink) → 요추 보상 굴곡으로 허리 부하 증가.`,
    leftAnkle: `발목 배굴(Dorsiflexion) ${dev}° 제한으로 무게 중심이 전방 이동. 무릎 전방 쏠림과 척추 과전경 연쇄 반응의 시작점.`,
    rightAnkle: `발목 배굴(Dorsiflexion) ${dev}° 제한으로 무게 중심이 전방 이동. 무릎 전방 쏠림과 척추 과전경 연쇄 반응의 시작점.`,
    leftShoulder: `견갑-상완 리듬 불균형으로 어깨 정렬 ${dev}° 이탈. 흉추 가동성 저하와 결합 시 회전근개 부하 증가.`,
    rightShoulder: `견갑-상완 리듬 불균형으로 어깨 정렬 ${dev}° 이탈. 흉추 가동성 저하와 결합 시 회전근개 부하 증가.`,
  };
  return map[jointKey] ?? `${dev}° 이탈 감지 — 보상 패턴 형성 가능성 있음.`;
}

function buildMockSalesScript(stats: OverallStats, name: string): SalesScriptStage[] {
  if (stats.topIssues.length === 0) {
    return [
      {
        step: 1,
        title: '문제 요약',
        body: `${name}님의 움직임은 대부분 양호한 상태입니다. 평균 점수 ${stats.score}점.`,
      },
      {
        step: 2,
        title: '위험성',
        body: '현재 폼은 좋지만, 운동 강도 증가 시 보호 메커니즘이 부족하면 부상 위험이 올라갑니다.',
      },
      {
        step: 3,
        title: '변화 가능성',
        body: '이미 좋은 토대 위에서 추가 강화는 빠른 결과로 이어집니다.',
      },
      {
        step: 4,
        title: 'PT 필요성',
        body: '정체 없는 점진적 진보를 위해 8-12회 프로그램이 가장 효율적입니다.',
      },
      {
        step: 5,
        title: '행동 유도',
        body: `다음 PT 세션부터 ${name}님 패턴에 맞춘 점진적 부하 프로그램을 적용하시죠.`,
      },
    ];
  }

  const top = stats.topIssues[0];
  const dev = Math.max(top.normalRange.min - top.angle, top.angle - top.normalRange.max, 0);
  return [
    {
      step: 1,
      title: '문제 요약 (수치)',
      body: `${name}님은 ${top.jointName}에서 ${Math.round(dev)}° 이탈, 총 ${stats.totalIssues}건의 핵심 이슈가 ${stats.movementCount}개 동작에서 확인됐습니다. 평균 점수 ${stats.score}점.`,
    },
    {
      step: 2,
      title: '위험성 (맥락)',
      body: `이런 패턴이 반복되면 관절·디스크에 누적 스트레스가 쌓이고, 임계점을 넘는 순간 갑작스러운 부상으로 이어질 수 있습니다.`,
    },
    {
      step: 3,
      title: '변화 가능성',
      body: 'McGill·Boyle 연구 기반: 신경근 적응 2-4주 + 구조적 변화 6-8주. 즉, 8주 안에 측정 가능한 개선이 가능합니다.',
    },
    {
      step: 4,
      title: 'PT 필요성',
      body: `반복 패턴 ${stats.totalIssues}건은 혼자 교정이 어렵습니다. 거울 보고 의식해도 운동 중 실제 폼은 다르기 때문입니다. 12-20회 프로그램에서 80% 이상 정상화되는 것이 일반적 결과입니다.`,
    },
    {
      step: 5,
      title: '행동 유도',
      body: `${name}님 시간이 가능한 가장 빠른 시점에 12회 프로그램부터 시작하시죠. 첫 4주 동안 ${top.jointName} 안정화에 집중하면 6주차에 본인이 차이를 체감하실 겁니다.`,
    },
  ];
}

function buildMockPtPlan(stats: OverallStats): PtPlan {
  if (stats.topIssues.length === 0) {
    return {
      totalSessions: 10,
      totalRange: '8~12회',
      weeklyFrequency: 2,
      phases: [
        { phase: 1, weeks: '1-2주', goal: '베이스라인 평가 + 강도 점진 적용', sessions: 4 },
        { phase: 2, weeks: '3-5주', goal: '가동성 + 안정성 통합', sessions: 6 },
      ],
    };
  }
  return {
    totalSessions: 16,
    totalRange: '12~20회',
    weeklyFrequency: 2,
    phases: [
      { phase: 1, weeks: '1-3주', goal: '안정성 회복 (중둔근/코어/발목 가동성)', sessions: 6 },
      { phase: 2, weeks: '4-6주', goal: '패턴 재교육 (스쿼트/런지/힙힌지)', sessions: 6 },
      { phase: 3, weeks: '7-8주', goal: '점진적 부하 + 통합 동작', sessions: 4 },
    ],
  };
}

function buildMockNasmPatterns(stats: OverallStats): NasmPattern[] {
  if (stats.topIssues.length === 0) return [];
  const patterns: NasmPattern[] = [];
  const keys = stats.topIssues.map((c) => c.jointKey);

  if (keys.some((k) => k.includes('Knee'))) {
    patterns.push({
      name: 'Lower Crossed Syndrome (변형)',
      severity: 'warning',
      rootCause: '중둔근 약화 + 내전근 과긴장으로 무릎 내측 쏠림 (Knee Valgus). NASM CES 기준 1차 보상 패턴.',
      compensationChain: ['중둔근 약화', '대퇴골 내회전', '무릎 내측 쏠림', '족궁 내전'],
    });
  }
  if (keys.includes('spine')) {
    patterns.push({
      name: '요추 굴곡 보상 패턴',
      severity: 'danger',
      rootCause: '고관절 굴곡 가동 부족을 요추가 대신 보상 (Sahrmann Movement Impairment Syndrome).',
      compensationChain: ['고관절 가동성 저하', '요추 굴곡 증가', '척추 기립근 과활성', '디스크 후방 압력'],
    });
  }
  if (keys.some((k) => k.includes('Ankle'))) {
    patterns.push({
      name: '발목-무릎 연쇄 보상',
      severity: 'warning',
      rootCause: '거퇴관절 배굴 제한 → 하강 시 무게중심 전방 이동 → 무릎/허리 보상.',
      compensationChain: ['발목 배굴 제한', '비복근/가자미근 단축', '무릎 전방 쏠림', '척추 과전경'],
    });
  }
  if (keys.some((k) => k.includes('Shoulder'))) {
    patterns.push({
      name: 'Upper Crossed Syndrome',
      severity: 'warning',
      rootCause: '소흉근/상부 승모근 단축 + 하부 승모근/심부 경부굴근 약화 — 라운드 숄더 + 두부전방 보상.',
      compensationChain: ['소흉근 단축', '견갑골 전방 경사', '상부 승모근 과활성', '경추 신전 보상'],
    });
  }
  return patterns;
}
