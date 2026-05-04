# MOTION LAB 출시 인계 노트

> 다음 세션에서 출시 작업 이어가는 사람용. 한 페이지로 끝.

---

## 현재 상태 (2026-05-05 기준)

### ✅ 완료
- **앱 정체성**: app.json `name: MOTION LAB`, package `com.hawaiigym.motionlab`, scheme `motionlab`, version 1.0.0
- **권한 텍스트**: 카메라/갤러리 한국어 안내 (vision-camera + image-picker plugin 옵션)
- **adaptive icon 배경**: indigo `#4f46e5`
- **개인정보처리방침**: `mobile/docs/privacy-policy.md` (5년 보관 / 의료기기 면책 / 사업자 정보 포함)
- **이용약관**: `mobile/docs/terms-of-service.md` (분석 한계 면책 / 트레이너 의무)
- **in-app footer**: 회원 목록 화면(`src/app/index.tsx`) 하단에 "피드백 보내기 · 개인정보처리방침 · 이용약관 · v1.0.0" 추가
  - 피드백: `mailto:hawaiigym.ys@gmail.com` (subject + 앱 버전/사용자 자동 포함)
  - 약관 링크: `github.com/jamsilsexy/motionlab/blob/main/docs/...` (URL은 GitHub repo 만든 후 정확한 경로로 수정 필요)
- **EAS production 빌드 트리거됨** (Build ID: `ade8c1e2-45b8-474d-b426-b685227c3775`)
  - 진행 URL: https://expo.dev/accounts/jamsilsexy/projects/mobile/builds/ade8c1e2-45b8-474d-b426-b685227c3775
  - versionCode 1 → 2 자동 증가
  - keystore 자동 생성됨 (Expo 클라우드)
  - 결과물: AAB (Play Store 업로드용)

### 사업자 정보 (약관/Play Console 등록용)
- 사업자명: 하와이짐
- 사업자등록번호: 220-09-36987
- 대표자: 이정모 (aka 잠실섹시)
- 이메일: hawaiigym.ys@gmail.com
- Expo 계정: jamsilsexy@gmail.com (EXPO_TOKEN으로 인증됨)

---

## 다음 세션에서 사용자가 직접 해야 할 것

### A. EAS 빌드 결과 확인 (Claude도 가능)
1. https://expo.dev/accounts/jamsilsexy/projects/mobile/builds 에서 빌드 상태 확인
2. **성공 시**: AAB 다운로드 링크 받음 → Play Console 업로드
3. **실패 시**: 로그 확인 → 빌드 에러 디버그 (보통 native 의존성 충돌 / asset 경로 문제 / Android SDK 호환성)

### B. GitHub repo 만들기 + Pages 활성화 (사용자 직접)
약관 링크가 동작하려면 GitHub repo가 필요합니다.

```bash
# 1. GitHub에 motionlab repo 생성 (public)
gh repo create jamsilsexy/motionlab --public --source=. --remote=origin --push
# 또는 GitHub 웹에서 만들고 git remote add

# 2. push
git push -u origin main

# 3. Settings → Pages → Source: "Deploy from a branch" → main / docs 선택
# 4. 약관 URL이 https://jamsilsexy.github.io/motionlab/privacy-policy 형태로 동작
```

만약 GitHub repo 이름이 motionlab가 아니라면 `mobile/src/app/index.tsx` 의 `openPrivacy` / `openTerms` URL 수정 필요.

### C. Google Play Console 개발자 계정 ($25 1회)
1. https://play.google.com/console 가입
2. 본인 인증 (며칠 소요)
3. 사업자 등록 정보 입력 (220-09-36987)
4. 개발자 표시명: "이정모 aka 잠실섹시" (또는 "하와이짐")
5. 결제 프로필 (수익화 안 해도 등록 필요)

### D. Play Store 등록 자료 준비 (사용자 직접)
- **앱 아이콘 512×512 PNG** (둥근 모서리 자동)
- **피처 그래픽 1024×500 PNG** (스토어 상단 배너)
- **스크린샷 최소 4장 / 최대 8장** (폰 화면 1080×1920 권장):
  1. 회원 목록
  2. 정적 자세 분석 결과
  3. OHS 영상 분석 진행 화면
  4. 회원 요약 리포트 (skeleton overlay 사진 포함)
  5. 트레이너 분석 (NASM 패턴 + 보상 체인)
  6. 운동 처방 카드
  7. 변화 체크 (이전 분석 비교)
  8. 라이브 카메라 분석
- **짧은 설명 (80자 이내)**:
  > AI 33-landmark 자세 분석으로 PT 회원 체형의 약점을 한눈에. 트레이너 전용 도구.
- **긴 설명 (4000자 이내)**: 기능 / 특징 / 면책사항
- **개인정보처리방침 URL**: https://jamsilsexy.github.io/motionlab/privacy-policy
- **카테고리**: Health & Fitness
- **콘텐츠 등급**: 12+ (자가 평가 설문)
- **타겟 국가**: 한국

### E. AAB 업로드
1. Play Console → 앱 만들기 → "MOTION LAB"
2. 내부 테스트 트랙 생성
3. AAB 업로드 (EAS 빌드 결과)
4. 테스터 이메일 5-10명 등록 (베타 트레이너)
5. 게시 → 승인 후 테스터에게 초대 링크 발송

---

## Claude가 다음 세션에 추가로 할 수 있는 것

### 작은 것 (각 30분~1시간)
- [ ] 약관 URL을 사용자가 만든 실제 GitHub repo 경로로 수정
- [ ] 회원 동의 모바일 흐름 마무리 (consent_logs Firestore 저장 — 인계메모 §6.1 P0-4)
- [ ] Splash 색을 `#208AEF` → `#4f46e5` 로 통일 (현재 indigo 통일 중인데 splash만 다른 파랑)
- [ ] 앱 임시 아이콘 생성 (현재 expo 기본 — indigo + "ML" 글자 생성 가능)
- [ ] Sentry/Crashlytics 통합

### 큰 것
- [ ] expo-updates 설치 + OTA 설정 (베타 빠른 패치용)
- [ ] iOS 빌드 (Apple 개발자 계정 필요)
- [ ] 분석 횟수 제한 (Cloud Functions incrementUsage 모바일 연결)

---

## 잊지 말기

- **Metro 새로 띄우지 말 것** — 사용자가 띄운 8081만 사용 (memory 규칙)
- **EAS 빌드는 사전 승인됨** — 매 빌드마다 다시 묻지 않음
- **package name 한 번 정하면 못 바꿈** — `com.hawaiigym.motionlab` 확정
- **Expo project slug는 `mobile`** (변경하면 EAS 연결 끊김 — 그대로 유지)
- **GitHub repo URL** 만든 후 `index.tsx`의 약관 링크 수정 필수
