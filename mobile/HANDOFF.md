# 다음 세션 인계 (2026-05-13 작성)

새 채팅 시작할 때 **아래 한 덩어리를 그대로 복붙**해서 Claude한테 보내세요.

---

## 📋 인계 프롬프트 (복붙용)

```
MOTION LAB 모바일 앱 출시 작업 이어서 진행. 자율 모드. 큰 결정만 짚고 진행.

## 한 줄 상태
코드 100% + pre-release QC (Critical 10 + High 13) 완료, EAS production 빌드 큐
진행 중, Play Console 본인 인증 거부됨 → 사용자가 현대카드 명세서 발급 시도 중.

## 즉시 확인할 3가지
1. EAS 빌드 결과: `cd "C:/Users/Keith/Downloads/form ai/mobile" && npx eas-cli@latest
   build:list --limit 2 --json | grep -E "id|status|appBuildVersion|applicationArchiveUrl"`
   - 직전 트리거 build ID: `e2842cee-f7c9-40f0-a2c7-77d7995a8c9a` (versionCode 3)
   - FINISHED 됐으면 AAB URL 노출. 아직 IN_PROGRESS면 큐 대기.
2. GitHub Pages 약관 URL 동작 (curl로 헤더 200 확인):
   - https://jamsilsexy.github.io/motionlab/privacy-policy/
   - https://jamsilsexy.github.io/motionlab/terms-of-service/
3. 사용자에게 물어볼 것:
   - Play Console 본인 인증 통과됐어요? (현대카드 명세서 업로드 결과)
   - 앱 아이콘 1024×1024 PNG 확정됐나요? (ChatGPT 결과물)
   - 스크린샷 4-8장 캡쳐 완료?

## 확정된 출시 정보 (못 바꿈)
- 앱 이름: MOTION LAB / 모션랩
- 패키지명: com.hawaiigym.motionlab
- Expo slug: mobile / 계정: jamsilsexy@gmail.com (EXPO_TOKEN 인증)
- 사업자: 하와이짐 / 220-09-36987 / 대표 이정모 / hawaiigym.ys@gmail.com
- Play Console 개발자 표시명: 이정모 aka 잠실섹시 (개인 계정, $25 결제 완료)
- 카테고리: Health & Fitness / 12+ / 한국어/한국만 / Android 먼저 (iOS는 베타 후)
- 약관 호스팅: GitHub Pages (jamsilsexy/motionlab repo, docs/ 폴더, Actions workflow 사용)
- 현재 commit: c48a316 (main)

## 룰 (절대 지킬 것)
1. `npx expo start` 같이 dev Metro 새로 띄우지 마세요. 사용자가 띄운 것만 사용.
   메모리: ~/.claude/projects/.../memory/feedback_dev_server.md
2. EAS 빌드 트리거는 사전 승인 받은 항목 (출시 작업이라 OK)
3. 추가 기능 작업 절대 금지 (PDF/ROM/재촬영 로직 등). 출시 흐름만.
4. 자율 모드 — 매 단계 GO 묻지 말고 진행. 큰 결정만 짚기.

## 환경
- Windows / PowerShell / Node v24 (Metro 호환 문제 가능, 띄울 일 없음)
- Expo SDK 55 / RN 0.83.6 / TS strict / NativeWind
- Firebase: form-ai-5c3b6 / asia-northeast3
- 폰: Android Samsung (dev client APK 설치됨, com.jamsilsexy.formai 옛 패키지)

## Play Console 다음 흐름 (본인 인증 통과 후)
1. 좌측 "모든 앱" → "앱 만들기" — 이름 MOTION LAB, 한국어, 무료, 선언사항 4개 ✅
2. 앱 콘텐츠:
   - 개인정보처리방침 URL: https://jamsilsexy.github.io/motionlab/privacy-policy/
   - 광고 없음 / 콘텐츠 등급 설문 (대부분 "아니요" — 폭력/성/도박 0)
   - 타겟 사용자: 만 18세 이상 (트레이너 도구)
   - 데이터 보안: 수집 항목 — 이메일, 회원 이름/체형정보(이미지/영상),
     동의 기록. 모두 암호화 전송, 사용자 삭제 가능. Firebase asia-northeast3
3. 스토어 등록정보 — 아이콘 / 피처 그래픽 1024x500 / 스크린샷 4-8장 / 짧은설명 /
   긴설명
4. 테스트 → 내부 테스트 트랙 → AAB 업로드 → 테스터 이메일 5-10명 등록 → 게시

## Claude가 즉시 도울 수 있는 것 (사용자가 요청 시)
- Play Store 짧은 설명 (80자) + 긴 설명 (4000자) 초안
- 데이터 보안 양식 답안 정리
- 콘텐츠 등급 설문 답안 정리
- 아이콘 PNG 받으면 mobile/assets/images/icon.png 자리에 저장 + EAS 재빌드
- 새 EAS 빌드 트리거 (큐 → AAB)

## 추가 컨텍스트 (필요 시 참고)
- mobile/CLAUDE.md — 영구 룰 (WebView 금지, Firebase JS SDK 유지, 권한 텍스트 등)
- mobile/RELEASE.md — 22개 결정사항 + 출시 순서
- 영구 메모리 ~/.claude/projects/C--Users-Keith-Downloads-form-ai/memory/
- 최근 commits:
  c48a316 chore: .claude worktree gitignore
  abda81d QC: pre-release 종합 fix (Critical 10 + High 13)
  984bd0d B-15: FORM AI → MOTION LAB 표기 마무리
  629a283 B-12: 변화 체크 탭

먼저 EAS 빌드 결과 확인하고, Play Console 본인 인증 통과 여부 물어보고, 그에 따라
다음 단계 안내해주세요.
```

---

## 위 프롬프트를 보낼 때 추가 안내

세션 처음에 사용자가 직접 알려주면 좋은 정보:
- 본인 인증 결과 (통과 / 거부 / 아직 대기)
- 아이콘 PNG 준비 여부
- 스크린샷 캡쳐 진행 상태
- 현대카드 명세서 발급 결과

---

## 새 세션 시작 시 Claude가 가장 먼저 할 일

1. `npx eas-cli build:list --limit 2 --json` 실행해서 빌드 결과 확인
2. 약관 URL 동작 검증 (curl)
3. 위 정보로 한 줄 상태 사용자에게 알리고 다음 액션 제안
4. 사용자 본인 인증 결과 확인하고 그에 맞춰 진행

---

## 이번 세션에서 새로 학습된 영구 룰 (메모리에 저장됨)

`~/.claude/projects/C--Users-Keith-Downloads-form-ai/memory/` 폴더:
- `MEMORY.md` — 인덱스
- `feedback_autonomous_mode.md` — 자율 진행 모드 (큰 결정만 짚기)
- `feedback_dev_server.md` — Metro 새로 띄우지 말 것 (충돌 → 폰에 코드 반영 안 됨)
- `project_release.md` — 출시 진행 상태 (2026-05-13 갱신)
