/* ════════════════════════════════════════════════════════════════
   FORM AI v17 — Cloud Functions (P0-1)
   ────────────────────────────────────────────────────────────────
   목적:
     ① Custom Claims 발급 (setAdminClaim / setTesterClaim)
     ② admin-only Cloud Function의 표준 패턴 (requireAdmin 헬퍼)
     ③ 감사 로그 (admin_audit_log) — 누가 누구에게 권한 부여/회수했나
   배포:
     firebase deploy --only functions
   리전:
     asia-northeast3 (서울) — 한국 사용자 지연 최소화
═══════════════════════════════════════════════════════════════════ */
'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions }   = require('firebase-functions/v2');
const admin                  = require('firebase-admin');
const logger                 = require('firebase-functions/logger');

admin.initializeApp();
setGlobalOptions({ region: 'asia-northeast3', maxInstances: 10 });

/* ─────────────────────────────────────────────────────────────
   Layer ② — admin-only 검증 헬퍼.
   모든 관리자 전용 onCall 함수의 첫 줄에서 호출한다.
   클라이언트 코드를 임의 수정해도 이 검증을 통과할 수 없다.
   (서버에서 토큰을 직접 검증하기 때문)
   ────────────────────────────────────────────────────────────── */
function requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }
  if (request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', '관리자 권한이 필요합니다.');
  }
}

/* ─────────────────────────────────────────────────────────────
   감사 로그 기록 — Firestore admin_audit_log 컬렉션에 쌓는다.
   P1-6(Cloud Logging 감사로그)과 별개로, 권한 변경 이력은
   Firestore에 보관해야 추적이 쉽다.
   ────────────────────────────────────────────────────────────── */
async function writeAuditLog(actorUid, type, payload) {
  try {
    await admin.firestore().collection('admin_audit_log').add({
      actorUid,
      type,
      payload,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    // 감사 로그 실패는 본 작업을 막지는 않되, 로그는 남긴다
    logger.error('[audit-log] 기록 실패', e);
  }
}

/* ─────────────────────────────────────────────────────────────
   setAdminClaim — 다른 사용자에게 admin: true / false 토글
     - 호출자 본인이 admin 이어야만 동작 (requireAdmin)
     - 첫 admin 부여(부트스트랩)는 별도 스크립트로 1회 실행
       (scripts/bootstrap-admin.js 참조)
   요청 데이터: { uid?: string, email?: string, isAdmin: boolean }
   ────────────────────────────────────────────────────────────── */
exports.setAdminClaim = onCall(async (request) => {
  requireAdmin(request);

  const { uid, email, isAdmin } = request.data || {};
  if (!uid && !email) {
    throw new HttpsError('invalid-argument', 'uid 또는 email 중 하나는 필수입니다.');
  }
  if (typeof isAdmin !== 'boolean') {
    throw new HttpsError('invalid-argument', 'isAdmin 필드는 boolean 이어야 합니다.');
  }

  let targetUid = uid;
  if (!targetUid) {
    const u = await admin.auth().getUserByEmail(email);
    targetUid = u.uid;
  }

  // 자기 자신의 admin 권한은 회수 불가 (lockout 방지)
  if (targetUid === request.auth.uid && isAdmin === false) {
    throw new HttpsError('failed-precondition',
      '자기 자신의 admin 권한은 회수할 수 없습니다. 다른 admin을 통해 처리하세요.');
  }

  // 기존 customClaims 보존 + admin 토글 (tester 등 다른 claim은 유지)
  const userRecord = await admin.auth().getUser(targetUid);
  const newClaims = { ...(userRecord.customClaims || {}), admin: isAdmin };
  await admin.auth().setCustomUserClaims(targetUid, newClaims);

  await writeAuditLog(request.auth.uid, 'setAdminClaim', { targetUid, isAdmin });
  return { success: true, targetUid, claims: newClaims };
});

/* ─────────────────────────────────────────────────────────────
   setTesterClaim — 베타 테스터 토글 (사용량 제한 면제용)
   ────────────────────────────────────────────────────────────── */
exports.setTesterClaim = onCall(async (request) => {
  requireAdmin(request);

  const { uid, email, isTester } = request.data || {};
  if (!uid && !email) throw new HttpsError('invalid-argument', 'uid 또는 email 필수');
  if (typeof isTester !== 'boolean') throw new HttpsError('invalid-argument', 'isTester boolean 필수');

  let targetUid = uid;
  if (!targetUid) targetUid = (await admin.auth().getUserByEmail(email)).uid;

  const userRecord = await admin.auth().getUser(targetUid);
  const newClaims = { ...(userRecord.customClaims || {}), tester: isTester };
  await admin.auth().setCustomUserClaims(targetUid, newClaims);

  await writeAuditLog(request.auth.uid, 'setTesterClaim', { targetUid, isTester });
  return { success: true, targetUid, claims: newClaims };
});

/* ─────────────────────────────────────────────────────────────
   whoami — 클라이언트가 현재 권한 상태를 빠르게 디버깅할 때 사용
     - admin 아니어도 호출 가능 (자기 자신 정보만 반환)
   ────────────────────────────────────────────────────────────── */
exports.whoami = onCall(async (request) => {
  if (!request.auth) return { loggedIn: false };
  return {
    loggedIn: true,
    uid:     request.auth.uid,
    email:   request.auth.token.email || null,
    admin:   request.auth.token.admin === true,
    tester:  request.auth.token.tester === true,
    issuedAt: request.auth.token.iat,
  };
});

/* ─────────────────────────────────────────────────────────────
   adminExampleTemplate — 향후 admin-only 함수의 표준 템플릿
     예) listAllUsers, deleteAnyUserData, exportAuditLog 등을
     추가할 때 이 패턴(첫 줄: requireAdmin)을 그대로 따른다.
   ────────────────────────────────────────────────────────────── */
exports.adminExampleTemplate = onCall(async (request) => {
  requireAdmin(request);            // ← Layer ② 검증
  // ... 실제 admin 작업
  return { ok: true, note: '이 한 줄(requireAdmin)이 4중 레이어의 Layer ② 입니다.' };
});