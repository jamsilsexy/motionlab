# mobile/ 마이그레이션 진행 체크리스트

form_ai_v17.html (~14,400줄, 16개 모듈) → Expo SDK 55 RN 앱.

전략: **Lean** — 베타 출시 우선. 풀 sales script / PT plan / NASMEngine은 V2.

## 인프라 (완료)

- [x] Expo SDK 55 + TS + Expo Router scaffolding (`mobile/`)
- [x] 핵심 라이브러리 설치 (mediapipe-posedetection 0.4.0, vision-camera 4.7.3, worklets-core 1.6.3, firebase 12+, AsyncStorage, Skia, image-picker, file-system, NativeWind, Zustand)
- [x] NativeWind 4 config (tailwind/babel/metro/global.css/types)
- [x] app.json plugins (mediapipe + vision-camera + image-picker + expo-build-properties)
- [x] assets/models/pose_landmarker_lite.task (5.6MB) 다운로드
- [x] Firebase modular SDK 배선 (`src/lib/firebase.ts`)
- [x] `.env` (EXPO_PUBLIC_FIREBASE_*)

## 분석 lib (`src/lib/analysis/`)

- [x] types.ts (Landmark / RiskLevel / Movement / SupplementMapEntry)
- [x] config.ts (AppConfig 풀버전 — 6 movements + SUPPLEMENT_MAP + SALES_SCRIPTS)
- [x] utils.ts (calcAngle / lmAngle / riskOf / devOf / scoreColor / uid / wait 등)
- [x] storage.ts (AsyncStorage wrapper — load / store / remove)
- [ ] state.ts (분석 흐름용 mutable singleton — AppState 일부)
- [ ] engine.ts (calcFrontAngles / calcSideAngles / buildSummary / extractVideoSignature / calcScore)
- [ ] tracker.ts (SquatTracker — rep 감지)
- [ ] filter.ts (ExpertFilter — critical 분류)
- [ ] index.ts (배럴 export)

## 화면 (`src/app/`)

- [ ] Login (Firebase Auth — 소셜 로그인)
- [ ] MemberList (트레이너의 회원 목록)
- [ ] ConsentModal (서명 + 3개 체크박스 → consent_logs 저장)
- [ ] VideoUpload (expo-image-picker로 갤러리 선택)
- [ ] Analysis (비디오 → 프레임 → MediaPipe → 결과)
- [ ] Report (점수 + 핵심 이슈 3개 — Lean)

## 빌드 / 검증

- [ ] EAS init + eas.json
- [ ] EAS Build dev client (iOS + Android)
- [ ] 실기기 검증 (분석 정확도 + 권한)
- [ ] App Privacy 라벨 (체형 사진 = 민감 데이터)
- [ ] App Store Connect / Play Console 업로드

## V2로 미룸 (베타 출시 후)

- [ ] sales script (5단계 — buildSalesScriptV5)
- [ ] member summary (회원용 1페이지 — buildMemberSummary)
- [ ] PT plan (회차 산정 — calcPtPlan)
- [ ] NASMEngine (패턴 분류 + 보상 체인)
- [ ] 트레이너 3단 대시보드 (인젝션 §6.3 #6)
- [ ] 운동 DB 카테고리당 60~80개 확장 (현재 ~15-20개)
- [ ] 모바일 App Check provider (RNFirebase 또는 Custom Provider)
- [ ] PDF 리포트 (`expo-print` + `react-native-view-shot`)
- [ ] 정적 자세 분석 (정면/측면/후면 기립 사진)
- [ ] ROM 가동범위 검사
- [ ] 재촬영 요구 로직 (유효 프레임 30개 미만 시)
