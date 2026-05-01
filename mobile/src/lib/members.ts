import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';

import { type Member } from '@/lib/analysis';

import { auth, db } from './firebase';

function memberCollection(uid: string) {
  return collection(db, 'members', uid, 'list');
}

function uidOrThrow(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('인증되지 않은 사용자입니다.');
  return uid;
}

export async function listMembers(): Promise<Member[]> {
  const uid = uidOrThrow();
  const snap = await getDocs(query(memberCollection(uid), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ ...(d.data() as Member), id: d.id }));
}

export async function getMember(id: string): Promise<Member | null> {
  const uid = uidOrThrow();
  const snap = await getDoc(doc(db, 'members', uid, 'list', id));
  if (!snap.exists()) return null;
  return { ...(snap.data() as Member), id: snap.id };
}

export async function upsertMember(m: Member): Promise<void> {
  const uid = uidOrThrow();
  if (!m.id) throw new Error('Member.id가 필요합니다.');
  await setDoc(doc(db, 'members', uid, 'list', m.id), m, { merge: true });
}

export async function deleteMember(id: string): Promise<void> {
  const uid = uidOrThrow();
  await deleteDoc(doc(db, 'members', uid, 'list', id));
}

/**
 * 새 Member 인스턴스 생성 (id + createdAt 자동).
 * form_ai_v17.html DM.Member factory 호환.
 */
export function newMember(partial: Partial<Member> = {}): Member {
  return {
    id: partial.id ?? generateId(),
    name: partial.name ?? '',
    gender: partial.gender ?? '',
    age: partial.age ?? 0,
    experience: partial.experience ?? '',
    height: partial.height ?? 0,
    weight: partial.weight ?? 0,
    bodyFat: partial.bodyFat ?? 0,
    muscleMass: partial.muscleMass ?? 0,
    asymmetry: partial.asymmetry ?? 'none',
    goal: partial.goal ?? 'general',
    painAreas: partial.painAreas ?? '',
    injuryHistory: partial.injuryHistory ?? '',
    notes: partial.notes ?? '',
    createdAt: partial.createdAt ?? new Date().toISOString(),
    lastAnalysis: partial.lastAnalysis ?? null,
    consentedAt: partial.consentedAt ?? null,
  };
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}
