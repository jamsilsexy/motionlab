import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConsentModal } from '@/components/consent-modal';
import { type Member } from '@/lib/analysis';
import { getMember, upsertMember } from '@/lib/members';

export default function MemberDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [showConsent, setShowConsent] = useState(false);

  const fetch = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      const m = await getMember(id);
      setMember(m);
    } catch (err) {
      Alert.alert('회원 불러오기 실패', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  const onStartAnalysis = () => {
    if (!member) return;
    if (member.consentedAt) {
      router.push(`/analysis/upload?memberId=${member.id}`);
    } else {
      setShowConsent(true);
    }
  };

  const onConsentConfirmed = async () => {
    if (!member) return;
    setShowConsent(false);
    try {
      const updated: Member = { ...member, consentedAt: new Date().toISOString() };
      await upsertMember(updated);
      setMember(updated);
      router.push(`/analysis/upload?memberId=${member.id}`);
    } catch (err) {
      Alert.alert('동의 시각 저장 실패', (err as Error).message);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#4f46e5" />
      </SafeAreaView>
    );
  }

  if (!member) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-base text-gray-700">회원을 찾을 수 없습니다</Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-4 rounded-lg bg-gray-100 px-4 py-2"
        >
          <Text className="text-sm text-gray-700">목록으로</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center border-b border-gray-200 px-4 py-3">
        <Pressable onPress={() => router.back()}>
          <Text className="text-base text-indigo-600">← 목록</Text>
        </Pressable>
        <Text className="ml-4 flex-1 text-base font-semibold text-gray-900">
          {member.name || '이름 없음'}
        </Text>
      </View>

      <ScrollView className="flex-1 px-6 pt-4">
        <Section label="기본 정보">
          <Row k="성별" v={genderLabel(member.gender)} />
          <Row k="나이" v={member.age ? `${member.age}세` : '-'} />
          <Row
            k="키 / 몸무게"
            v={`${member.height || '-'}cm / ${member.weight || '-'}kg`}
          />
          <Row k="목표" v={goalLabel(member.goal)} />
          <Row k="비대칭" v={asymmetryLabel(member.asymmetry)} />
        </Section>

        {(member.painAreas || member.injuryHistory) && (
          <Section label="건강 상태">
            {member.painAreas ? <Row k="통증" v={member.painAreas} /> : null}
            {member.injuryHistory ? <Row k="부상 이력" v={member.injuryHistory} /> : null}
          </Section>
        )}

        {member.notes ? (
          <Section label="메모">
            <Text className="text-sm text-gray-700">{member.notes}</Text>
          </Section>
        ) : null}

        <Section label="동의 상태">
          <Text className={`text-sm ${member.consentedAt ? 'text-green-700' : 'text-gray-500'}`}>
            {member.consentedAt
              ? `동의 완료 (${new Date(member.consentedAt).toLocaleDateString('ko-KR')})`
              : '미동의 — 분석 시작 시 동의서 받음'}
          </Text>
        </Section>

        <View className="h-24" />
      </ScrollView>

      <View className="px-6 pb-4 pt-2">
        <Pressable
          onPress={onStartAnalysis}
          className="items-center rounded-lg bg-indigo-600 py-3.5 active:bg-indigo-700"
        >
          <Text className="text-base font-semibold text-white">분석 시작</Text>
        </Pressable>
      </View>

      <ConsentModal
        visible={showConsent}
        memberId={member.id}
        memberName={member.name}
        onCancel={() => setShowConsent(false)}
        onConfirm={onConsentConfirmed}
      />
    </SafeAreaView>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mb-5">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </Text>
      <View className="rounded-lg border border-gray-200 bg-gray-50 p-4">{children}</View>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View className="mb-1.5 flex-row">
      <Text className="w-24 text-xs text-gray-500">{k}</Text>
      <Text className="flex-1 text-sm text-gray-800">{v}</Text>
    </View>
  );
}

function goalLabel(g?: string): string {
  switch (g) {
    case 'weight':
      return '체중 감량';
    case 'performance':
      return '퍼포먼스';
    case 'rehab':
      return '재활';
    case 'general':
      return '일반 건강';
    default:
      return '-';
  }
}

function genderLabel(g?: string): string {
  switch (g) {
    case 'male':
      return '남';
    case 'female':
      return '여';
    default:
      return '-';
  }
}

function asymmetryLabel(a?: string): string {
  switch (a) {
    case 'minor':
      return '경미';
    case 'significant':
      return '심함';
    case 'none':
      return '없음';
    default:
      return '-';
  }
}
