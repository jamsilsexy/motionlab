import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authErrorMessage, resetPassword, signInEmail, signUpEmail } from '@/lib/auth';

type Mode = 'signIn' | 'signUp';

export default function LoginScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      Alert.alert('입력 오류', '이메일과 비밀번호를 모두 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signIn') {
        await signInEmail(email, password);
      } else {
        await signUpEmail(email, password);
      }
      router.replace('/');
    } catch (err) {
      const code = (err as { code?: string }).code;
      Alert.alert('로그인 실패', authErrorMessage(code));
    } finally {
      setBusy(false);
    }
  };

  const onForgot = async () => {
    if (!email.trim()) {
      Alert.alert('비밀번호 재설정', '이메일을 먼저 입력해 주세요.');
      return;
    }
    try {
      await resetPassword(email);
      Alert.alert('비밀번호 재설정', '비밀번호 재설정 메일을 보냈습니다. 받은편지함을 확인해 주세요.');
    } catch (err) {
      const code = (err as { code?: string }).code;
      Alert.alert('재설정 실패', authErrorMessage(code));
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View className="flex-1 justify-center px-6">
          <Text className="mb-2 text-3xl font-bold text-gray-900">MOTION LAB</Text>
          <Text className="mb-8 text-sm text-gray-500">AI 33-landmark 체형 분석 — PT 트레이너용</Text>

          <View className="mb-3">
            <Text className="mb-1.5 text-xs font-semibold text-gray-700">이메일</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="trainer@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              className="rounded-lg border border-gray-300 px-4 py-3 text-base text-gray-900"
              editable={!busy}
            />
          </View>

          <View className="mb-4">
            <Text className="mb-1.5 text-xs font-semibold text-gray-700">비밀번호</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="6자 이상"
              secureTextEntry
              autoComplete="password"
              className="rounded-lg border border-gray-300 px-4 py-3 text-base text-gray-900"
              editable={!busy}
            />
          </View>

          <Pressable
            onPress={submit}
            disabled={busy}
            className="mb-4 items-center rounded-lg bg-indigo-600 py-3.5 active:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-base font-semibold text-white">
                {mode === 'signIn' ? '로그인' : '회원가입'}
              </Text>
            )}
          </Pressable>

          <View className="flex-row items-center justify-between">
            <Pressable onPress={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
              <Text className="text-sm text-indigo-600">
                {mode === 'signIn' ? '회원가입' : '로그인으로 돌아가기'}
              </Text>
            </Pressable>
            {mode === 'signIn' && (
              <Pressable onPress={onForgot}>
                <Text className="text-sm text-gray-500">비밀번호 찾기</Text>
              </Pressable>
            )}
          </View>

          <Text className="mt-8 text-xs text-gray-400">
            본 앱은 의료기기가 아니며 분석 결과는 참고용입니다.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
