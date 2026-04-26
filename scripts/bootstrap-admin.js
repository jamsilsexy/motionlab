/* ════════════════════════════════════════════════════════════════
   FORM AI v17 — 부트스트랩 스크립트 (1회만 실행)
   ────────────────────────────────────────────────────────────────
   목적: 첫 admin 계정에 admin: true claim 부여
   사용법:
     1) Firebase Console → 프로젝트 설정 → 서비스 계정
        → "새 비공개 키 생성" → JSON 다운로드
     2) 이 스크립트와 같은 폴더에 'service-account.json' 으로 저장
     3) GYM_OWNER_EMAIL 환경변수에 사용자 이메일 입력 후 실행:
          GYM_OWNER_EMAIL="실제이메일@example.com" node scripts/bootstrap-admin.js
     4) 실행 직후 service-account.json 즉시 삭제 (절대 Git 커밋 X)
        → .gitignore 에도 'service-account.json' 추가 필수
   주의:
     - 이 스크립트는 단 1회만 사용한다. 이후 admin 추가는
       반드시 setAdminClaim Cloud Function으로 진행.
═══════════════════════════════════════════════════════════════════ */
'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const KEY_PATH         = path.join(__dirname, 'service-account.json');
const GYM_OWNER_EMAIL  = process.env.GYM_OWNER_EMAIL;

if (!GYM_OWNER_EMAIL) {
  console.error('[ERROR] GYM_OWNER_EMAIL 환경변수가 비어 있습니다.');
  console.error('예) GYM_OWNER_EMAIL="hawaiigym.ys@gmail.com" node scripts/bootstrap-admin.js');
  process.exit(1);
}
if (!fs.existsSync(KEY_PATH)) {
  console.error('[ERROR] service-account.json 을 찾을 수 없습니다:', KEY_PATH);
  console.error('Firebase Console → 프로젝트 설정 → 서비스 계정 에서 비공개 키를 생성하세요.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });

(async () => {
  try {
    const user = await admin.auth().getUserByEmail(GYM_OWNER_EMAIL);
    const existing = user.customClaims || {};
    const newClaims = { ...existing, admin: true };
    await admin.auth().setCustomUserClaims(user.uid, newClaims);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[OK] 부트스트랩 완료');
    console.log('  email :', GYM_OWNER_EMAIL);
    console.log('  uid   :', user.uid);
    console.log('  claims:', JSON.stringify(newClaims));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('다음 단계:');
    console.log('  1) 사용자에게 앱에서 "로그아웃 → 재로그인" 안내 (토큰 갱신용)');
    console.log('  2) 이후 admin 추가는 반드시 setAdminClaim Cloud Function 사용');
    console.log('  3) !!! service-account.json 즉시 삭제 !!!');
    process.exit(0);
  } catch (e) {
    console.error('[ERROR]', e.code || '', e.message);
    process.exit(1);
  }
})();