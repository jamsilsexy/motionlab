import { AppConfig } from './config';
import type { JointRange, Landmark, RiskLevel } from './types';

export function calcAngle(A: Landmark, B: Landmark, C: Landmark): number {
  const r = Math.atan2(C.y - B.y, C.x - B.x) - Math.atan2(A.y - B.y, A.x - B.x);
  let d = Math.abs((r * 180) / Math.PI);
  if (d > 180) d = 360 - d;
  return Math.round(d);
}

export function lmAngle(
  lms: Landmark[],
  a: number,
  b: number,
  c: number,
): number | null {
  const mv = AppConfig.REALTIME.MIN_VISIBILITY;
  const A = lms[a];
  const B = lms[b];
  const C = lms[c];
  if (!A || !B || !C) return null;
  if ((A.visibility ?? 0) < mv || (B.visibility ?? 0) < mv || (C.visibility ?? 0) < mv) {
    return null;
  }
  return calcAngle(A, B, C);
}

/**
 * 위험도 분류 — 웨이트 트레이닝 + 기능 + 부상 위험 관점.
 * 재활 기준(작은 이탈도 문제)과 달리 10도 미만 = 정상 변이(ignore).
 */
export function riskOf(angle: number | null | undefined, range: JointRange): RiskLevel {
  if (angle === null || angle === undefined) return 'ignore';
  const dev = Math.max(range.min - angle, angle - range.max, 0);
  if (dev === 0) return 'normal';
  if (dev < 10) return 'ignore';
  if (dev < AppConfig.EXPERT.CRITICAL_DEVIATION_DEG) return 'warning';
  return 'danger';
}

export function devOf(angle: number, range: JointRange): number {
  return Math.max(range.min - angle, angle - range.max, 0);
}

export function scoreColor(s: number): string {
  return s >= 80 ? '#22c55e' : s >= 60 ? '#f59e0b' : '#ef4444';
}

export function toTimecode(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function toSecLabel(s: number): string {
  return `${s.toFixed(1)}s`;
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export function isVisible(lm: Landmark | undefined | null): boolean {
  return !!lm && (lm.visibility ?? 0) >= AppConfig.REALTIME.MIN_VISIBILITY;
}

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
