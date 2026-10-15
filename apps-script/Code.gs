/**
 * 현장 사진 보드판 — 저장 서버 (Google Apps Script)
 *
 * 사진은 구글 드라이브 "현장사진보드판" 폴더에, 기록은 이 스프레드시트의 "사진" 시트에 저장됩니다.
 * 설정:  1) 아래 TEAM_PASSWORD 를 팀 비밀번호로 바꾸고 저장
 *        2) 배포 → 새 배포 → 유형: 웹 앱 → 실행: 나 / 액세스: 모든 사용자 → 배포
 */
const TEAM_PASSWORD = '여기에-팀-비밀번호';

const SHEET_NAME = '사진';
const FOLDER_NAME = '현장사진보드판';
const COLS = ['id', 'createdAt', 'date', 'name', 'dong', 'floor', 'work', 'room', 'note', 'action', 'fileId'];
const HEADERS = ['ID', '올린 시각', '일자', '공사명', '위치(동)', '층', '공종', '실', '내용', '조치', '드라이브 파일ID'];

function doGet() {
  return json_({ ok: true, service: 'site-photo-board' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (req.pass !== TEAM_PASSWORD) return json_({ ok: false, error: 'auth' });
    switch (req.action) {
      case 'ping':      return json_({ ok: true });
      case 'list':      return json_({ ok: true, photos: list_() });
      case 'upload':    return json_({ ok: true, photo: upload_(req) });
      case 'setAction': setField_(req.id, 'action', req.value === 'O' || req.value === 'X' ? req.value : ''); return json_({ ok: true });
      case 'delete':    delete_(req.id); return json_({ ok: true });
      default:          return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, error: 'server', message: String(err && err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:K').setNumberFormat('@');
  }
  return sh;
}

function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

function list_() {
  const sh = sheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const rows = sh.getRange(2, 1, n, COLS.length).getDisplayValues();
  return rows.filter(r => r[0]).map(r => {
    const o = {};
    COLS.forEach((c, i) => o[c] = r[i]);
    return o;
  }).reverse();
}

function upload_(req) {
  const m = req.meta || {};
  const clean = v => String(v == null ? '' : v).slice(0, 300);
  const bytes = Utilities.base64Decode(String(req.image || ''));
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('bad_image');
  const id = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  const fname = [clean(m.date), clean(m.dong), clean(m.floor), clean(m.work), clean(m.room), id.slice(0, 6)]
    .filter(String).join('_').replace(/[\\/:*?"<>|\s]+/g, '_') + '.jpg';
  const file = folder_().createFile(Utilities.newBlob(bytes, 'image/jpeg', fname));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const rec = {
    id: id, createdAt: new Date().toISOString(), date: clean(m.date), name: clean(m.name), dong: clean(m.dong),
    floor: clean(m.floor), work: clean(m.work), room: clean(m.room), note: clean(m.note), action: '', fileId: file.getId()
  };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { sheet_().appendRow(COLS.map(c => rec[c])); } finally { lock.releaseLock(); }
  return rec;
}

function findRow_(id) {
  const sh = sheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1 || !id) return -1;
  const ids = sh.getRange(2, 1, n, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return -1;
}

function setField_(id, field, value) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const row = findRow_(id);
    if (row < 0) throw new Error('not_found');
    sheet_().getRange(row, COLS.indexOf(field) + 1).setValue(value);
  } finally { lock.releaseLock(); }
}

function delete_(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const row = findRow_(id);
    if (row < 0) return;
    const sh = sheet_();
    const fileId = sh.getRange(row, COLS.indexOf('fileId') + 1).getDisplayValue();
    if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {} }
    sh.deleteRow(row);
  } finally { lock.releaseLock(); }
}

/** 처음 한 번 실행해서 권한을 승인하고 시트·폴더를 만듭니다. */
function setup() {
  sheet_();
  const f = folder_();
  Logger.log('준비 완료. 사진 폴더: ' + f.getUrl());
}
