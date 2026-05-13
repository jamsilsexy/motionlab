import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { useEffect, useState } from 'react';

import { auth } from './firebase';
import { SH, useAnalysisStore } from './analysis/state';

export async function signInEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signUpEmail(email: string, password: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
  // QC fix: 트레이너 A 로그아웃 후 B 로그인 시 zustand에 A의 회원/분석 데이터가 남아
  //   B 화면에 노출 + B의 Firestore subtree에 잘못된 write가 일어나던 문제 차단.
  //   - session/result/realtime/squatTracker 초기화
  //   - members 배열 초기화 + AsyncStorage 캐시 삭제
  try {
    SH.resetSession();
    SH.resetResult();
    SH.resetRealtime();
    SH.resetSquatTracker();
    useAnalysisStore.setState({ members: [] });
    await AsyncStorage.removeItem('formAI_members');
  } catch (err) {
    if (__DEV__) console.warn('[auth] post-signOut cleanup failed:', err);
  }
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export interface AuthState {
  user: User | null;
  initializing: boolean;
}

/**
 * Firebase Auth state hook. RN persistence 덕에 앱 재시작 시 자동 복구.
 * `initializing: true` 동안은 splash 또는 빈 화면 표시 권장.
 */
export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [initializing, setInitializing] = useState<boolean>(auth.currentUser === null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setInitializing(false);
    });
    return unsub;
  }, []);

  return { user, initializing };
}

/**
 * Firebase Auth 에러 코드 → 한국어 메시지 매핑.
 */
export function authErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'auth/invalid-email':
      return '올바른 이메일 형식이 아닙니다.';
    case 'auth/user-disabled':
      return '비활성화된 계정입니다.';
    case 'auth/user-not-found':
      return '등록되지 않은 이메일입니다.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return '이메일 또는 비밀번호가 올바르지 않습니다.';
    case 'auth/email-already-in-use':
      return '이미 가입된 이메일입니다. 로그인해 주세요.';
    case 'auth/weak-password':
      return '비밀번호는 6자 이상이어야 합니다.';
    case 'auth/network-request-failed':
      return '네트워크 연결을 확인해 주세요.';
    case 'auth/too-many-requests':
      return '잠시 후 다시 시도해 주세요.';
    default:
      return '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
}
