// ============================================================================
// 탐구 경로·단계 정의 (2차 개편 E) — 데이터만 있는 파일
// ----------------------------------------------------------------------------
// 왜 데이터 파일인가: 수업 초안이 아직 없다. 교사가 이 파일만 고쳐서 단계를 넣고 빼고 문구를 바꿀 수 있게,
// 실행기(js/inquiry.js)는 여기 적힌 것만 읽고 화면에 적용한다. 코드를 고칠 필요가 없어야 한다.
// 고친 뒤에는 node tools/test_inquiry.js 로 형식을 검사한다(없는 동작 이름·그래프 이름·출처 키를 잡아 준다).
//
// 경로   { id, title, summary, steps: [단계, …] }
// 단계   {
//   id: 'A2',                       경로 안에서 겹치지 않는 이름 (기록 CSV의 step 열)
//   title: '증가는 언제 시작됐을까?',  단계 제목
//   question: '…',                  학생에게 묻는 질문 — 굵게 보인다 (기록 CSV의 question 열)
//   hint: '…',                      힌트 — 접어 두고 학생이 펼친다 (생략 가능)
//   text: '…',                      질문 아래 짧은 설명 (생략 가능)
//   equation: '…',                  반응식 같은 식 한 줄 — 상자에 담아 보인다 (생략 가능)
//   actions: [ { do: '동작 이름', … }, … ],   아래 동작 목록
//   next: 'A3',                     다음 단계 id. 생략하면 배열에서 바로 아래 단계 → 단계 하나를 지우거나 끼워 넣어도
//                                   다른 단계를 고칠 필요가 없다. 마지막 단계는 생략.
// }
// 단계는 들어갈 때마다 화면을 '탐구 기본 상태'로 되돌린 뒤 actions를 적용한다(선언형).
// 그래서 [이전]으로 돌아가도 그 단계의 화면이 그대로 나온다. 학생이 정한 시나리오·재생 위치와
// 학생 응답(고른 점·글·보기)은 단계를 오가도 남는다.
//
// 동작 목록 (TASK_2차_E_탐구모드.md §2. 새 동작은 js/inquiry.js ACTION_SPEC 과 여기에 함께 적는다)
//   그래프 이름: co2 · T · pH · sst  (미래 예측 탭의 그래프 4개)
//   { do: 'showCharts', charts: ['co2'] }                  보일 그래프만 펼치고 나머지는 옅게 접는다
//   { do: 'timeRange', from: 1750, to: 2023, lockFuture: true }
//                                                          그래프 x축·시간 막대 범위. lockFuture면 예측(2023 이후)으로 못 간다
//   { do: 'overlay', chart: 'co2', series: 'fossil' }      그래프에 다른 자료를 겹친다(오른쪽 축).
//                                                          series: fossil(화석연료 배출, GCP 관측) · co2(대기 CO₂ 관측 + 예측)
//   { do: 'pickPoint', chart: 'co2', saveAs: 'A_turningYear' }
//                                                          학생이 그래프를 눌러 연도를 고른다 → 연도·값 저장, 점 표시
//   { do: 'revealMarkers', markers: ['industrial_revolution', …] }   숨겨 둔 사건 표지 공개 (아래 INQUIRY_MARKERS)
//   { do: 'setScenario', preset: 'ssp245' }                시나리오를 정한다 (ssp245 · ssp126 · ssp119)
//   { do: 'setScenario', wait: true }                      학생이 고르도록 시나리오 버튼을 보인다
//   { do: 'play', from: 2023, to: 2100, recordAtEnd: true }   그 구간을 재생(재생 버튼을 보인다).
//                                                          recordAtEnd면 끝 연도 값을 기록 서랍에 자동 저장
//   { do: 'toggleNature', on: true }                       자연만 있는 지구 보기
//   { do: 'focus3D', target: 'city' }                      3D 카메라 이동: city · coral · shell · glacier
//   { do: 'openPopover', id: 'spec' }                      그래프 팝오버: sink(탄소는 어디로?) · spec(바다 속 탄소)
//   { do: 'omega', on: true }                              pH 그래프의 [Ω 함께 보기]
//   { do: 'modelPast', on: true }                          [모형 검증 보기]: 모형이 계산한 과거(1750~2023)를 옅은 선으로
//   { do: 'askText', saveAs: 'A_change', prompt: '…', placeholder: '…' }   짧은 글 응답 (prompt 생략 시 질문)
//   { do: 'askChoice', saveAs: 'B_why', prompt: '…', options: ['…', …], answer: 1, feedback: '…' }
//                                                          보기 고르기. answer(0부터)를 적으면 틀렸을 때 "다시 생각해 보세요"
//   { do: 'impactCards', levels: 'seen' }                  기온 수준별 영향 카드 (아래 INQUIRY_IMPACTS).
//                                                          'seen' = 이 경로에서 학생이 재생한 시나리오들이 도달한 수준
//   { do: 'record' }                                       지금 상태를 기록 서랍에 한 줄 저장 (버튼을 보인다)
// ============================================================================

// 과거만 보는 단계에서 함께 쓰는 동작 (1750~2023 관측, 예측으로 못 감)
const PAST_ONLY = { do: 'timeRange', from: 1750, to: 2023, lockFuture: true };

const INQUIRY_PATHS = [
  // ── 경로 A — 왜 CO₂가 증가했을까? (랩미팅 학습 과정 1) ──
  { id: 'A', title: '왜 CO₂가 증가했을까?', summary: 'CO₂ 그래프에서 증가가 시작된 때를 찾고 원인을 생각해 봅니다',
    steps: [
      { id: 'A1', title: 'CO₂는 어떻게 변해 왔을까?',
        question: 'CO₂는 어떻게 변해 왔나요?',
        text: '1750년부터 2023년까지 관측한 대기 CO₂ 농도입니다. 선이 어떻게 움직이는지 처음부터 끝까지 따라가 보세요.',
        hint: '처음 100년쯤과 마지막 70년쯤의 기울기를 비교해 보세요.',
        actions: [
          { do: 'showCharts', charts: ['co2'] },
          PAST_ONLY,
          { do: 'askText', saveAs: 'A_change', placeholder: '예) 처음에는 … 그러다가 …' },
        ] },
      { id: 'A2', title: '증가는 언제 시작됐을까?',
        question: 'CO₂가 늘어나기 시작한 곳을 그래프에서 눌러 보세요.',
        hint: '선이 위로 꺾이기 시작하는 곳을 찾아보세요. 다시 누르면 고친 곳으로 바뀝니다.',
        actions: [
          { do: 'showCharts', charts: ['co2'] },
          PAST_ONLY,
          { do: 'pickPoint', chart: 'co2', saveAs: 'A_turningYear' },
        ] },
      { id: 'A3', title: '그때 무슨 일이 있었을까?',
        question: '내가 고른 해와 두 시기(산업혁명, 1950년 이후 급증)를 비교해 보세요.',
        text: '숨겨 두었던 표지를 공개했습니다. 내가 고른 해(동그라미)는 어느 시기에 가까운가요?',
        hint: '산업혁명 때 석탄을 때는 증기기관과 공장이 퍼졌습니다. 1950년 이후에는 석유·자동차·전기 사용이 크게 늘었습니다.',
        actions: [
          { do: 'showCharts', charts: ['co2'] },
          PAST_ONLY,
          { do: 'revealMarkers', markers: ['industrial_revolution', 'great_acceleration'] },
          { do: 'askText', saveAs: 'A_compare', prompt: '내가 고른 해는 어느 시기에 가까웠나요?', rows: 1 },
        ] },
      { id: 'A4', title: '화석연료 배출과 비교하기',
        question: '두 그래프는 어떤 관계인가요?',
        text: 'CO₂ 그래프 위에 해마다 태운 화석연료(석탄·석유·가스)에서 나온 탄소의 양을 겹쳤습니다. 3D의 도시도 그해 배출에 맞춰 자랍니다(연출).',
        hint: '두 선이 함께 늘어나기 시작하는 때와, 가장 가파르게 늘어나는 때를 비교해 보세요.',
        actions: [
          { do: 'showCharts', charts: ['co2'] },
          PAST_ONLY,
          { do: 'overlay', chart: 'co2', series: 'fossil' },
          { do: 'focus3D', target: 'city' },
          { do: 'askText', saveAs: 'A_relation' },
        ] },
      { id: 'A5', title: '사람이 없었다면?',
        question: '사람이 없었다면 CO₂는 어땠을까요?',
        text: '3D를 "자연만 있는 지구"로 바꾸고, 그래프의 회색 점선(자연만 있는 지구)을 굵게 했습니다. 같은 모형에 사람의 배출만 0으로 넣은 결과입니다.',
        hint: '회색 점선과 관측(검은 선)이 언제부터 벌어지나요?',
        actions: [
          { do: 'showCharts', charts: ['co2'] },
          PAST_ONLY,
          { do: 'toggleNature', on: true },
          { do: 'askText', saveAs: 'A_nature' },
        ] },
      { id: 'A6', title: '정리하기',
        question: 'CO₂ 증가의 원인은 ____이다.',
        text: '빈칸을 채워 한 문장으로 정리하고, 지금 상태를 기록 서랍에 남기세요.',
        actions: [
          { do: 'showCharts', charts: ['co2'] },
          PAST_ONLY,
          { do: 'askText', saveAs: 'A_cause', placeholder: 'CO₂ 증가의 원인은 …이다.' },
          { do: 'record', value: 'ppm' },
        ] },
    ] },

  // ── 경로 B — 해양 pH는 그동안 어땠을까? (랩미팅 학습 과정 2) ──
  { id: 'B', title: '해양 pH는 그동안 어땠을까?', summary: '바다의 pH와 CO₂를 비교하고, 바다가 산성화되는 까닭을 알아봅니다',
    steps: [
      { id: 'B1', title: 'pH는 어떻게 변하고 있을까?',
        question: 'pH는 어떻게 변하고 있나요?',
        text: '검은 점은 하와이 앞바다(Station ALOHA)에서 1989년부터 잰 pH, 옅은 선은 모형이 계산한 1750년부터의 전 지구 평균 표층 pH입니다.',
        hint: 'pH가 작아질수록 산성 쪽입니다. 0.1만 달라져도 수소 이온(H⁺)은 약 26 % 늘어납니다.',
        actions: [
          { do: 'showCharts', charts: ['pH'] },
          PAST_ONLY,
          { do: 'modelPast', on: true },
          { do: 'askText', saveAs: 'B_change' },
        ] },
      { id: 'B2', title: 'CO₂와 비교하기',
        question: '두 값은 어떤 관계인가요?',
        text: 'pH 그래프 위에 대기 CO₂를 겹쳤습니다(오른쪽 축).',
        hint: '한쪽이 올라갈 때 다른 쪽은 어떻게 되나요?',
        actions: [
          { do: 'showCharts', charts: ['pH'] },
          PAST_ONLY,
          { do: 'modelPast', on: true },
          { do: 'overlay', chart: 'pH', series: 'co2' },
          { do: 'askText', saveAs: 'B_relation' },
        ] },
      { id: 'B3', title: '바닷물 속에서 무슨 일이?',
        question: 'pH가 낮아지는 이유는 무엇일까요?',
        text: '대기의 CO₂가 바닷물에 녹으면 물과 반응해 탄산(H₂CO₃)이 되고, 탄산은 수소 이온(H⁺)과 중탄산 이온(HCO₃⁻)으로 나뉩니다. 오른쪽 "바다 속 탄소" 상자에서 1750년과 2023년을 비교해 보세요.',
        equation: 'CO₂ + H₂O ⇌ H₂CO₃ ⇌ H⁺ + HCO₃⁻',
        hint: 'pH는 수소 이온(H⁺)이 많을수록 낮아집니다. 반응식에서 H⁺는 어디서 생기나요?',
        actions: [
          { do: 'showCharts', charts: ['pH'] },
          PAST_ONLY,
          { do: 'openPopover', id: 'spec' },
          { do: 'askChoice', saveAs: 'B_why', prompt: 'pH가 낮아지는 이유는?',
            options: ['바닷물의 온도가 올라가서', '바다에 녹은 CO₂가 탄산이 되어 H⁺를 내놓아서', '바닷물의 소금이 늘어나서', '바다 생물이 줄어들어서'],
            answer: 1, feedback: '좋아요. 그런데 표에서 CO₃²⁻(탄산 이온)는 왜 줄었을까요?' },
        ] },
      { id: 'B4', title: '조개와 산호의 껍데기',
        question: 'Ω가 1보다 작아지면 무슨 일이 생길까요?',
        text: 'Ω(아라고나이트 포화도)는 조개·산호가 껍데기(탄산칼슘)를 만들기 쉬운 정도입니다. 3D에서 조개를 가까이 보고, 현재 정책으로 2200년까지 재생해 Ω가 어떻게 되는지 보세요. 그래프의 Ω는 전 지구 평균 표층 바다 값입니다.',
        hint: 'Ω = 1은 껍데기가 녹기 시작하는 경계입니다(그래프의 점선). 껍데기 만드는 재료인 CO₃²⁻가 줄면 Ω도 줄어듭니다.',
        actions: [
          { do: 'showCharts', charts: ['pH'] },
          { do: 'setScenario', preset: 'ssp245' },
          { do: 'timeRange', from: 1750, to: 2200 },
          { do: 'omega', on: true },
          { do: 'focus3D', target: 'shell' },
          { do: 'play', from: 2023, to: 2200 },
          { do: 'askText', saveAs: 'B_omega' },
        ] },
      { id: 'B5', title: '정리하기',
        question: '바다가 산성화되는 이유는 ____이다.',
        text: '빈칸을 채워 한 문장으로 정리하고, 지금 상태를 기록 서랍에 남기세요.',
        actions: [
          { do: 'showCharts', charts: ['pH'] },
          { do: 'askText', saveAs: 'B_cause', placeholder: '바다가 산성화되는 이유는 …이다.' },
          { do: 'record', value: 'pH' },
        ] },
    ] },

];

// 사건 표지 (§4): 처음에는 숨기고 revealMarkers 로만 공개한다(학생이 먼저 판단하게). src = js/sources.js 키
// from·to = 그래프에 칠할 연도 범위, range = 단계 안내에 보일 글
const INQUIRY_MARKERS = {
  industrial_revolution: { label: '산업혁명', from: 1760, to: 1840, range: '약 1760~1840년', src: 'industrial_revolution' },
  great_acceleration: { label: '1950년 이후 급증 (대가속)', from: 1950, to: 2023, range: '1950년~', src: 'great_acceleration' },
};

// 영향 카드 (§5). 수치는 IPCC 발췌본과 그 쪽 이미지(docs/refs/발췌/)에서 직접 확인한 것만 넣는다.
// 카드에 없는 수준(3 °C)은 근거 쪽이 발췌본에 없어서 만들지 않았다 — 생기면 levels에 카드를 하나 더 넣으면 된다.
//   levels[].level  지구 평균기온 상승(1850~1900 대비, °C).  items[] { what 무엇이, value 큰 숫자, detail 한 줄 설명, src 출처 키 }
//   seaLevel       시나리오별 값(기온 수준이 아님) — 기준 기간이 다르니 기온 수준 카드와 섞지 않는다
const INQUIRY_IMPACTS = {
  basis: '기준: 사람의 영향이 거의 없던 1850~1900년에 10년에 한 번 일어나던 사건. 극한 고온·호우는 육지, 가뭄은 건조해지는 지역 기준입니다.',
  levels: [
    { level: 1, title: '지금 (약 1 °C)', items: [
      { what: '극한 고온 (육지)', value: '2.8번', detail: '10년에 1번 → 지금은 10년에 약 2.8번 (1.8~3.2)', src: 'impact_extremes_ar6' },
      { what: '호우 (육지)', value: '1.3번', detail: '10년에 1번 → 약 1.3번 (1.2~1.4)', src: 'impact_extremes_ar6' },
    ] },
    { level: 1.5, title: '+1.5 °C', items: [
      { what: '극한 고온 (육지)', value: '4.1번', detail: '10년에 1번 → 약 4.1번 (2.8~4.7), 더 뜨거움 +1.9 °C', src: 'impact_extremes_ar6' },
      { what: '호우 (육지)', value: '1.5번', detail: '10년에 1번 → 약 1.5번 (1.4~1.7), 비의 양 +10.5 %', src: 'impact_extremes_ar6' },
      { what: '산호초', value: '70~90 % 더 감소', detail: '보고서가 나온 2018년 무렵보다 더 줄어듦', src: 'impact_coral_sr15' },
    ] },
    { level: 2, title: '+2 °C', items: [
      { what: '극한 고온 (육지)', value: '5.6번', detail: '10년에 1번 → 약 5.6번 (3.8~6.0), 더 뜨거움 +2.6 °C', src: 'impact_extremes_ar6' },
      { what: '호우 (육지)', value: '1.7번', detail: '10년에 1번 → 약 1.7번 (1.6~2.0), 비의 양 +14.0 %', src: 'impact_extremes_ar6' },
      { what: '산호초', value: '99 % 넘게 손실', detail: '거의 모든 산호초가 사라짐', src: 'impact_coral_sr15' },
    ] },
    { level: 4, title: '+4 °C', items: [
      { what: '극한 고온 (육지)', value: '9.4번', detail: '10년에 1번 → 약 9.4번 (8.3~9.6), 더 뜨거움 +5.1 °C', src: 'impact_extremes_ar6' },
      { what: '호우 (육지)', value: '2.7번', detail: '10년에 1번 → 약 2.7번 (2.3~3.6), 비의 양 +30.2 %', src: 'impact_extremes_ar6' },
      { what: '가뭄 (건조해지는 지역)', value: '4.1번', detail: '10년에 1번 → 약 4.1번 (1.7~7.2)', src: 'impact_extremes_ar6' },
    ] },
  ],
  missingLevels: [3],   // 근거 발췌가 없어 카드를 만들지 않은 수준 (가까운 학생 결과가 있으면 안내 문구를 보인다)
  seaLevel: {
    title: '2100년 해수면 상승 (1995~2014년 평균 대비, 가능성 높은 범위)',
    rows: { ssp119: '0.28~0.55 m', ssp126: '0.32~0.62 m', ssp245: '0.44~0.76 m' },
    note: '1900년 기준으로는 0.16 m를 더합니다.',
    src: 'impact_sealevel_ar6',
  },
};

// node(검사 도구 tools/test_inquiry.js)에서도 같은 파일을 읽는다
if (typeof module !== 'undefined') module.exports = { INQUIRY_PATHS, INQUIRY_MARKERS, INQUIRY_IMPACTS };
