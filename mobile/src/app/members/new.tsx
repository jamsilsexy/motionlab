import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  type MemberAsymmetry,
  type MemberGender,
  type MemberGoal,
} from '@/lib/analysis';
import { newMember, upsertMember } from '@/lib/members';

export default function NewMemberScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [gender, setGender] = useState<MemberGender>('');
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [goal, setGoal] = useState<MemberGoal>('general');
  const [asymmetry, setAsymmetry] = useState<MemberAsymmetry>('none');
  const [painAreas, setPainAreas] = useState('');
  const [injuryHistory, setInjuryHistory] = useState('');
  const [notes, setNotes] = useState('');

  const onSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('입력 오류', '이름을 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const m = newMember({
        name: name.trim(),
        gender,
        age: parseInt(age, 10) || 0,
        height: parseFloat(height) || 0,
        weight: parseFloat(weight) || 0,
        goal,
        asymmetry,
        painAreas: painAreas.trim(),
        injuryHistory: injuryHistory.trim(),
        notes: notes.trim(),
      });
      await upsertMember(m);
      router.replace('/');
    } catch (err) {
      Alert.alert('등록 실패', (err as Error).message);
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View className="flex-row items-center border-b border-gray-200 px-4 py-3">
          <Pressable onPress={() => router.back()} disabled={busy}>
            <Text className="text-base text-indigo-600">취소</Text>
          </Pressable>
          <Text className="ml-4 flex-1 text-base font-semibold text-gray-900">새 회원 등록</Text>
          <Pressable onPress={onSubmit} disabled={busy || !name.trim()}>
            {busy ? (
              <ActivityIndicator color="#4f46e5" />
            ) : (
              <Text
                className={`text-base font-semibold ${name.trim() ? 'text-indigo-600' : 'text-gray-300'}`}
              >
                저장
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView className="flex-1 px-6 pt-4" keyboardShouldPersistTaps="handled">
          <Field label="이름 *">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="홍길동"
              className="rounded-lg border border-gray-300 px-4 py-3 text-base text-gray-900"
              editable={!busy}
            />
          </Field>

          <Field label="성별">
            <Segment
              options={[
                { value: '', label: '미선택' },
                { value: 'male', label: '남' },
                { value: 'female', label: '여' },
              ]}
              value={gender}
              onChange={(v) => setGender(v as MemberGender)}
              disabled={busy}
            />
          </Field>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field label="나이">
                <TextInput
                  value={age}
                  onChangeText={setAge}
                  placeholder="35"
                  keyboardType="number-pad"
                  className="rounded-lg border border-gray-300 px-4 py-3 text-base text-gray-900"
                  editable={!busy}
                />
              </Field>
            </View>
            <View className="flex-1">
              <Field label="키 (cm)">
                <TextInput
                  value={height}
                  onChangeText={setHeight}
                  placeholder="175"
                  keyboardType="decimal-pad"
                  className="rounded-lg border border-gray-300 px-4 py-3 text-base text-gray-900"
                  editable={!busy}
                />
              </Field>
            </View>
            <View className="flex-1">
              <Field label="몸무게 (kg)">
                <TextInput
                  value={weight}
                  onChangeText={setWeight}
                  placeholder="70"
                  keyboardType="decimal-pad"
                  className="rounded-lg border border-gray-300 px-4 py-3 text-base text-gray-900"
                  editable={!busy}
                />
              </Field>
            </View>
          </View>

          <Field label="운동 목표">
            <Segment
              options={[
                { value: 'general', label: '일반' },
                { value: 'weight', label: '감량' },
                { value: 'performance', label: '퍼포먼스' },
                { value: 'rehab', label: '재활' },
              ]}
              value={goal}
              onChange={(v) => setGoal(v as MemberGoal)}
              disabled={busy}
            />
          </Field>

          <Field label="좌우 비대칭">
            <Segment
              options={[
                { value: 'none', label: '없음' },
                { value: 'minor', label: '경미' },
                { value: 'significant', label: '심함' },
              ]}
              value={asymmetry}
              onChange={(v) => setAsymmetry(v as MemberAsymmetry)}
              disabled={busy}
            />
          </Field>

          <Field label="통증 부위 (선택)">
            <TextInput
              value={painAreas}
              onChangeText={setPainAreas}
              placeholder="예: 오른쪽 무릎"
              className="rounded-lg border border-gray-300 px-4 py-3 text-base text-gray-900"
              editable={!busy}
            />
          </Field>

          <Field label="부상 이력 (선택)">
            <TextInput
              value={injuryHistory}
              onChangeText={setInjuryHistory}
              placeholder="예: 2년 전 무릎 인대 손상"
              multiline
              className="min-h-[60px] rounded-lg border border-gray-300 px-4 py-3 text-base text-gray-900"
              editable={!busy}
            />
          </Field>

          <Field label="메모 (선택)">
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="특이사항"
              multiline
              className="min-h-[60px] rounded-lg border border-gray-300 px-4 py-3 text-base text-gray-900"
              editable={!busy}
            />
          </Field>

          <View className="h-24" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mb-3">
      <Text className="mb-1.5 text-xs font-semibold text-gray-700">{label}</Text>
      {children}
    </View>
  );
}

interface SegmentOption {
  value: string;
  label: string;
}

function Segment({
  options,
  value,
  onChange,
  disabled,
}: {
  options: SegmentOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row overflow-hidden rounded-lg border border-gray-300">
      {options.map((opt, i) => (
        <Pressable
          key={opt.value}
          onPress={() => onChange(opt.value)}
          disabled={disabled}
          className={`flex-1 items-center py-2.5 ${
            value === opt.value ? 'bg-indigo-600' : 'bg-white active:bg-gray-100'
          } ${i > 0 ? 'border-l border-gray-300' : ''}`}
        >
          <Text
            className={`text-sm ${
              value === opt.value ? 'font-semibold text-white' : 'text-gray-700'
            }`}
          >
            {opt.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
