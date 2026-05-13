import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { upsertMember as persistMember } from '@/lib/members';

import { SkeletonOverlay } from '@/components/skeleton-overlay';

import {
  AnalysisEngine,
  AppConfig,
  NASMEngine,
  type Capture,
  type CompensationChain,
  type ComparisonResult,
  type ExerciseEntry,
  type ExerciseRef,
  type JointAngles,
  type JointSummaryEntry,
  type MemberSummary,
  type NasmPattern,
  type PtPlan,
  type RecurrenceData,
  type ResultState,
  type SalesScriptStage,
  type StaticPoseResult,
  type VideoSignature,
  devOf,
  getExercise,
  useAnalysisStore,
} from '@/lib/analysis';

/**
 * M5-A4 / B-1 — 종합 리포트 (V2 실함수 통합).
 * Phase A 의 mock builder 4개 제거 → AnalysisEngine.{buildMemberSummary,
 *   buildSalesScriptV5, calcPtPlan} + NASMEngine.{classifyPattern, selectChain} 호출.
 */
type ViewMode = 'member' | 'trainer';

export default function ReportScreen() {
  const router = useRouter();
  const session = useAnalysisStore((s) => s.session);
  const member = session.memberData;
  const [mode, setMode] = useState<ViewMode>('member');

  const aggregate = useMemo(
    () => aggregateAllResults(session.allResults),
    [session.allResults],
  );

  const ptPlan = useMemo(
    () => AnalysisEngine.calcPtPlan(aggregate.criticals, member, aggregate.recurrence),
    [aggregate.criticals, aggregate.recurrence, member],
  );

  const memberSummary = useMemo(
    () =>
      AnalysisEngine.buildMemberSummary({
        criticals: aggregate.criticals,
        summary: aggregate.summary,
        member,
        recurrence: aggregate.recurrence,
        signature: aggregate.signature,
        ptPlan,
        totalReps: aggregate.totalReps,
        isOhs: aggregate.hasOhs,
      }),
    [aggregate, member, ptPlan],
  );

  const salesScript = useMemo(
    () =>
      AnalysisEngine.buildSalesScriptV5({
        criticals: aggregate.criticals,
        summary: aggregate.summary,
        member,
        recurrence: aggregate.recurrence,
        signature: aggregate.signature,
        ptPlan,
        totalReps: aggregate.totalReps,
        isOhs: aggregate.hasOhs,
      }),
    [aggregate, member, ptPlan],
  );

  const nasmPatterns = useMemo(
    () =>
      NASMEngine.classifyPattern(
        aggregate.criticals,
        aggregate.allAngles,
        session.staticPoseResult,
      ),
    [aggregate.criticals, aggregate.allAngles, session.staticPoseResult],
  );

  const nasmChain = useMemo(
    () => NASMEngine.selectChain(aggregate.criticals),
    [aggregate.criticals],
  );

  // 변화 체크 — 회원의 마지막 분석 signature와 현재 비교
  const previousSignature = member?.lastSignature ?? null;
  const previousAt = member?.lastAnalyzedAt ?? null;
  const comparison = useMemo<ComparisonResult | null>(
    () =>
      AnalysisEngine.compareWithPreviousAnalysis(
        aggregate.signature,
        previousSignature,
        previousAt,
      ),
    [aggregate.signature, previousSignature, previousAt],
  );

  // QC fix: 분석 종료 후 lastSignature 영구 저장. ref로 중복 firing 가드 (aggregate.signature가
  //   re-aggregate마다 새 참조라 useEffect deps만으로는 부족했음). member id별 1회만 발사.
  const persistedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!member?.id || !aggregate.signature) return;
    if (persistedRef.current === member.id) return;
    persistedRef.current = member.id;
    // 메모리상 member에 stale fields가 있을 수 있어 lastSignature/lastAnalyzedAt 만 patch (merge 신뢰)
    persistMember({
      id: member.id,
      lastSignature: aggregate.signature,
      lastAnalyzedAt: new Date().toISOString(),
      lastAnalysis: new Date().toISOString(),
    } as typeof member).catch((err) => {
      if (__DEV__) console.warn('[report] failed to persist lastSignature:', err);
      // 실패 시 다음 진입 때 재시도되도록 ref 풀어주기
      persistedRef.current = null;
    });
  }, [member?.id, aggregate.signature]);

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

        <ScoreCard score={aggregate.score} />
        {comparison && <ChangeCheckSection comparison={comparison} />}
        {session.staticPoseResult && <StaticPoseSection result={session.staticPoseResult} />}

        <ModeToggle mode={mode} onChange={setMode} />

        {mode === 'member' ? (
          <MemberView summary={memberSummary} />
        ) : (
          <TrainerView
            patterns={nasmPatterns}
            chain={nasmChain}
            stages={salesScript}
            plan={ptPlan}
            allResults={session.allResults}
          />
        )}

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

function ModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <View className="mt-6 flex-row overflow-hidden rounded-lg border border-gray-300">
      <Pressable
        onPress={() => onChange('member')}
        className={`flex-1 items-center py-2.5 ${
          mode === 'member' ? 'bg-indigo-600' : 'bg-white active:bg-gray-100'
        }`}
      >
        <Text
          className={`text-sm ${mode === 'member' ? 'font-semibold text-white' : 'text-gray-700'}`}
        >
          👤 회원 요약
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onChange('trainer')}
        className={`flex-1 items-center border-l border-gray-300 py-2.5 ${
          mode === 'trainer' ? 'bg-indigo-600' : 'bg-white active:bg-gray-100'
        }`}
      >
        <Text
          className={`text-sm ${mode === 'trainer' ? 'font-semibold text-white' : 'text-gray-700'}`}
        >
          🔬 트레이너 분석
        </Text>
      </Pressable>
    </View>
  );
}

function MemberView({ summary }: { summary: MemberSummary }) {
  return (
    <View>
      <View className="mt-4 rounded-lg bg-indigo-50 p-3">
        <Text className="text-[11px] font-semibold text-indigo-700">
          📱 이 화면은 회원에게 직접 보여주기 위한 요약입니다 (생활 언어).
        </Text>
        <Text className="mt-1 text-[10px] leading-4 text-indigo-700/80">
          어디에 어떤 문제가 있고, 그대로 두면 어떤 일이 생기는지 — 정확한 운동 처방은 트레이너 탭에 있습니다.
        </Text>
      </View>
      <Tab1MemberSummary summary={summary} />
    </View>
  );
}

function TrainerView({
  patterns,
  chain,
  stages,
  plan,
  allResults,
}: {
  patterns: NasmPattern[];
  chain: CompensationChain | null;
  stages: SalesScriptStage[];
  plan: PtPlan;
  allResults: Record<string, ResultState>;
}) {
  return (
    <View>
      <View className="mt-4 rounded-lg bg-amber-50 p-3">
        <Text className="text-[11px] font-semibold text-amber-800">
          🔬 트레이너 전용 — 회원에게 직접 보여주기보다는 상담/처방 도구로 활용.
        </Text>
      </View>
      <Tab2NasmPatterns patterns={patterns} chain={chain} />
      <Tab3SalesScript stages={stages} />
      <PtPlanCard plan={plan} mode="trainer" />
      <PerStageResults allResults={allResults} />
    </View>
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

/* ─────────────────────────────────────────────────────────────
   B-12 변화 체크 — 이전 분석 대비 개선/악화 (PT 효과 입증)
   ───────────────────────────────────────────────────────────── */
function ChangeCheckSection({ comparison }: { comparison: ComparisonResult }) {
  const prevDate = comparison.previousAt
    ? new Date(comparison.previousAt).toLocaleDateString('ko-KR')
    : null;

  return (
    <View className="mt-6">
      <Text className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        📈 변화 체크 {prevDate ? `(${prevDate} 분석 대비)` : ''}
      </Text>
      <View className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
        {comparison.changes.map((c, i) => {
          const palette =
            c.type === 'improve'
              ? { bg: '#dcfce7', fg: '#166534', icon: '↑' }
              : c.type === 'worsen'
                ? { bg: '#fee2e2', fg: '#991b1b', icon: '↓' }
                : { bg: '#e0e7ff', fg: '#3730a3', icon: '↔' };
          return (
            <View
              key={i}
              className={`flex-row items-center ${i > 0 ? 'mt-2 border-t border-gray-100 pt-2' : ''}`}
            >
              <View
                className="mr-3 h-8 w-8 items-center justify-center rounded-full"
                style={{ backgroundColor: palette.bg }}
              >
                <Text className="text-base font-bold" style={{ color: palette.fg }}>
                  {palette.icon}
                </Text>
              </View>
              <View className="flex-1">
                <View className="flex-row items-center">
                  <Text className="text-xs font-semibold text-gray-900">{c.metric}</Text>
                  <View
                    className="ml-2 rounded px-1.5 py-0.5"
                    style={{ backgroundColor: palette.bg }}
                  >
                    <Text className="text-[10px] font-bold" style={{ color: palette.fg }}>
                      {c.label}
                    </Text>
                  </View>
                </View>
                <Text className="mt-0.5 text-[11px] text-gray-700">{c.text}</Text>
              </View>
            </View>
          );
        })}
        <Text className="mt-2 text-[10px] text-gray-400">
          측정 사실만 표시 — 원인은 트레이너 상담을 통해 확인하세요.
        </Text>
      </View>
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
  // 이슈 chip 한눈 보기용 (모라핏 스타일) — 부위명만 추출
  const issueChips = summary.problems.map((p) => ({
    name: p.name,
    severity: p.severity,
  }));

  return (
    <View className="mt-6">
      {/* 결론 — 헤드라인처럼 큼지막하게 */}
      <View className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
        <Text className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
          🎯 오늘의 결론
        </Text>
        <Text className="mt-1.5 text-base font-semibold leading-6 text-gray-900">
          {summary.conclusion}
        </Text>
      </View>

      {/* 이슈 부위 한눈 보기 — chip cluster */}
      {issueChips.length > 0 && (
        <View className="mt-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            발견된 부위 ({issueChips.length})
          </Text>
          <View className="mt-2 flex-row flex-wrap">
            {issueChips.map((c, i) => {
              const bg =
                c.severity === 'danger'
                  ? '#fee2e2'
                  : c.severity === 'warning'
                    ? '#fef3c7'
                    : '#dcfce7';
              const fg =
                c.severity === 'danger'
                  ? '#991b1b'
                  : c.severity === 'warning'
                    ? '#92400e'
                    : '#166534';
              return (
                <View
                  key={i}
                  className="mb-1.5 mr-1.5 rounded-full px-2.5 py-1"
                  style={{ backgroundColor: bg }}
                >
                  <Text className="text-[11px] font-semibold" style={{ color: fg }}>
                    {c.name}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {summary.problems.length > 0 && (
        <>
          <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-gray-500">
            상세 진단 ({summary.problems.length})
          </Text>
          {summary.problems.map((p, i) => (
            <View key={i} className="mt-2 rounded-lg border border-gray-200 bg-white p-4">
              <View className="flex-row items-center">
                <View
                  className="mr-3 h-7 w-7 items-center justify-center rounded-full"
                  style={{
                    backgroundColor:
                      p.severity === 'danger'
                        ? '#ef4444'
                        : p.severity === 'warning'
                          ? '#f59e0b'
                          : '#22c55e',
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

              {/* 핵심 문제 1, 2번에만 사진+skeleton 오버레이 표시 (대표 시각화) */}
              {i < 2 && p.frameDataUri && p.landmarks && (
                <View className="mt-2.5 overflow-hidden rounded-md border border-gray-200">
                  <SkeletonOverlay
                    imageUri={p.frameDataUri}
                    landmarks={p.landmarks}
                    highlightJointKey={p.jointKey}
                    severity={p.severity === 'normal' ? 'warning' : p.severity}
                  />
                  <View className="bg-black/60 px-2 py-1">
                    <Text className="text-[10px] font-semibold text-white">
                      📸 이 시점에 가장 크게 벗어났어요
                      {p.timeMs != null
                        ? ` (${Math.round(p.timeMs / 100) / 10}s${p.capRepIndex ? ` · ${p.capRepIndex}회차` : ''})`
                        : ''}
                    </Text>
                    <Text className="mt-0.5 text-[10px]" style={{ color: '#fca5a5' }}>
                      빨간 점/선 = {p.name}
                    </Text>
                  </View>
                </View>
              )}

              {p.dailyImpact && (
                <View className="mt-2 rounded-md bg-amber-50 p-2">
                  <Text className="text-[10px] font-semibold text-amber-800">
                    💢 지금 이런 불편함 있을 수 있어요
                  </Text>
                  <Text className="mt-0.5 text-[11px] leading-4 text-amber-900">
                    {p.dailyImpact}
                  </Text>
                </View>
              )}
              {p.painRisk && (
                <View className="mt-1.5 rounded-md bg-red-50 p-2">
                  <Text className="text-[10px] font-semibold text-red-800">
                    ⚠️ 그대로 두면 생길 수 있는 통증
                  </Text>
                  <Text className="mt-0.5 text-[11px] leading-4 text-red-900">{p.painRisk}</Text>
                </View>
              )}
              {p.cascade && (
                <View className="mt-1.5 rounded-md border border-gray-200 bg-gray-50 p-2.5">
                  <Text className="text-[10px] font-semibold text-gray-700">
                    📅 그대로 두면 시간이 지나며…
                  </Text>
                  <Text className="mt-1 text-[11px] leading-4 text-gray-700">
                    <Text className="font-semibold">▸ 1-3개월: </Text>
                    {p.cascade.short}
                  </Text>
                  <Text className="mt-0.5 text-[11px] leading-4 text-gray-700">
                    <Text className="font-semibold">▸ 3-12개월: </Text>
                    {p.cascade.mid}
                  </Text>
                  <Text className="mt-0.5 text-[11px] leading-4 text-gray-700">
                    <Text className="font-semibold">▸ 1-3년: </Text>
                    {p.cascade.long}
                  </Text>
                </View>
              )}
            </View>
          ))}
        </>
      )}

      {summary.whyItems.length > 0 && (
        <>
          <Text className="mt-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
            왜 문제인가
          </Text>
          {summary.whyItems.map((w, i) => (
            <View key={i} className="mt-1.5 flex-row">
              <Text className="mr-2 text-base">{w.icon}</Text>
              <Text className="flex-1 text-xs leading-5 text-gray-700">{w.text}</Text>
            </View>
          ))}
        </>
      )}

      <Text className="mt-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
        예상 변화
      </Text>
      <View className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <Text className="text-xs font-semibold text-gray-700">2-4주차 (신경근 적응기)</Text>
        <Text className="mt-1 text-xs leading-5 text-gray-600">{summary.changes.week24}</Text>
        <Text className="mt-3 text-xs font-semibold text-gray-700">6-8주차 (구조적 변화기)</Text>
        <Text className="mt-1 text-xs leading-5 text-gray-600">{summary.changes.week68}</Text>
      </View>

      <View className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
        <Text className="text-xs font-semibold text-indigo-800">권장 PT</Text>
        <Text className="mt-1 text-sm font-semibold text-indigo-900">
          {summary.ptRange} (총 {summary.totalSessions}회)
        </Text>
        <Text className="mt-1.5 text-xs leading-5 text-indigo-900">{summary.ptReason}</Text>
      </View>
    </View>
  );
}

function Tab2NasmPatterns({
  patterns,
  chain,
}: {
  patterns: NasmPattern[];
  chain: CompensationChain | null;
}) {
  if (patterns.length === 0 && !chain) return null;
  return (
    <View className="mt-6">
      <Text className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        🧬 NASM 움직임 패턴 분류
      </Text>

      {patterns.length > 0 && (
        <View className="mt-2 flex-row flex-wrap">
          {patterns.slice(0, 4).map((p, i) => (
            <View
              key={i}
              className="mb-2 mr-2 flex-row items-center rounded-full border border-gray-300 bg-white px-3 py-1.5"
            >
              <Text className="mr-1.5 text-sm">{p.emoji}</Text>
              <View>
                <Text className="text-xs font-semibold text-gray-900">{p.type}</Text>
                <Text className="text-[10px] text-indigo-600">가능성 {p.confidence}%</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {chain && (
        <View className="mt-2 rounded-lg border-l-4 border-indigo-500 bg-indigo-50 p-3">
          <Text className="text-[11px] font-semibold text-indigo-800">
            🔗 보상 체인 — 근본 원인: {chain.root}
          </Text>
          <View className="mt-2 flex-row flex-wrap items-center">
            {chain.chain.map((s, i) => (
              <View key={i} className="mb-1 flex-row items-center">
                <View
                  className="rounded-full px-2 py-0.5"
                  style={{
                    backgroundColor: i === 0 ? '#a5b4fc' : '#e5e7eb',
                  }}
                >
                  <Text
                    className="text-[10px]"
                    style={{
                      color: i === 0 ? '#1e1b4b' : '#374151',
                      fontWeight: i === 0 ? '700' : '500',
                    }}
                  >
                    {s}
                  </Text>
                </View>
                {i < chain.chain.length - 1 && (
                  <Text className="mx-1 text-xs text-gray-400">→</Text>
                )}
              </View>
            ))}
          </View>
          <Text className="mt-2 text-xs leading-5 text-gray-700">{chain.text}</Text>
        </View>
      )}
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
            {s.step}단계 — {s.label}
          </Text>
          <Text className="mt-1.5 text-xs leading-5 text-gray-700">{s.text}</Text>
        </View>
      ))}
    </View>
  );
}

function PtPlanCard({ plan, mode }: { plan: PtPlan; mode: ViewMode }) {
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
        {plan.basis ? (
          <Text className="mt-0.5 text-[11px] text-gray-500">근거: {plan.basis}</Text>
        ) : null}

        <View className="mt-3">
          {plan.phases.map((ph) => (
            <View
              key={ph.num}
              className="mt-2 rounded-md border-l-4 bg-gray-50 p-3"
              style={{ borderLeftColor: ph.color }}
            >
              <View className="flex-row items-center">
                <Text
                  className="mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                  style={{ backgroundColor: ph.color }}
                >
                  {ph.num}단계
                </Text>
                <Text className="flex-1 text-xs font-semibold text-gray-900">{ph.range}</Text>
              </View>
              <Text className="mt-1 text-xs font-semibold text-gray-800">{ph.goal}</Text>
              {mode === 'trainer' && (
                <Text className="mt-1 text-[11px] leading-4 text-gray-600">{ph.why}</Text>
              )}
              <PhaseExerciseList
                refs={ph.exerciseRefs}
                fallback={ph.exercises}
                mode={mode}
              />
            </View>
          ))}
        </View>

        {plan.trainerMsg && mode === 'trainer' ? (
          <View className="mt-3 rounded-md bg-amber-50 p-2.5">
            <Text className="text-[11px] leading-4 text-amber-900">{plan.trainerMsg}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────
   B-8d: 운동 카드 — 회원 모드는 친근, 트레이너 모드는 풀 처방
   ───────────────────────────────────────────────────────────── */

function PhaseExerciseList({
  refs,
  fallback,
  mode,
}: {
  refs: ExerciseRef[] | undefined;
  fallback: string[];
  mode: ViewMode;
}) {
  if (refs && refs.length > 0) {
    return (
      <View className="mt-2">
        {refs.map((ref, i) => {
          const ex = getExercise(ref.id);
          if (!ex) {
            return (
              <Text key={i} className="text-[11px] leading-4 text-gray-700">
                • {ref.id}
              </Text>
            );
          }
          return <ExerciseCard key={ref.id + i} exercise={ex} ref_={ref} mode={mode} />;
        })}
      </View>
    );
  }
  if (fallback.length === 0) return null;
  return (
    <View className="mt-1.5">
      {fallback.map((ex, i) => (
        <Text key={i} className="text-[11px] leading-4 text-gray-700">
          • {ex}
        </Text>
      ))}
    </View>
  );
}

const CATEGORY_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  mobility: { label: '가동성', bg: '#ecfeff', fg: '#0e7490' },
  stability: { label: '안정성', bg: '#fef3c7', fg: '#92400e' },
  strength: { label: '근력', bg: '#fee2e2', fg: '#991b1b' },
  pattern: { label: '패턴', bg: '#dcfce7', fg: '#166534' },
};

function ExerciseCard({
  exercise,
  ref_,
  mode,
}: {
  exercise: ExerciseEntry;
  ref_: ExerciseRef;
  mode: ViewMode;
}) {
  const cat = CATEGORY_LABEL[exercise.category];
  const sets = ref_.setsOverride ?? exercise.defaultSets;
  const reps = ref_.repsOverride ?? exercise.defaultReps;

  // 회원 모드: 간소 카드 (이름 + 효과 + 짧은 큐 1개)
  if (mode === 'member') {
    return (
      <View className="mt-1.5 rounded-md bg-white p-2.5" style={{ borderWidth: 1, borderColor: '#e5e7eb' }}>
        <View className="flex-row items-start">
          <View
            className="mr-2 rounded px-1.5 py-0.5"
            style={{ backgroundColor: cat.bg }}
          >
            <Text className="text-[9px] font-bold" style={{ color: cat.fg }}>
              {cat.label}
            </Text>
          </View>
          <Text className="flex-1 text-xs font-semibold text-gray-900">{exercise.name}</Text>
          <Text className="ml-1 text-[10px] text-gray-500">
            {reps} · {sets}
          </Text>
        </View>
        {exercise.effect ? (
          <Text className="mt-1 text-[11px] leading-4 text-gray-700">→ {exercise.effect}</Text>
        ) : null}
        {exercise.cues && exercise.cues.length > 0 ? (
          <Text className="mt-0.5 text-[10px] leading-4 text-indigo-700">
            💡 {exercise.cues[0]}
          </Text>
        ) : null}
      </View>
    );
  }

  // 트레이너 모드: 풀 카드 (이름 + 분류 + sets/reps + 장비 + 큐 전체 + 효과 + 주의)
  return (
    <View
      className="mt-1.5 rounded-md bg-white p-2.5"
      style={{ borderWidth: 1, borderColor: '#e5e7eb' }}
    >
      <View className="flex-row items-start">
        <View
          className="mr-2 rounded px-1.5 py-0.5"
          style={{ backgroundColor: cat.bg }}
        >
          <Text className="text-[9px] font-bold" style={{ color: cat.fg }}>
            {cat.label}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-xs font-semibold text-gray-900">{exercise.name}</Text>
          {exercise.nameEn ? (
            <Text className="text-[9px] text-gray-400">{exercise.nameEn}</Text>
          ) : null}
        </View>
        <Text className="ml-1 text-[10px] font-semibold text-indigo-700">
          {reps} · {sets}
        </Text>
      </View>

      {exercise.equipment && exercise.equipment.length > 0 ? (
        <Text className="mt-1 text-[10px] text-gray-500">
          🛠 {exercise.equipment.join(' / ')}
        </Text>
      ) : null}

      {ref_.note ? (
        <Text className="mt-1 text-[10px] font-semibold text-amber-700">⚑ {ref_.note}</Text>
      ) : null}

      {exercise.cues && exercise.cues.length > 0 ? (
        <View className="mt-1">
          {exercise.cues.map((cue, i) => (
            <Text key={i} className="text-[10px] leading-4 text-indigo-700">
              💡 {cue}
            </Text>
          ))}
        </View>
      ) : null}

      {exercise.effect ? (
        <Text className="mt-1 text-[10px] leading-4 text-gray-600">→ {exercise.effect}</Text>
      ) : null}

      {exercise.caution ? (
        <Text className="mt-1 text-[10px] leading-4 text-red-600">⚠ {exercise.caution}</Text>
      ) : null}
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
  const dev = devOf(capture.angle, capture.normalRange);
  return (
    <View className="mt-2 border-t border-gray-100 pt-2">
      <View className="flex-row items-center">
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
      {capture.frameDataUri && (
        <View className="ml-7 mt-1.5 overflow-hidden rounded-md border border-gray-200">
          {capture.landmarks ? (
            <SkeletonOverlay
              imageUri={capture.frameDataUri}
              landmarks={capture.landmarks}
              highlightJointKey={capture.jointKey}
              severity={capture.severity}
            />
          ) : null}
          <View className="bg-black/60 px-2 py-1">
            <Text className="text-[10px] font-semibold text-white">
              🎯 이슈 발생 시점 — {Math.round(capture.timeMs / 100) / 10}s
              {capture.repIndex ? ` (${capture.repIndex}번째 반복)` : ''}
            </Text>
            <Text className="mt-0.5 text-[10px]" style={{ color: '#fca5a5' }}>
              빨간 점/선 = {capture.jointName} 부위가 정상 범위에서 벗어남
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────
   allResults 통합 — 모든 단계의 jointSummary / criticals / recurrence /
   signature 를 합쳐 V2 lib 함수에 넘길 수 있는 형태로 정규화.

   web v17 finalizeMultiResult 의 병합 로직 + 파생 데이터.
   ───────────────────────────────────────────────────────────── */
interface AggregatedResults {
  score: number;
  criticals: Capture[];
  summary: Record<string, JointSummaryEntry>;
  recurrence: Record<string, RecurrenceData>;
  signature: VideoSignature | null;
  allAngles: JointAngles;
  totalReps: number;
  hasOhs: boolean;
}

function aggregateAllResults(allResults: Record<string, ResultState>): AggregatedResults {
  const entries = Object.entries(allResults);
  if (entries.length === 0) {
    return {
      score: 0,
      criticals: [],
      summary: {},
      recurrence: {},
      signature: null,
      allAngles: {},
      totalReps: 0,
      hasOhs: false,
    };
  }

  // 점수: 단계별 평균
  const scores = entries.map(([, r]) => r.overallScore).filter((n) => n > 0);
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  // jointSummary 병합 (worst deviation 기준)
  const summary: Record<string, JointSummaryEntry> = {};
  entries.forEach(([, r]) => {
    Object.entries(r.jointSummary ?? {}).forEach(([jk, d]) => {
      if (!summary[jk]) {
        summary[jk] = d;
        return;
      }
      const existDev = devOf(summary[jk].worst, summary[jk].range);
      const newDev = devOf(d.worst, d.range);
      if (newDev > existDev) summary[jk] = d;
    });
  });

  // criticals 병합 (jointKey 중복 제거 — 가장 큰 이탈만 유지)
  const byJoint = new Map<string, Capture>();
  entries.forEach(([, r]) => {
    (r.criticalIssues ?? []).forEach((c) => {
      const existing = byJoint.get(c.jointKey);
      if (!existing) {
        byJoint.set(c.jointKey, c);
        return;
      }
      const dN = devOf(c.angle, c.normalRange);
      const dE = devOf(existing.angle, existing.normalRange);
      if (dN > dE) byJoint.set(c.jointKey, c);
    });
  });
  const criticals = Array.from(byJoint.values())
    .sort((a, b) => devOf(b.angle, b.normalRange) - devOf(a.angle, a.normalRange))
    .slice(0, AppConfig.EXPERT.MAX_CRITICAL_OUTPUT);

  // recurrence: OHS 결과 중 가장 최근 (마지막 OHS 단계)
  const ohsEntries = entries.filter(([id]) => id.startsWith('ohs'));
  const lastOhs = ohsEntries[ohsEntries.length - 1]?.[1];
  const recurrence = lastOhs?.recurrence ?? {};

  // signature: 마지막 OHS 단계의 videoSignature
  const signature = lastOhs?.videoSignature ?? null;

  // allAngles: 단계별 jointSummary.avg 를 single JointAngles 로 평탄화 — NASMEngine.classifyPattern 입력용
  const allAngles: JointAngles = {};
  Object.entries(summary).forEach(([jk, d]) => {
    allAngles[jk] = d.avg;
  });

  const totalReps = lastOhs?.sqReps?.length ?? 0;
  const hasOhs = ohsEntries.length > 0;

  return { score: avgScore, criticals, summary, recurrence, signature, allAngles, totalReps, hasOhs };
}
