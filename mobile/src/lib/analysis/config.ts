import type { Movement, SupplementMapEntry } from './types';

/* ═══════════════════════════════════════════════════════════════
 * OHS 이학검사 — 학술 기반 분석 기준 References
 *
 * [R1] AAOS Goniometry — 정상 관절 가동범위 (Hip flexion 0-120°, Knee flexion 0-135°, Shoulder flexion 0-180°)
 *      → fadavispt.mhmedical.com / cdn-links.lww.com permalink/prsgo/8/6/2020 supplementary
 *
 * [R2] Hoch et al. (2014) "Altered Knee and Ankle Kinematics During Squatting in Those With
 *      Limited Weight-Bearing-Lunge Ankle-Dorsiflexion ROM", J Athl Train 49(6) — PMC4264643
 *      → Weight-Bearing Lunge (WBL) ≥ 44° = 정상, ≤ 44° = 제한
 *      → OHS 시 정상 그룹 정강이 기울기 displacement 평균 32°, 제한 그룹 24°
 *      → 우리 ankleDorsi(정강이 기울기 측정) min: 25°는 이 "limited" 임계와 align
 *
 * [R3] McGill & Marshall (2012) — 시각적 "neutral spine"으로 보여도 실제 lumbar flexion 26°까지 발생
 *      → 우리 spine min: 148°(즉 32° 굽음 = warning) 임계는 이 연구 기반 합리적 보수치
 *
 * [R4] Brookbush Institute / Sahrmann Movement Impairment Syndromes —
 *      Trunk forward lean: spine-shin parallel 원칙. 정량 임계 합의 부족, 임상 35° 사용
 *
 * [R5] CVA (Craniovertebral Angle) — Salahzadeh et al. (2014) 외 다수
 *      → CVA = Tragus(귀) → C7 라인과 수평선의 각도
 *      → CVA < 50° = Forward Head Posture (FHP), 50-54° = 경계, > 54° = 정상
 *      → 정량 합의: 다수 논문에서 50° cut-off
 *      → 우리 fhpAngle = (90 - CVA) deviation: 0° 이상=거북목 시작, 40° 이상=심한 FHP
 *
 * [R6] Glenohumeral overhead mobility — Hassan et al. (2024), PMC11393552
 *      → GH flexion 평균 93° (필요), < 80°는 overhead 동작 거의 불가
 *      → 우리 leftShoulder/rightShoulder min: 150°(elbow-shoulder-hip 각도)는 GH+thoracic 합산
 *
 * [R7] Lateral Pelvic Shift — 정량 임계 합의 부족
 *      → 달리기 중 frontal-plane pelvic drop: 비우세 8.71°, 우세 5.79° (참고치)
 *      → OHS 평가는 시각적 (left/right shift). 우리는 hipShift min:0 max:9 (어깨너비 정규화 후 각도 스케일)
 *
 * 모든 ranges는 임상 평가 도구이며 의료 진단을 대체하지 않음.
 * ═══════════════════════════════════════════════════════════════ */

export const AppConfig = {
  PRO_GATING: false,

  REALTIME: {
    MIN_POSE_INTERVAL_MS: 150,
    MIN_VISIBILITY: 0.5,
    MIN_POSE_CONFIDENCE: 0.55,
    RAF_SKIP_FRAMES: 3,
  },

  CAPTURE: {
    MIN_INTERVAL_MS: 800,
    MAX_COUNT: 15,
    MAX_PER_ISSUE: 5,
    MAX_PER_ISSUE_PER_REP: 1,
    BOTTOM_WINDOW_MS: 300,
  },

  EXPERT: {
    CRITICAL_MIN_CONDITIONS: 2,
    MAX_CRITICAL_OUTPUT: 4,
    CRITICAL_DEVIATION_DEG: 18,
    JOINT_DEVIATION_DEG: {
      leftKnee: 18,
      rightKnee: 18,
      leftHip: 18,
      rightHip: 18,
      leftShoulder: 8,
      rightShoulder: 8,
      leftAnkle: 8,
      rightAnkle: 8,
      spine: 10,
      hipShift: 10,
      trunkLean: 10,
      ankleDorsi: 8,
      thoracicFlex: 12,
      footOutward: 12,
    } as Record<string, number>,
    RECURRENCE_MIN_COUNT: 3,
    RECURRENCE_MIN_RATE: 0.6,
    DISPLAY_MAX_DEV: {
      spine: 32,
      knee: 25,
      hip: 30,
      ankle: 20,
      shoulder: 25,
      hipShift: 18,
      default: 30,
    } as Record<string, number>,
  },

  SQUAT: {
    // descending 진입 임계 — 무릎이 이 각도보다 작아지면 1 rep 시작.
    //   110°(원래) = 깊은 스쿼트 필요. 가동성 제한 회원이나 영상 sparse frame에서 놓침.
    //   125°로 완화: AAOS hip flexion 정상 0-120°와 align, 살짝 굽혀도 인식.
    KNEE_DOWN_ANGLE: 125,
    // ascending → idle 임계 (완전히 펴진 상태). 155° 너무 엄격, 145°로 완화.
    KNEE_UP_ANGLE: 145,
    // descending → ascending 진입: minKneeAngle에서 N° 회복 시. 12° → 8° 완화.
    KNEE_RECOVERY_DELTA: 8,
    // 1 rep 최소 지속시간. 영상 sparse frame에서 놓치지 않게 1000ms → 700ms.
    MIN_REP_DURATION_MS: 700,
    MIN_REPS_FOR_ANALYSIS: 3,
    TARGET_REPS: 5,
  },

  LM: {
    NOSE: 0,
    L_SHOULDER: 11,
    R_SHOULDER: 12,
    L_ELBOW: 13,
    R_ELBOW: 14,
    L_WRIST: 15,
    R_WRIST: 16,
    L_HIP: 23,
    R_HIP: 24,
    L_KNEE: 25,
    R_KNEE: 26,
    L_ANKLE: 27,
    R_ANKLE: 28,
    L_HEEL: 29,
    R_HEEL: 30,
    L_FOOT: 31,
    R_FOOT: 32,
  },

  SKEL_CONN: [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [27, 29], [27, 31],
    [24, 26], [26, 28], [28, 30], [28, 32],
  ] as readonly (readonly [number, number])[],

  SKEL: {
    DOT_OK: '#22c55e',
    DOT_WARN: '#f59e0b',
    DOT_CRIT: '#ef4444',
    LINE_OK: 'rgba(108,99,255,.75)',
    LINE_WARN: 'rgba(245,158,11,.75)',
    LINE_CRIT: 'rgba(239,68,68,.75)',
    DOT_R: 5,
    LINE_W: 2.5,
  },

  MOVEMENTS: [
    {
      id: 'static_pose',
      icon: '🧍',
      label: '정적 기립 자세',
      desc: '거북목·어깨 불균형·골반 기울기·라운드숄더',
      isMain: true,
      isStatic: true,
      guide: {
        angle: '정면 촬영 (카메라가 정면 정중앙)',
        frame: '발끝~머리 전신 포함 (세로 촬영)',
        reps: '차렷 자세로 2초 정지',
        height: '카메라 높이: 배꼽~가슴 높이',
        extra: '발은 어깨 너비, 시선은 정면, 팔은 자연스럽게',
      },
      checks: [
        { ico: '🦒', name: '거북목(FHP)', sub: '귀가 어깨 앞으로 나와있는지' },
        { ico: '⚖️', name: '어깨 높이 불균형', sub: '좌우 어깨 높이 차이가 있는지' },
        { ico: '🔄', name: '골반 기울기', sub: '좌우 골반 높이 차이 (Pelvic Tilt)' },
        { ico: '🔵', name: '라운드숄더', sub: '어깨가 앞으로 말려있는지' },
      ],
      ranges: {
        // 좌우 어깨 connection line이 수평선과 이루는 각도. ±5° 초과 = 비대칭
        // [R7] 정량 임계 학술 합의 부족, 임상 ±3° warning / ±5° danger 통용
        shoulderTilt: { min: -5, max: 5, name: '어깨 기울기' },
        // 좌우 ASIS(골반 전면 상단)/iliac crest 라인이 수평선과 이루는 각도. ±5° 초과 = 비대칭
        // [R7] 임상 ±3° warning / ±5° danger
        pelvisTilt: { min: -5, max: 5, name: '골반 기울기' },
        // [R5] FHP deviation = (90 - CVA). CVA = Tragus→C7 vs horizontal.
        //   - 0~15° = 정상 (CVA 75-90°)
        //   - 15~40° = 경계~FHP (CVA 50-75°)
        //   - 40°+ = 심한 FHP (CVA < 50°, 학술 cut-off)
        // 측면 사진 또는 정면+z좌표(MediaPipe Pose) 활용 측정
        fhpAngle: { min: 0, max: 15, name: '거북목 (CVA deviation)' },
        // 좌우 어깨가 hip-shoulder line 대비 sagittal plane으로 얼마나 전방 이동했는지의 각도.
        // 160-180° = 정상 (어깨가 hip 위 정렬), < 160° = 라운드숄더 보상 시작
        // 측면 사진에서 ear-shoulder-hip 각도로도 측정 가능
        roundShoulder: { min: 160, max: 180, name: '라운드숄더' },
      },
    },
    {
      id: 'ohs_front',
      icon: '🏋️',
      label: 'OHS 정면',
      desc: '무릎 정렬·골반 안정성·좌우 비대칭',
      isMain: true,
      pairId: 'ohs_side',
      guide: {
        angle: '정면 촬영 (카메라가 정면 정중앙)',
        frame: '발끝~팔 끝 전신 포함 (세로 촬영)',
        reps: '5회 반복 (내려가고 올라오기)',
        height: '카메라 높이: 허리~가슴 높이',
        extra: '맨손 또는 막대기 사용, 배경은 단색',
      },
      checks: [
        { ico: '🦵', name: '무릎 Valgus / Varus', sub: '하강 시 무릎이 안으로 무너지거나 바깥으로 벌어지는지' },
        { ico: '⚖️', name: '골반 좌우 시프팅', sub: '하강 시 골반이 한쪽으로 이동하는지 (동적 골반 안정성)' },
        { ico: '👣', name: '발 외회전', sub: '발끝이 과도하게 바깥으로 열리는지 (보상 패턴 가능)' },
        { ico: '🙌', name: '어깨 비대칭', sub: '한쪽 어깨가 더 낮거나 앞으로 나오는지' },
      ],
      ranges: {
        // [R1] AAOS knee flexion 0-135°. OHS bottom 시 스쿼트 깊이 평가
        //   - 130° 초과 = hyperextension 보상 / 55° 미만 = 깊이 부족 또는 스쿼트 미수행
        leftKnee: { min: 55, max: 130, name: '왼쪽 무릎' },
        rightKnee: { min: 55, max: 130, name: '오른쪽 무릎' },
        // [R1] AAOS hip flexion 0-120°. OHS bottom 시 hip 굴곡 평가
        leftHip: { min: 50, max: 120, name: '왼쪽 고관절' },
        rightHip: { min: 50, max: 120, name: '오른쪽 고관절' },
        // [R6] elbow-shoulder-hip 각도 (GH flexion + scapular + thoracic 합산)
        //   150° = 팔이 거의 수직 정렬 / 180° = 완전 정렬
        //   GH flexion 단독 80° 미만이면 overhead 거의 불가 → 합산 150°가 임상 한계
        leftShoulder: { min: 150, max: 180, name: '왼쪽 어깨' },
        rightShoulder: { min: 150, max: 180, name: '오른쪽 어깨' },
        // [R3] 어깨중-고관절중-무릎중 각도. 180°=완벽 일직선, 148°=32° 척추 굽음
        //   McGill 26° "보이는 neutral도 실제 굴곡" 기준 약간 보수적
        spine: { min: 148, max: 180, name: '척추 정렬' },
        // [R7] 어깨너비 정규화 후 각도 스케일. 9 초과 = 명확한 lateral shift 보상
        hipShift: { min: 0, max: 9, name: '골반 좌우 이동' },
      },
    },
    {
      id: 'ohs_side',
      icon: '🏋️',
      label: 'OHS 측면',
      desc: '척추·발목 가동성·체간 기울기·힙 뎁스',
      isMain: true,
      pairId: 'ohs_front',
      guide: {
        angle: '측면 촬영 (카메라가 90도 옆)',
        frame: '발끝~팔 끝 전신 포함 (세로 촬영)',
        reps: '5회 반복',
        height: '카메라 높이: 허리~가슴 높이',
        extra: '왼쪽 또는 오른쪽 중 더 약한 쪽 기준',
      },
      checks: [
        { ico: '🦴', name: 'Lumbar Flexion', sub: '허리가 굽는지 — OHS에서 가장 위험한 패턴' },
        { ico: '📐', name: '체간 전방 기울기', sub: '상체가 과도하게 앞으로 숙여지는지 (힙/발목 제한 보상)' },
        { ico: '🦶', name: '발목 Dorsiflexion 제한', sub: '발뒤꿈치가 들리거나 하강 각도가 제한되는지' },
        { ico: '🍑', name: '힙 Depth', sub: '고관절이 무릎 라인 이하로 내려가는지' },
      ],
      ranges: {
        // [R1] AAOS knee flexion 0-135°. OHS bottom 깊이 평가
        leftKnee: { min: 55, max: 130, name: '왼쪽 무릎' },
        rightKnee: { min: 55, max: 130, name: '오른쪽 무릎' },
        // [R1] AAOS hip flexion 0-120°
        leftHip: { min: 50, max: 120, name: '왼쪽 고관절' },
        rightHip: { min: 50, max: 120, name: '오른쪽 고관절' },
        // 측면 OHS 시 knee-ankle-heel 각도 (발목 plantar/dorsi flexion 종합)
        leftAnkle: { min: 60, max: 105, name: '왼쪽 발목' },
        rightAnkle: { min: 60, max: 105, name: '오른쪽 발목' },
        // [R3] 어깨중-고관절중-무릎중 각도 (lumbar flexion 보상 평가)
        spine: { min: 148, max: 180, name: '척추 정렬' },
        // [R2] 정강이 기울기 (knee 위치가 ankle 대비 얼마나 전방). atan2(|knee.x-ankle.x|, |knee.y-ankle.y|)
        //   - Hoch 2014: 정상 그룹 OHS 시 평균 32° displacement, 제한 그룹 24°
        //   - 25° 이하 = Weight-Bearing Lunge 44° 미만 그룹과 동일 임계 (제한)
        //   - 우리 min: 25° = 학술 limited 임계와 align
        ankleDorsi: { min: 25, max: 90, name: '발목 배굴' },
        // [R4] 체간 전방 기울기 (어깨중-고관절중 라인 vs 수직).
        //   spine-shin parallel 원칙. 35° 초과 = Excessive Forward Lean 보상 (정량 합의 부족, 임상)
        thoracicFlex: { min: 0, max: 35, name: '체간 기울기' },
      },
    },
    {
      id: 'hip_hinge',
      icon: '⬇️',
      label: '힙 힌지',
      desc: '후방 체인·척추-골반 협응·요추 안정성',
      isMain: false,
      supplement: true,
      guide: {
        angle: '측면 촬영 (카메라가 90도 옆)',
        frame: '발끝~머리 전신, 바(막대기) 등에 접촉 확인',
        reps: '5회 천천히 (힙 뒤로 밀기 강조)',
        height: '카메라 높이: 허리 높이',
        extra: '맨손 또는 막대기를 등에 대고 촬영 권장',
      },
      checks: [
        { ico: '🦴', name: '요추 굴곡 개입', sub: '허리가 굽으며 보상하는지 — 가장 우선 확인' },
        { ico: '🍑', name: '고관절 전략 우세', sub: '엉덩이가 먼저 뒤로 밀리는지 (올바른 패턴)' },
        { ico: '💪', name: '햄스트링-둔근 협응', sub: '하강 시 허벅지 뒤쪽의 긴장이 느껴지는지' },
        { ico: '📏', name: '척추 중립 유지', sub: '목~미추까지 일직선이 유지되는지' },
      ],
      ranges: {
        leftHip: { min: 40, max: 170, name: '왼쪽 고관절' },
        rightHip: { min: 40, max: 170, name: '오른쪽 고관절' },
        leftKnee: { min: 150, max: 175, name: '왼쪽 무릎' },
        rightKnee: { min: 150, max: 175, name: '오른쪽 무릎' },
        spine: { min: 152, max: 180, name: '척추 정렬' },
      },
    },
    {
      id: 'lunge',
      icon: '🦵',
      label: '런지',
      desc: '좌우 비대칭 교차검증·단측 골반 안정성',
      isMain: false,
      supplement: true,
      guide: {
        angle: '정면 촬영 권장 (측면도 가능)',
        frame: '발끝~머리 전신',
        reps: '좌우 각 3회',
        height: '카메라 높이: 허리 높이',
        extra: '앞 다리 무릎이 90도가 되는 깊이까지',
      },
      checks: [
        { ico: '🦵', name: '앞 무릎 추적', sub: '발 2번째 발가락 방향으로 무릎이 이동하는지' },
        { ico: '⚖️', name: '골반 수평 유지', sub: '내려갈 때 골반이 기울거나 회전하는지' },
        { ico: '🦴', name: '상체 직립', sub: '몸통이 앞으로 기울지 않는지' },
        { ico: '🔄', name: '좌우 대칭', sub: '왼쪽과 오른쪽 수행의 차이가 있는지' },
      ],
      ranges: {
        leftKnee: { min: 78, max: 102, name: '앞 무릎 (좌)' },
        rightKnee: { min: 78, max: 102, name: '앞 무릎 (우)' },
        leftHip: { min: 148, max: 180, name: '상체 각도 (좌)' },
        rightHip: { min: 148, max: 180, name: '상체 각도 (우)' },
        spine: { min: 155, max: 180, name: '척추 정렬' },
      },
    },
    {
      id: 'wall_angel',
      icon: '🧍',
      label: 'Wall Angel',
      desc: '흉추 가동성·어깨 굴곡·체간 직립',
      isMain: false,
      supplement: true,
      guide: {
        angle: '측면 촬영 (카메라가 90도 옆)',
        frame: '발끝~손끝 전신 포함',
        reps: '5회 천천히 (팔을 올리고 내리기)',
        height: '카메라 높이: 허리~가슴 높이',
        extra: '벽에 등·엉덩이·뒤통수를 붙이고 시작. 벽 없으면 바닥에 누워서도 가능',
      },
      checks: [
        { ico: '🧱', name: '등-벽 접촉 유지', sub: '팔을 올릴 때 등이 벽에서 떨어지는지 (흉추 굴곡 보상)' },
        { ico: '🙌', name: '어깨 완전 굴곡 여부', sub: '팔이 머리 위까지 완전히 올라가는지' },
        { ico: '🦴', name: '요추 과신전 보상', sub: '등을 붙이려고 허리가 과도하게 꺾이는지' },
        { ico: '📐', name: '체간 직립도', sub: '수행 중 상체가 앞으로 기울어지지 않는지' },
      ],
      ranges: {
        leftShoulder: { min: 155, max: 180, name: '왼쪽 어깨 굴곡' },
        rightShoulder: { min: 155, max: 180, name: '오른쪽 어깨 굴곡' },
        spine: { min: 155, max: 180, name: '체간 직립' },
        leftElbow: { min: 80, max: 100, name: '왼쪽 팔꿈치' },
        rightElbow: { min: 80, max: 100, name: '오른쪽 팔꿈치' },
      },
    },
  ] satisfies Movement[],

  SUPPLEMENT_MAP: [
    {
      priority: 1,
      triggerJoints: ['spine'],
      supplementId: 'hip_hinge',
      reason: '허리 패턴이 감지됐습니다. 힙 힌지로 후방 체인을 확인해볼게요.',
    },
    {
      priority: 2,
      triggerJoints: ['leftKnee', 'rightKnee', 'hipShift'],
      supplementId: 'lunge',
      reason: '무릎 또는 골반 안정성 패턴이 감지됐습니다. 런지로 단측 부하를 확인해볼게요.',
    },
    {
      priority: 3,
      triggerJoints: ['leftHip', 'rightHip'],
      supplementId: 'hip_hinge',
      reason: '고관절 가동성 제한이 감지됐습니다. 힙 힌지로 후방 체인을 확인해볼게요.',
    },
    {
      priority: 4,
      triggerJoints: ['leftShoulder', 'rightShoulder'],
      supplementId: 'wall_angel',
      reason: '어깨 정렬 패턴이 감지됐습니다. Wall Angel로 흉추 가동성을 확인해볼게요.',
    },
  ] satisfies SupplementMapEntry[],

  SALES_SCRIPTS: {
    opening: {
      high: '전반적인 움직임 패턴은 양호한 편입니다. 몇 가지 예방적 관리가 있으면 더 좋은 퍼포먼스를 낼 수 있을 것 같아요.',
      medium: '오늘 분석에서 몇 가지 중요한 패턴이 발견됐습니다. 지금 잡아두면 나중에 훨씬 편하게 운동하실 수 있어요.',
      low: '분석 결과를 보면 현재 상태에서 그냥 운동 강도를 올리면 부상 위험이 높아질 수 있습니다. 먼저 기반을 잡는 것이 중요해요.',
    },
    issues: {
      spine: '허리 쪽에서 중립이 무너지는 구간이 반복적으로 보입니다. 이 패턴이 지속되면 디스크나 요통으로 이어질 가능성이 있어요.',
      leftKnee: '왼쪽 무릎이 안으로 무너지는 패턴이 보입니다. 중둔근이 약하거나 발목 가동성이 제한됐을 때 나타나는 전형적인 보상 패턴입니다.',
      rightKnee: '오른쪽 무릎이 안으로 무너지는 패턴이 보입니다. 방치하면 슬개골 연골에 지속적인 스트레스가 가해질 수 있어요.',
      leftHip: '왼쪽 고관절 가동성이 제한되어 있을 가능성이 보입니다. 이 경우 허리가 대신 움직이게 되어 요통 위험이 올라가요.',
      rightHip: '오른쪽 고관절 쪽에서 가동 범위 제한이 보입니다. 힙 힌지 운동이나 하체 복합 운동 퍼포먼스에 직접 영향을 줍니다.',
      leftShoulder: '왼쪽 어깨 정렬 이탈이 반복적으로 보입니다. 상체 운동 시 견관절에 부담이 갈 수 있는 패턴입니다.',
      rightShoulder: '오른쪽 어깨쪽에서 정렬이 흐트러지는 구간이 있습니다. 어깨 충돌 증후군의 예방 관리가 필요한 패턴입니다.',
      leftAnkle: '왼쪽 발목 배굴 제한이 보입니다. 이 경우 스쿼트, 런지 동작에서 상체가 과도하게 앞으로 기울어 허리에 부담을 줍니다.',
      rightAnkle: '오른쪽 발목 가동성이 제한되어 있을 가능성이 있습니다. 하체 운동 전반의 기능에 영향을 주는 중요한 부분입니다.',
    } as Record<string, string>,
    ptNeed: {
      low: '지금 상태에서 혼자 운동을 진행하시면 패턴 교정이 어렵고, 잘못된 동작이 습관화될 수 있습니다.',
      medium: '이 패턴들은 혼자서 유튜브 영상 보면서 교정하기 매우 어렵습니다. 전문가가 옆에서 실시간으로 피드백을 주는 게 가장 빠릅니다.',
      high: '현재 상태는 비교적 좋은 편이지만, 지금 단계에서 전문적인 코칭을 받으면 퍼포먼스를 훨씬 빠르게 올릴 수 있습니다.',
    },
    sessions: {
      short: '이 케이스는 대략 10~15회 정도를 기준으로 접근하면 핵심 패턴 교정과 기초 강화까지 충분히 가능합니다.',
      medium: '이 케이스는 20~30회 정도의 단계적 접근이 필요합니다. 교정 → 안정화 → 강화의 순서로 진행해야 합니다.',
      long: '이 케이스는 25~30회의 체계적인 프로그램이 가장 효과적입니다. 각 단계를 충분히 진행해야 재발을 막을 수 있어요.',
    },
  },
} as const;

export type AppConfigType = typeof AppConfig;
