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
//   { do: 'askText', saveAs: 'A_change', prompt: '…', placeholder: '…' }   짧은 글 응답 (prompt 생략 시 질문)
//   { do: 'askChoice', saveAs: 'B_why', prompt: '…', options: ['…', …], answer: 1, feedback: '…' }
//                                                          보기 고르기. answer(0부터)를 적으면 틀렸을 때 "다시 생각해 보세요"
//   { do: 'impactCards', levels: 'seen' }                  기온 수준별 영향 카드 (아래 INQUIRY_IMPACTS).
//                                                          'seen' = 이 경로에서 학생이 재생한 시나리오들이 도달한 수준
//   { do: 'record' }                                       지금 상태를 기록 서랍에 한 줄 저장 (버튼을 보인다)
// ============================================================================

const INQUIRY_PATHS = [
];

// 사건 표지 (§4): 처음에는 숨기고 revealMarkers 로만 공개한다(학생이 먼저 판단하게). src = js/sources.js 키
// from·to = 그래프에 칠할 연도 범위, range = 단계 안내에 보일 글
const INQUIRY_MARKERS = {
  industrial_revolution: { label: '산업혁명', from: 1760, to: 1840, range: '약 1760~1840년', src: 'industrial_revolution' },
  great_acceleration: { label: '1950년 이후 급증 (대가속)', from: 1950, to: 2023, range: '1950년~', src: 'great_acceleration' },
};

// 영향 카드 (§5): E4에서 채운다
const INQUIRY_IMPACTS = {
};

// node(검사 도구 tools/test_inquiry.js)에서도 같은 파일을 읽는다
if (typeof module !== 'undefined') module.exports = { INQUIRY_PATHS, INQUIRY_MARKERS, INQUIRY_IMPACTS };
