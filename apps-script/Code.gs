/**
 * Total Solutions EV Dashboard — แจ้งเตือนวันหมดอายุผ่าน LINE Messaging API
 * ----------------------------------------------------------------
 * ใช้คู่กับ https://pornwiroonb-web.github.io/ev-dashboard/
 * อ่านข้อมูลจาก Google Sheet เดียวกับ Dashboard (แหล่งข้อมูลเดียว)
 *
 * Script Properties (Project Settings → Script properties):
 *   LINE_CHANNEL_TOKEN  (จำเป็น)  Channel access token (long-lived) ของ Messaging API
 *   LINE_TO             (แนะนำ)   groupId / userId ที่จะส่งถึง — ถ้าเว้นว่างจะ broadcast ถึงเพื่อนทุกคนของบอท
 *   API_KEY             (แนะนำ)   รหัสสำหรับปุ่มบน Dashboard (กันคนอื่นเรียกส่งข้อความ)
 *
 * ขั้นตอน: วางโค้ด → ใส่ Properties → Run setup() หนึ่งครั้ง → Deploy เป็น Web app (Execute as: Me, Access: Anyone)
 * หมายเหตุ: LINE Notify ปิดบริการตั้งแต่ 31 มี.ค. 2025 จึงใช้ Messaging API แทน
 */

const CONFIG = {
  SHEET_ID: '1h0m20N8wnyaV2UA8VP2N-VO8LyiFS2SEtsz0hhF_Giw',
  SHEET_GID: 0,
  DASHBOARD_URL: 'https://pornwiroonb-web.github.io/ev-dashboard/#expiry',
  TZ: 'Asia/Bangkok',
  RUN_HOUR: 8,                              // เวลาเช็คทุกวัน (เวลาไทย)
  MILESTONES: [90, 60, 30, 15, 7, 3, 1, 0], // แจ้งเมื่อเหลือจำนวนวันเหล่านี้พอดี
  WEEKLY_SUMMARY_DAY: 1,                    // 1 = จันทร์ … 7 = อาทิตย์
  SIM_WARRANTY_YEARS: 2,                    // ใช้เมื่อชีตไม่มี simExpire
  MAX_ITEMS_PER_BUBBLE: 12
};

const TH_M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const DAY = 86400000;
const FIELD = {
  id:'id', name:'name', province:'province', pkgtype:'charger', jobstatus:'jobStatus',
  servicestart:'serviceStart', contractend:'contractEnd', simexpire:'simExpire', simrenew:'simRenew',
  note:'note', quote:'quote'
};

/* ═══════════════ ตั้งค่าครั้งแรก ═══════════════ */
function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyCheck')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyCheck').timeBased().everyDays(1).atHour(CONFIG.RUN_HOUR).inTimezone(CONFIG.TZ).create();
  const p = PropertiesService.getScriptProperties();
  const ev = buildEvents_(readRows_());
  Logger.log('ตั้งเวลาเช็คทุกวัน %s:00 น. (%s) แล้ว', CONFIG.RUN_HOUR, CONFIG.TZ);
  Logger.log('อ่านชีตได้ %s รายการวันหมดอายุ', ev.length);
  if (!p.getProperty('LINE_CHANNEL_TOKEN')) Logger.log('⚠️ ยังไม่ได้ใส่ LINE_CHANNEL_TOKEN ใน Script properties');
  if (!p.getProperty('LINE_TO')) Logger.log('ℹ️ ยังไม่มี LINE_TO — จะส่งแบบ broadcast');
}

/* ═══════════════ งานประจำวัน (Trigger) ═══════════════ */
function dailyCheck() {
  const ev = buildEvents_(readRows_()).filter(e => e.level !== 'lapsed');
  const messages = [];

  const hits = ev.filter(e => CONFIG.MILESTONES.indexOf(e.days) >= 0);
  if (hits.length) messages.push(flex_('⏰ แจ้งเตือนครบกำหนด', `${hits.length} รายการถึงรอบแจ้งเตือนวันนี้`, hits));

  const dow = Number(Utilities.formatDate(new Date(), CONFIG.TZ, 'u'));
  if (dow === CONFIG.WEEKLY_SUMMARY_DAY) {
    const weekly = urgentList_(ev);
    if (weekly.length) messages.push(flex_('📋 สรุปประจำสัปดาห์', `${weekly.length} รายการหมดแล้ว/ภายใน 30 วัน`, weekly));
  }

  if (messages.length) sendLine_(messages);
  Logger.log('dailyCheck: milestone=%s, sent=%s', hits.length, messages.length);
  return { milestone: hits.length, sent: messages.length };
}

/* ═══════════════ Web App: ปุ่มบน Dashboard (JSONP) ═══════════════ */
function doGet(e) {
  const q = (e && e.parameter) || {};
  let out;
  try {
    const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (key && q.key !== key) throw new Error('API Key ไม่ถูกต้อง');
    const action = q.action || 'ping';
    if (action === 'ping') {
      const n = buildEvents_(readRows_()).length;
      const hasToken = !!PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
      out = { ok: hasToken, message: hasToken ? `เชื่อมต่อได้ · อ่านชีตได้ ${n} รายการวันหมดอายุ` : 'ยังไม่ได้ใส่ LINE_CHANNEL_TOKEN', error: hasToken ? '' : 'ยังไม่ได้ใส่ LINE_CHANNEL_TOKEN' };
    } else if (action === 'test') {
      sendLine_([{ type: 'text', text: '✅ ทดสอบการเชื่อมต่อ Total Solutions EV Dashboard สำเร็จ\nระบบจะแจ้งเตือนวันหมดอายุสัญญา/SIM ทุกวัน ' + CONFIG.RUN_HOUR + ':00 น.' }]);
      out = { ok: true, message: 'ส่งข้อความทดสอบแล้ว — ตรวจใน LINE' };
    } else if (action === 'run') {
      const list = urgentList_(buildEvents_(readRows_()).filter(x => x.level !== 'lapsed'));
      if (!list.length) out = { ok: true, message: 'ไม่มีรายการเร่งด่วน จึงไม่ได้ส่งข้อความ' };
      else { sendLine_([flex_('📋 สรุปวันหมดอายุ', `${list.length} รายการหมดแล้ว/ภายใน 30 วัน`, list)]); out = { ok: true, message: `ส่งสรุป ${list.length} รายการแล้ว` }; }
    } else {
      throw new Error('action ไม่รู้จัก: ' + action);
    }
  } catch (err) {
    out = { ok: false, error: String(err.message || err) };
  }
  const cb = String(q.callback || '');
  if (/^[\w$.]{1,64}$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + JSON.stringify(out) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ═══════════════ Webhook: บอทในกลุ่ม LINE ═══════════════ */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    (body.events || []).forEach(ev => {
      const src = ev.source || {};
      const id = src.groupId || src.roomId || src.userId || '';
      const text = ev.type === 'message' && ev.message && ev.message.type === 'text' ? ev.message.text.trim().toLowerCase() : '';
      if (ev.type === 'join' || text === 'id' || text === 'ไอดี') {
        PropertiesService.getScriptProperties().setProperty('LAST_SOURCE_ID', id);
        reply_(ev.replyToken, [{ type: 'text', text: 'สวัสดีครับ 👋 Total Solutions Bot\nID ของห้องนี้:\n' + id + '\n\nนำไปใส่ใน Script properties ชื่อ LINE_TO เพื่อรับแจ้งเตือนวันหมดอายุในห้องนี้\nพิมพ์ "สรุป" เพื่อดูรายการเร่งด่วน' }]);
      } else if (text === 'สรุป' || text === 'status' || text === 'summary') {
        const list = urgentList_(buildEvents_(readRows_()).filter(x => x.level !== 'lapsed'));
        reply_(ev.replyToken, [list.length ? flex_('📋 สรุปวันหมดอายุ', `${list.length} รายการหมดแล้ว/ภายใน 30 วัน`, list)
                                           : { type: 'text', text: '✅ ไม่มีรายการหมดอายุหรือใกล้หมดภายใน 30 วัน' }]);
      }
    });
  } catch (err) {
    console.error(err);
  }
  return ContentService.createTextOutput('OK');
}

/* ═══════════════ อ่านชีต ═══════════════ */
function readRows_() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sh = ss.getSheets().filter(s => s.getSheetId() === CONFIG.SHEET_GID)[0] || ss.getSheets()[0];
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const idx = {};
  values[0].forEach((h, i) => {
    const k = String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FIELD[k] && idx[FIELD[k]] === undefined) idx[FIELD[k]] = i;
  });
  return values.slice(1).map(row => {
    const o = {};
    Object.keys(idx).forEach(f => { o[f] = row[idx[f]]; });
    return o;
  }).filter(o => String(o.name || '').trim());
}

/* ═══════════════ คำนวณวันหมดอายุ (ตรรกะเดียวกับ Dashboard) ═══════════════ */
function todayKey_() { return dayKeyFromIso_(Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd')); }
function dayKeyFromIso_(s) { const p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
function mkKey_(y, m, d) {
  if (y > 2400) y -= 543;
  if (y < 100) y += (y >= 60 ? 1957 : 2000);
  const k = Date.UTC(y, m - 1, d), dt = new Date(k);
  return (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) ? k : null;
}
function parseDay_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return null;
    return dayKeyFromIso_(Utilities.formatDate(v, CONFIG.TZ, 'yyyy-MM-dd'));
  }
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return mkKey_(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))) return mkKey_(+m[3], +m[2], +m[1]);
  return null;
}
function addYears_(k, n) {
  const d = new Date(k), y = d.getUTCFullYear() + n, mo = d.getUTCMonth();
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return Date.UTC(y, mo, Math.min(d.getUTCDate(), last));
}
function levelOf_(d) { return d < 0 ? 'expired' : d <= 30 ? 'critical' : d <= 90 ? 'warning' : d <= 180 ? 'upcoming' : 'ok'; }

function buildEvents_(rows) {
  const today = todayKey_(), out = [];
  rows.forEach(o => {
    const r = {
      name: String(o.name).trim(), province: String(o.province || '').trim(),
      serviceStart: parseDay_(o.serviceStart), contractEnd: parseDay_(o.contractEnd),
      simExpire: parseDay_(o.simExpire), simRenew: parseDay_(o.simRenew)
    };
    const active = r.contractEnd === null || r.contractEnd >= today;
    if (r.contractEnd !== null) {
      const d = Math.round((r.contractEnd - today) / DAY);
      out.push({ name: r.name, province: r.province, type: 'contract', label: 'สัญญาบริการ', date: r.contractEnd, days: d, level: levelOf_(d), est: false });
    }
    let sim = null, est = false;
    const real = [r.simExpire, r.simRenew].filter(x => x !== null);
    if (real.length) sim = Math.max.apply(null, real);
    else if (r.serviceStart !== null) { sim = addYears_(r.serviceStart, CONFIG.SIM_WARRANTY_YEARS); est = true; }
    if (sim !== null) {
      const d = Math.round((sim - today) / DAY);
      let level = levelOf_(d);
      if (d < 0 && est) {
        if (!active || r.contractEnd === null) return;
        level = 'lapsed';
      }
      out.push({ name: r.name, province: r.province, type: 'sim', label: est ? 'ประกัน SIM 2 ปี' : 'SIM หมดอายุ', date: sim, days: d, level: level, est: est });
    }
  });
  return out.sort((a, b) => a.days - b.days);
}

/** รายการเร่งด่วน: ใกล้ครบ (0–30 วัน) ก่อน แล้วตามด้วยที่เกินกำหนด (ล่าสุดก่อน) */
function urgentList_(ev) {
  const soon = ev.filter(e => e.level === 'critical');
  const past = ev.filter(e => e.level === 'expired').sort((a, b) => b.days - a.days);
  return soon.concat(past);
}

function thDate_(k) { const d = new Date(k); return d.getUTCDate() + ' ' + TH_M[d.getUTCMonth()] + ' ' + (d.getUTCFullYear() + 543); }

/* ═══════════════ Flex Message ═══════════════ */
function flex_(title, subtitle, items) {
  const shown = items.slice(0, CONFIG.MAX_ITEMS_PER_BUBBLE);
  const color = e => e.days < 0 ? { bg: '#cf3b3b', fg: '#ffffff' }
                   : e.days <= 30 ? { bg: '#fdecec', fg: '#cf3b3b' }
                   : e.days <= 90 ? { bg: '#fdf2df', fg: '#c97a0e' }
                   : { bg: '#e8f0fc', fg: '#2c67c9' };
  const rows = [];
  shown.forEach((e, i) => {
    const c = color(e);
    if (i > 0) rows.push({ type: 'separator', margin: 'md', color: '#eef1f6' });
    rows.push({
      type: 'box', layout: 'horizontal', spacing: 'md', margin: 'md', alignItems: 'center',
      contents: [
        { type: 'box', layout: 'vertical', width: '58px', flex: 0, backgroundColor: c.bg, cornerRadius: '8px', paddingAll: '6px',
          contents: [
            { type: 'text', text: e.days < 0 ? 'เกิน' : e.days === 0 ? 'ครบ' : 'เหลือ', size: 'xxs', color: c.fg, align: 'center' },
            { type: 'text', text: e.days === 0 ? 'วันนี้' : String(Math.abs(e.days)), size: e.days === 0 ? 'sm' : 'lg', weight: 'bold', color: c.fg, align: 'center' },
            { type: 'text', text: e.days === 0 ? 'กำหนด' : 'วัน', size: 'xxs', color: c.fg, align: 'center' }
          ] },
        { type: 'box', layout: 'vertical', flex: 1,
          contents: [
            { type: 'text', text: e.name || '-', size: 'sm', weight: 'bold', color: '#0f1b2d', wrap: true, maxLines: 2 },
            { type: 'text', text: e.label + (e.est ? '*' : '') + ' · ' + thDate_(e.date), size: 'xs', color: '#4a5872', wrap: true },
            { type: 'text', text: e.province || '-', size: 'xxs', color: '#8390a6' }
          ] }
      ]
    });
  });
  if (items.length > shown.length) rows.push({ type: 'text', text: 'และอีก ' + (items.length - shown.length) + ' รายการ', size: 'xs', color: '#8390a6', margin: 'lg' });
  if (items.some(e => e.est)) rows.push({ type: 'text', text: '* ประมาณจากประกัน SIM 2 ปีนับจากวันเริ่มบริการ', size: 'xxs', color: '#8390a6', margin: 'md', wrap: true });

  return {
    type: 'flex',
    altText: title + ' — ' + subtitle,
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#0b2a55', paddingAll: '16px', contents: [
        { type: 'text', text: title + ' · Total Solutions', color: '#ffffff', weight: 'bold', size: 'md', wrap: true },
        { type: 'text', text: thDate_(todayKey_()) + ' · ' + subtitle, color: '#e0b544', size: 'xs', margin: 'sm', wrap: true }
      ] },
      body: { type: 'box', layout: 'vertical', paddingAll: '14px', contents: rows },
      footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [
        { type: 'button', style: 'primary', color: '#0b2a55', height: 'sm', action: { type: 'uri', label: 'เปิด Dashboard', uri: CONFIG.DASHBOARD_URL } }
      ] }
    }
  };
}

/* ═══════════════ LINE API ═══════════════ */
function token_() {
  const t = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
  if (!t) throw new Error('ยังไม่ได้ใส่ LINE_CHANNEL_TOKEN ใน Script properties');
  return t;
}
function call_(path, payload) {
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/' + path, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token_() },
    payload: JSON.stringify(payload)
  });
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('LINE API ' + code + ': ' + res.getContentText());
  return res;
}
function sendLine_(messages) {
  const to = PropertiesService.getScriptProperties().getProperty('LINE_TO');
  for (let i = 0; i < messages.length; i += 5) {
    const batch = messages.slice(i, i + 5);
    if (to) call_('push', { to: to, messages: batch });
    else call_('broadcast', { messages: batch });
  }
}
function reply_(replyToken, messages) {
  if (!replyToken) return;
  call_('reply', { replyToken: replyToken, messages: messages.slice(0, 5) });
}

/* ═══════════════ ทดสอบใน Editor ═══════════════ */
function testSend() { sendLine_([{ type: 'text', text: '✅ ทดสอบ Total Solutions Bot สำเร็จ' }]); }
function previewEvents() {
  buildEvents_(readRows_()).filter(e => e.level !== 'ok').forEach(e =>
    Logger.log('%s | %s | %s | %s วัน | %s', e.level, e.label, e.name, e.days, thDate_(e.date)));
}
