import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { auth, db } from './firebase';

export interface AgreedTerms {
  dataCollection: boolean;
  aiAnalysis: boolean;
  retentionUntilEnd: boolean;
}

export interface ConsentResult {
  signatureDataUrl: string;
  agreedTerms: AgreedTerms;
}

/**
 * 회원 동의 이력 Firestore 저장 — P0-4 패턴 RN 이전.
 * 경로: consent_logs/{trainerUid}/list/{logId}
 * logId 형식: `${memberId}_${epoch}` (충돌 방지)
 */
export async function saveConsent(
  memberId: string,
  signatureDataUrl: string,
  agreedTerms: AgreedTerms,
): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('인증되지 않은 사용자입니다.');
  if (!memberId) throw new Error('회원 ID가 누락되었습니다.');
  if (!signatureDataUrl) throw new Error('서명이 누락되었습니다.');

  const logId = `${memberId}_${Date.now()}`;
  await setDoc(doc(db, 'consent_logs', uid, 'list', logId), {
    memberId,
    signatureDataUrl,
    agreedTerms,
    trainerUid: uid,
    createdAt: serverTimestamp(),
  });
  return logId;
}
