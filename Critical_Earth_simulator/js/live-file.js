// ================= 직접 실험 - 지난 데이터 열기 (처음 화면의 '📂 지난 데이터 열기') =================
// 이 화면에서 내보낸 CSV·엑셀(.xlsx)이나 서버가 남긴 logs/실험이름_날짜_시각.csv를 열어서,
// 보드 연결 없이 실험 화면의 그래프 / 데이터 표 / 편집·분석·내보내기만 쓴다.
// 여는 동안(liveFile)은 실시간 값·서버의 실험 기록을 화면 기록에 섞지 않는다 (tab-live.js).
// 닫으면 페이지를 새로 불러서 원래 실험 상태로 돌아간다.

// ── CSV 읽기 (따옴표 안의 쉼표·줄바꿈 처리) ─────────────────
function parseCsvText(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

// ── 엑셀(.xlsx) 첫 번째 시트 읽기 (zip을 직접 풀고 시트 XML을 읽음, 라이브러리 없이) ──
async function unzipEntries(buf) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('엑셀 파일이 아니거나 깨졌어요');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = {};
  for (let n = 0; n < count; n++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    out[name] = { method, size, local };
    p += 46 + nameLen + extraLen + commentLen;
  }
  out._read = async (name) => {
    const e = out[name];
    if (!e) return null;
    const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
    const data = new Uint8Array(buf, start, e.size);
    if (e.method === 0) return dec.decode(data);
    if (e.method !== 8) throw new Error('지원하지 않는 압축 방식이에요');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  };
  return out;
}

async function parseXlsxFirstSheet(buf) {
  const z = await unzipEntries(buf);
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  // 첫 번째 시트의 파일 이름 (workbook.xml의 첫 sheet → rels)
  let sheetPath = 'xl/worksheets/sheet1.xml';
  try {
    const wb = xml(await z._read('xl/workbook.xml'));
    const first = wb.getElementsByTagName('sheet')[0];
    const rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
    const rels = xml(await z._read('xl/_rels/workbook.xml.rels'));
    const rel = [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid);
    if (rel) sheetPath = 'xl/' + rel.getAttribute('Target').replace(/^\/?xl\//, '');
  } catch (e) { /* 기본 경로로 */ }
  const shared = [];
  const ss = await z._read('xl/sharedStrings.xml');
  if (ss) for (const si of xml(ss).getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
  const sheet = xml(await z._read(sheetPath));
  const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const rows = [];
  for (const r of sheet.getElementsByTagName('row')) {
    const row = [];
    for (const c of r.getElementsByTagName('c')) {
      const type = c.getAttribute('t');
      const vEl = c.getElementsByTagName('v')[0];
      let val = '';
      if (type === 's') val = shared[Number(vEl && vEl.textContent)] || '';
      else if (type === 'inlineStr') val = [...c.getElementsByTagName('t')].map(t => t.textContent).join('');
      else val = vEl ? vEl.textContent : '';
      row[colIdx(c.getAttribute('r') || 'A1')] = val;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    if (row.some(x => x !== '')) rows.push(row);
  }
  return rows;
}

// ── 표 → 기록 ({ _t, _dev, timestamp, _light, [변인]: 값 }) ──────────────
const FILE_COL = {
  time: ['timestamp', '측정 시각', '측정시각', 'time', '시각', '날짜', 'date'],
  elapsed: ['elapsed_s', '경과 시간(초)', '경과시간(초)', 'elapsed_seconds', 'elapsed', '경과 시간 (초)'],
  light: ['light', '조명(1=켬)', '조명'],
  dev: ['_dev', '보드', 'dev', 'device'],
  skip: ['_source', '#', 'measurement', '측정 번호', '번호'],
};
function parseTimeText(s) {
  s = String(s || '').trim();
  if (!s) return NaN;
  const ko = s.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{1,2}):(\d{2}):(\d{2})/); // 2026. 10. 11. 15:19:21
  if (ko) return new Date(+ko[1], ko[2] - 1, +ko[3], +ko[4], +ko[5], +ko[6]).getTime();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function recordsFromRows(rows) {
  if (rows.length < 2) throw new Error('데이터 줄이 없어요');
  const head = rows[0].map(h => String(h || '').trim());
  const find = (names) => head.findIndex(h => names.includes(h.toLowerCase()) || names.includes(h));
  const ti = find(FILE_COL.time), ei = find(FILE_COL.elapsed), li = find(FILE_COL.light), di = find(FILE_COL.dev);
  const used = new Set([ti, ei, li, di]);
  const body = rows.slice(1);
  const num = (x) => { const s = String(x ?? '').trim(); if (s === '') return NaN; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
  const keyCols = head.map((h, i) => i).filter(i => !used.has(i) && head[i] && !FILE_COL.skip.includes(head[i].toLowerCase())
    && body.some(r => Number.isFinite(num(r[i]))));
  if (!keyCols.length) throw new Error('숫자 값이 들어 있는 칸을 찾지 못했어요');
  // 서버 기록(logs/*.csv)은 보드가 여러 대면 같은 이름(co2)이 여러 보드에서 와요 → 두 번째 보드부터 co2@보드
  const devName = (d) => String(d || '').replace(/^(mqtt|usb|ble|http):/, '');
  const firstDevOf = {};
  const base = (() => {
    for (const r of body) { const t = parseTimeText(r[ti]); if (ti >= 0 && Number.isFinite(t)) return t - (ei >= 0 && Number.isFinite(num(r[ei])) ? num(r[ei]) * 1000 : 0); }
    return Date.now();
  })();
  const records = [];
  body.forEach((r, n) => {
    const el = ei >= 0 ? num(r[ei]) : NaN;
    let t = Number.isFinite(el) ? base + el * 1000 : (ti >= 0 ? parseTimeText(r[ti]) : NaN);
    if (!Number.isFinite(t)) t = base + n * 1000;
    const dev = di >= 0 ? devName(r[di]) : '';
    const rec = { _t: t, _dev: dev || 'file', timestamp: ti >= 0 ? String(r[ti]) : new Date(t).toISOString() };
    const lv = li >= 0 ? num(r[li]) : NaN;
    if (Number.isFinite(lv)) rec._light = lv ? 1 : 0;
    let any = false;
    for (const i of keyCols) {
      const v = num(r[i]);
      if (!Number.isFinite(v)) continue;
      let k = head[i];
      if (dev) { if (!(k in firstDevOf)) firstDevOf[k] = dev; if (firstDevOf[k] !== dev) k = `${k}@${dev}`; }
      rec[k] = v; any = true;
    }
    if (any || rec._light != null) records.push(rec);
  });
  records.sort((a, b) => a._t - b._t);
  const keys = [...new Set(records.flatMap(r => Object.keys(r).filter(k => !k.startsWith('_') && k !== 'timestamp')))];
  return { records, keys };
}

// ── 열기 / 닫기 ─────────────────────────────────────
async function openDataFile(file) {
  let rows;
  try {
    rows = /\.xlsx$/i.test(file.name) ? await parseXlsxFirstSheet(await file.arrayBuffer()) : parseCsvText(await file.text());
    var { records, keys } = recordsFromRows(rows);
  } catch (e) {
    showLiveToast(`파일을 읽지 못했어요 — ${e.message}`, true);
    return;
  }
  if (!records.length) { showLiveToast('파일에 기록이 없어요', true); return; }
  const title = file.name.replace(/\.(csv|xlsx)$/i, '');
  liveFile = { name: file.name, title };
  // 지금 화면의 실시간 상태를 비우고 파일 기록으로 채운다 (닫으면 새로 불러서 되돌림)
  liveRecords = records;
  liveKnownKeys.clear();
  for (const k of Object.keys(keyInfo)) delete keyInfo[k];
  for (const k of Object.keys(liveLatest)) delete liveLatest[k];
  for (const k of keys) {
    liveKnownKeys.add(k);
    keyInfo[k] = { raw: k, dev: 'file' };
    const last = [...records].reverse().find(r => typeof r[k] === 'number');
    if (last) liveLatest[k] = { value: last[k], timestamp: new Date(last._t).toISOString(), dev: 'file' };
  }
  const t0 = records[0]._t, t1 = records[records.length - 1]._t;
  const lightEvents = [];
  for (const r of records) if (r._light != null && (!lightEvents.length || lightEvents[lightEvents.length - 1].on !== r._light)) lightEvents.push({ t: r._t, on: r._light });
  liveSession = { state: 'file', startedAt: t0, endedAt: t1, lightEvents, file: `${safeFileName(title)}_편집` };
  document.body.classList.add('live-file');
  // 실험 그래프 카드는 치우고(저장된 배치는 그대로 둠) 파일의 변인으로 새로
  for (const g of [...liveGraphs]) removeLiveGraph(g.id);
  showLiveExperiment();
  refreshLiveSelectOptions();
  keys.slice(0, MAX_LIVE_GRAPHS).forEach(k => addGraphForKey(k));
  arrangeGraphs();
  updateAllLiveCharts();
  renderDevicePanel(true);
  renderLiveStatus();
  if (typeof onLiveKeysChanged === 'function') onLiveKeysChanged();
  if (typeof onLiveRecordsChanged === 'function') onLiveRecordsChanged(true);
  showLiveToast(`${records.length}개 기록을 열었어요 — 그래프를 누르거나 📋 데이터에서 편집·분석하세요`);
}

function closeDataFile() {
  liveFile = null;
  location.reload(); // 실시간 상태·실험 그래프 배치를 서버·저장소에서 다시 불러옴
}

document.getElementById('lsOpenFileBtn').addEventListener('click', () => document.getElementById('lsFileInput').click());
document.getElementById('lsFileInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) openDataFile(f);
});
