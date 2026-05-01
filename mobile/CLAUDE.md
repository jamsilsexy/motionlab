# mobile/ — Claude Code 영구 규칙

이 파일은 mobile/ 안에서 작업하는 모든 Claude Code 세션이 자동으로 읽습니다.

## 프로젝트 정체성

- **이름**: FORM AI 모바일 앱 (PT 트레이너용 체형 분석)
- **목표**: iOS/Android 스토어 출시
- **현재 단계**: 베타 (form_ai_v17.html → React Native 마이그레이션 진행 중)
- **백엔드**: Firebase (변경 없음 — Auth / Firestore / Storage / Cloud Functions / App Check)

## 확정 스택 (절대 다른 라이브러리로 교체하지 말 것)

| 영역 | 선택 |
|---|---|
| 프레임워크 | Expo SDK 55 (managed) |
| RN 버전 | 0.83.6 |
| React | 19.2.0 |
| 라우팅 | Expo Router 7 (파일 기반, src/app/) |
| 언어 | TypeScript strict |
| 스타일 | NativeWind 4 (Tailwind 3.4.17) |
| 상태 (전역) | Zustand |
| 백엔드 | Firebase JS SDK v12+ (modular) |
| 카메라/포즈 | react-native-vision-camera 4.7.3 + react-native-mediapipe-posedetection 0.4.0 |
| 그리기 | @shopify/react-native-skia |
| 갤러리 | expo-image-picker (베타는 비디오 업로드 모드만) |
| 빌드 | EAS Build (Mac 없이 iOS/Android 동시) |

## 절대 하지 말 것

1. **WebView 도망 금지** — `react-native-webview`로 form_ai_v17.html 띄우는 짓 금지. Apple 4.2(b) 거부 사유.
2. **Firebase → Supabase 마이그레이션 금지** — P0-1~P0-4의 16개 commit + firestore.rules + Cloud Functions 다 살아있음.
3. **외부 라이브러리 추가 시 반드시 사용자 승인** — 위 표 외 라이브러리는 무단 npm install 금지.
4. **DOM/BOM API 금지** — `document`, `window`, `localStorage`, `alert()`, `confirm()` 등.
5. **HTML 태그 사용 금지** — `<div>`, `<span>`, `<button>` 등. RN 컴포넌트로 변환.
6. **모든 텍스트는 `<Text>` 안** — 어기면 빨간 화면.
7. **이미지에 `width`/`height` 없으면 안 보임** — 명시 필수.
8. **`SafeAreaView` 또는 `react-native-safe-area-context` 사용** — 노치/홈바 영역 보호.
9. **확실하지 않으면 추측하지 말고 사용자에게 질문** — 환각 방지.
10. **commit 메시지에 `--no-verify`, `--amend` 등 금지** — 사용자 명시 요청 시만.

## 개발 흐름 규칙

- **변환 한 화면 끝날 때마다 git commit** (체크포인트)
- **변경 후 `npx tsc --noEmit` 실행** — 에러 0 될 때까지 수정
- **큰 변경 전 마크다운 plan 먼저** — 사용자 OK 후 코드
- **새 의존성 추가 전에 `npm view <pkg> peerDependencies` 검증**
- **공식문서 fetch → 정확한 명령 → 실행 순서 — 짐작으로 명령 박지 말 것**

## 보안 원칙 (인젝션 §6.1 4개 위험 — 베타 출시 전 다 처리)

1. ✅ Firebase API Key 보호 — 웹은 App Check 박음. 모바일은 베타 출시 후 RNFirebase/Custom Provider로
2. ✅ analysisCount 클라이언트 조작 방지 — Cloud Functions `incrementUsage` (region: asia-northeast3)
3. ✅ 회원 사진 Storage 경로 보호 — storage.rules
4. 🟡 회원 동의 (consent_logs 5년 보관) — 웹 P0-4 step1~3 완료. 모바일에서도 동일 흐름 박아야

## 변환 우선순위 (Lean 전략)

1. 분석 핵심 lib (config / utils / engine 일부 / squat tracker / expert filter)
2. 화면 6개 (Login / MemberList / ConsentModal / VideoUpload / Analysis / Report)
3. EAS Build dev client + 실기기 검증
4. ⏸ V2로 미룸: sales script / member summary / PT plan / NASMEngine

## Cloud Functions 호출 region

`asia-northeast3` (서울). `getFunctions(app, 'asia-northeast3')` 형태.

## .env 처리

- `EXPO_PUBLIC_*` 변수는 build 시 클라이언트에 inline됨 — Firebase config (apiKey 포함) OK
- service account / admin SDK 키 등 진짜 secret은 `.env*.local`에만 (gitignore됨)

## Firebase 프로젝트 정보

- Project ID: `form-ai-5c3b6`
- Functions Region: `asia-northeast3`
- Web App ID: `1:862760911753:web:a22444ce46fe457cfc5758` (현재 사용 — 모바일 native app 등록은 EAS 단계에서)
