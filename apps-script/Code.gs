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
  BASE_URL: 'https://pornwiroonb-web.github.io/ev-dashboard/',
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
  note:'note', quote:'quote', vender1:'vendor1', vender2:'vendor2', price:'price', biztype:'bizType',
  lat:'lat', latitude:'lat', lng:'lng', lon:'lng', long:'lng', longitude:'lng',
  location:'location', latlng:'location', latlong:'location', gps:'location', coordinates:'location', coordinate:'location', googlemaps:'location', googlemap:'location', map:'location', maps:'location'
};
const Y = '#F9D648', BK = '#0A0A0A', TILE = '#1C1C1C';
const DARK_ = { header: { backgroundColor: '#0A0A0A' }, body: { backgroundColor: '#121212' }, footer: { backgroundColor: '#121212' } };
const QUICK = [['⚡ สรุปด่วน','สรุป'],['⏰ ใกล้หมดอายุ','หมดอายุ'],['📊 สถานะงาน','สถานะ'],['🔍 ค้นหา','ค้นหา'],['🗺️ แผนที่','แผนที่'],['☰ เมนู','เมนู']];

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
      try { handleEvent_(ev); } catch (err) { console.error(err); }
    });
  } catch (err) {
    console.error(err);
  }
  return ContentService.createTextOutput('OK');
}

function handleEvent_(ev) {
  const src = ev.source || {};
  const id = src.groupId || src.roomId || src.userId || '';
  if (ev.type === 'join' || ev.type === 'follow') {
    PropertiesService.getScriptProperties().setProperty('LAST_SOURCE_ID', id);
    return reply_(ev.replyToken, [
      { type: 'text', text: 'สวัสดีครับ 👋 Total Solutions Bot\nID ของห้องนี้:\n' + id + '\n\nนำไปใส่ใน Script properties ชื่อ LINE_TO เพื่อรับแจ้งเตือนวันหมดอายุในห้องนี้' },
      withQuick_(menuFlex_())
    ]);
  }
  if (ev.type === 'postback') {
    const data = (ev.postback && ev.postback.data) || '';
    if (data === 'action=search') return;                    // Rich menu เปิดคีย์บอร์ด "ค้นหา " ให้พิมพ์ต่อเอง
    return;
  }
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
  const raw = ev.message.text.trim();
  const text = raw.toLowerCase();

  if (text === 'id' || text === 'ไอดี') {
    PropertiesService.getScriptProperties().setProperty('LAST_SOURCE_ID', id);
    return reply_(ev.replyToken, [{ type: 'text', text: 'ID ของห้องนี้:\n' + id }]);
  }
  if (['เมนู', 'menu', 'เมนู total solutions'].indexOf(text) >= 0) return reply_(ev.replyToken, [withQuick_(menuFlex_())]);
  if (['สรุป', 'สรุปด่วน', 'summary'].indexOf(text) >= 0) {
    const list = urgentList_(buildEvents_(readRows_()).filter(x => x.level !== 'lapsed'));
    return reply_(ev.replyToken, [withQuick_(list.length ? flex_('⚡ สรุปด่วน', `${list.length} รายการหมดแล้ว/ภายใน 30 วัน`, list)
                                                     : { type: 'text', text: '✅ ไม่มีรายการหมดอายุหรือใกล้หมดภายใน 30 วัน' })]);
  }
  if (['หมดอายุ', 'ใกล้หมดอายุ', 'expiring'].indexOf(text) >= 0) {
    const list = buildEvents_(readRows_()).filter(x => x.days >= 0 && x.days <= 90);
    return reply_(ev.replyToken, [withQuick_(list.length ? flex_('⏰ ใกล้หมดอายุ', `${list.length} รายการภายใน 90 วัน`, list)
                                                     : { type: 'text', text: '✅ ไม่มีรายการที่จะหมดอายุภายใน 90 วัน' })]);
  }
  if (['สถานะ', 'สถานะงาน', 'status'].indexOf(text) >= 0) return reply_(ev.replyToken, [withQuick_(statusFlex_(readRows_()))]);
  if (text === 'ค้นหา' || text === 'search') {
    return reply_(ev.replyToken, [withQuick_({ type: 'text', text: '🔍 พิมพ์ "ค้นหา" ตามด้วยชื่อสถานี จังหวัด หรือผู้รับเหมา\nเช่น  ค้นหา EGCO\n       ค้นหา ชลบุรี\n       ค้นหา Innopower' })]);
  }
  const m = raw.match(/^(?:ค้นหา|search)\s+(.+)$/i);
  if (m) return reply_(ev.replyToken, [withQuick_(searchFlex_(readRows_(), m[1].trim()))]);
  if (['แผนที่', 'map'].indexOf(text) >= 0) return reply_(ev.replyToken, [withQuick_(mapFlex_(readRows_()))]);
  const mm = raw.match(/^(?:แผนที่|map|นำทาง)\s+(.+)$/i);
  if (mm) return reply_(ev.replyToken, locationReply_(readRows_(), mm[1].trim()));
  if (['ช่วยเหลือ', 'help', '?'].indexOf(text) >= 0) return reply_(ev.replyToken, [withQuick_(helpFlex_())]);
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
  const color = e => e.days < 0 ? { bg: '#FF5A5A', fg: '#0A0A0A' }
                   : e.days <= 30 ? { bg: '#3A1618', fg: '#FF5A5A' }
                   : e.days <= 90 ? { bg: '#35270F', fg: '#F0A534' }
                   : { bg: '#12233F', fg: '#5B9BFF' };
  const rows = [];
  shown.forEach((e, i) => {
    const c = color(e);
    if (i > 0) rows.push({ type: 'separator', margin: 'md', color: '#262626' });
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
            { type: 'text', text: e.name || '-', size: 'sm', weight: 'bold', color: '#F5F5F5', wrap: true, maxLines: 2 },
            { type: 'text', text: e.label + (e.est ? '*' : '') + ' · ' + thDate_(e.date), size: 'xs', color: '#B8B8B8', wrap: true },
            { type: 'text', text: e.province || '-', size: 'xxs', color: '#7C7C7C' }
          ] }
      ]
    });
  });
  if (items.length > shown.length) rows.push({ type: 'text', text: 'และอีก ' + (items.length - shown.length) + ' รายการ', size: 'xs', color: '#7C7C7C', margin: 'lg' });
  if (items.some(e => e.est)) rows.push({ type: 'text', text: '* ประมาณจากประกัน SIM 2 ปีนับจากวันเริ่มบริการ', size: 'xxs', color: '#7C7C7C', margin: 'md', wrap: true });

  return {
    type: 'flex',
    altText: title + ' — ' + subtitle,
    contents: {
      type: 'bubble', size: 'mega', styles: DARK_,
      header: header_(title, subtitle),
      body: { type: 'box', layout: 'vertical', paddingAll: '14px', contents: rows },
      footer: footer_()
    }
  };
}

/* ═══════════════ LINE API ═══════════════ */
function token_() {
  const t = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
  if (!t) throw new Error('ยังไม่ได้ใส่ LINE_CHANNEL_TOKEN ใน Script properties');
  return t;
}
function call_(path, payload) { return api_('https://api.line.me/v2/bot/message/' + path, 'post', payload); }
function api_(url, method, payload, contentType) {
  const opt = { method: method || 'post', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token_() } };
  if (payload !== undefined) {
    opt.contentType = contentType || 'application/json';
    opt.payload = contentType ? payload : JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch(url, opt);
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('LINE API ' + code + ': ' + res.getContentText());
  const t = res.getContentText();
  return t ? JSON.parse(t) : {};
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

/* ═══════════════ ส่วนประกอบ Flex (โทน EGAT EV ดำ-เหลือง) ═══════════════ */
function header_(title, subtitle) {
  return { type: 'box', layout: 'vertical', backgroundColor: BK, paddingAll: '16px', contents: [
    { type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: title, color: '#FFFFFF', weight: 'bold', size: 'md', wrap: true, flex: 1 },
      { type: 'text', flex: 0, align: 'end', gravity: 'center', size: 'sm', weight: 'bold', contents: [ { type: 'span', text: 'EGAT', color: '#FFFFFF' }, { type: 'span', text: 'EV', color: Y } ] }
    ] },
    { type: 'text', text: thDate_(todayKey_()) + ' · ' + subtitle, color: Y, size: 'xs', margin: 'sm', wrap: true },
    { type: 'box', layout: 'vertical', height: '3px', backgroundColor: Y, margin: 'md', cornerRadius: '2px', contents: [] }
  ] };
}
/** ปุ่มแบบกล่อง (คุมสีตัวอักษรได้ — ปุ่ม LINE ปกติบังคับตัวอักษรขาว) */
function btn_(label, action, primary, flex) {
  return { type: 'box', layout: 'vertical', flex: flex === undefined ? 1 : flex, cornerRadius: '8px', paddingAll: '10px', paddingStart: '14px', paddingEnd: '14px',
    backgroundColor: primary ? Y : '#262626', action: action,
    contents: [{ type: 'text', text: label, size: 'sm', weight: 'bold', align: 'center', color: primary ? BK : Y }] };
}
function footer_() {
  return { type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '12px', contents: [
    btn_('เปิด Dashboard', { type: 'uri', label: 'Dashboard', uri: CONFIG.DASHBOARD_URL }, true),
    btn_('☰ เมนู', { type: 'message', label: 'เมนู', text: 'เมนู' }, false, 0)
  ] };
}
function withQuick_(msg) {
  msg.quickReply = { items: QUICK.map(q => ({ type: 'action', action: { type: 'message', label: q[0], text: q[1] } })) };
  return msg;
}
function stageOf_(s) {
  s = String(s || '');
  if (/ส่งมอบ|แล้วเสร็จ|เสร็จสิ้น/.test(s)) return 'done';
  if (/ติดตั้ง/.test(s)) return 'install';
  if (/กำลังดำเนิน/.test(s)) return 'progress';
  if (/^รอ/.test(s)) return 'waiting';
  return s ? 'progress' : 'unknown';
}
const STAGE_LABEL = { done: 'ส่งมอบแล้ว', install: 'อยู่ระหว่างติดตั้ง', progress: 'กำลังดำเนินการ', waiting: 'รอดำเนินการ', unknown: 'ไม่ระบุ' };
const STAGE_COLOR = { done: '#2FB870', install: '#5B9BFF', progress: '#F0A534', waiting: '#A58BFF', unknown: '#7C7C7C' };

/** การ์ดเมนูหลัก 6 ปุ่ม — ใช้ในกลุ่มได้ (Rich menu แสดงเฉพาะแชท 1:1) */
function menuFlex_() {
  const ev = buildEvents_(readRows_()).filter(e => e.level !== 'lapsed');
  const urgent = ev.filter(e => e.level === 'expired' || e.level === 'critical').length;
  const soon = ev.filter(e => e.days >= 0 && e.days <= 90).length;
  const icon = n => CONFIG.BASE_URL + 'assets/icons/' + n + '.png';
  const tile = (t) => ({
    type: 'box', layout: 'vertical', flex: 1, cornerRadius: '14px', paddingAll: '10px', paddingTop: '14px', paddingBottom: '12px',
    backgroundColor: t.hl ? Y : TILE, spacing: 'xs', action: t.action,
    contents: [
      { type: 'image', url: icon(t.icon), size: '44px', aspectMode: 'fit' },
      { type: 'text', text: t.th, weight: 'bold', size: 'sm', align: 'center', color: t.hl ? BK : '#FFFFFF', margin: 'sm' },
      { type: 'text', text: t.sub, size: 'xxs', align: 'center', color: t.hl ? '#4a3a05' : '#b9a56a', wrap: true }
    ]
  });
  const T = [
    { icon: 'siren-k', th: 'สรุปด่วน', sub: urgent + ' รายการ', hl: true, action: { type: 'message', label: 'สรุป', text: 'สรุป' } },
    { icon: 'calendar-clock-y', th: 'ใกล้หมดอายุ', sub: soon + ' ใน 90 วัน', action: { type: 'message', label: 'หมดอายุ', text: 'หมดอายุ' } },
    { icon: 'chart-column-y', th: 'สถานะงาน', sub: 'STATUS', action: { type: 'message', label: 'สถานะ', text: 'สถานะ' } },
    { icon: 'search-y', th: 'ค้นหาสถานี', sub: 'SEARCH', action: { type: 'message', label: 'ค้นหา', text: 'ค้นหา' } },
    { icon: 'map-pinned-y', th: 'แผนที่สถานี', sub: 'STATION MAP', action: { type: 'uri', label: 'แผนที่', uri: CONFIG.BASE_URL + '#map' } },
    { icon: 'circle-help-y', th: 'ช่วยเหลือ', sub: 'HELP', action: { type: 'message', label: 'ช่วยเหลือ', text: 'ช่วยเหลือ' } }
  ];
  return {
    type: 'flex', altText: 'เมนู Total Solutions — แตะเพื่อเลือก',
    contents: { type: 'bubble', size: 'mega',
      styles: { body: { backgroundColor: BK } },
      body: { type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'sm', contents: [
        { type: 'box', layout: 'horizontal', paddingStart: '4px', paddingEnd: '4px', paddingBottom: '6px', contents: [
          { type: 'text', flex: 1, size: 'md', weight: 'bold', contents: [ { type: 'span', text: 'EGAT', color: '#FFFFFF' }, { type: 'span', text: 'EV', color: Y }, { type: 'span', text: '  Total Solutions', color: '#B8B8B8', size: 'xs', weight: 'regular' } ] },
          { type: 'text', text: 'กฟผ.', color: '#7C7C7C', size: 'xs', align: 'end', gravity: 'center', flex: 0 }
        ] },
        { type: 'box', layout: 'horizontal', spacing: 'sm', contents: T.slice(0, 3).map(tile) },
        { type: 'box', layout: 'horizontal', spacing: 'sm', contents: T.slice(3).map(tile) }
      ] }
    }
  };
}

function statusFlex_(rows) {
  const today = todayKey_();
  const cnt = { done: 0, install: 0, progress: 0, waiting: 0, unknown: 0 };
  let active = 0, expired = 0, value = 0; const seen = {};
  rows.forEach(r => {
    cnt[stageOf_(r.jobStatus)]++;
    const end = parseDay_(r.contractEnd);
    if (end !== null) { if (end >= today) active++; else expired++; }
    const price = parseFloat(String(r.price || '').replace(/[, ]/g, '')) || 0;
    const key = String(r.quote || '') || ('#' + r.id);
    if (price && !seen[key]) { seen[key] = 1; value += price; }
  });
  const total = rows.length || 1;
  const bar = k => ({ type: 'box', layout: 'vertical', margin: 'md', contents: [
    { type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: STAGE_LABEL[k], size: 'sm', color: '#F5F5F5', flex: 1 },
      { type: 'text', text: String(cnt[k]), size: 'sm', weight: 'bold', color: '#F5F5F5', align: 'end', flex: 0 } ] },
    { type: 'box', layout: 'vertical', height: '8px', backgroundColor: '#262626', cornerRadius: '4px', margin: 'xs', contents: [
      { type: 'box', layout: 'vertical', height: '8px', width: Math.max(2, Math.round(cnt[k] / total * 100)) + '%', backgroundColor: STAGE_COLOR[k], cornerRadius: '4px', contents: [] } ] }
  ] });
  const kv = (l, v, c) => ({ type: 'box', layout: 'horizontal', margin: 'sm', contents: [
    { type: 'text', text: l, size: 'sm', color: '#B8B8B8', flex: 1 },
    { type: 'text', text: v, size: 'sm', weight: 'bold', color: c || '#F5F5F5', align: 'end', flex: 0 } ] });
  const stages = ['done', 'install', 'progress', 'waiting', 'unknown'].filter(k => cnt[k]);
  return { type: 'flex', altText: `สถานะงาน · ${rows.length} สถานี`,
    contents: { type: 'bubble', size: 'mega', styles: DARK_, header: header_('📊 สถานะงาน', rows.length + ' สถานี'),
      body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: stages.map(bar).concat([
        { type: 'separator', margin: 'lg' },
        { type: 'text', text: 'สัญญาบริการ', weight: 'bold', size: 'sm', margin: 'lg', color: '#F5F5F5' },
        kv('ยังมีผล', String(active), '#2FB870'),
        kv('หมดอายุแล้ว (รอต่อ/อัปเดต)', String(expired), expired ? '#FF5A5A' : null),
        kv('มูลค่าสัญญารวม', (value / 1e6).toFixed(2) + ' ล้านบาท')
      ]) },
      footer: footer_() } };
}

function searchFlex_(rows, q) {
  const k = q.toLowerCase();
  const found = rows.filter(r => [r.id, r.name, r.province, r.charger, r.vendor1, r.vendor2, r.quote, r.bizType]
    .join(' ').toLowerCase().indexOf(k) >= 0);
  if (!found.length) return { type: 'text', text: `🔍 ไม่พบสถานีที่ตรงกับ "${q}"\nลองพิมพ์คำสั้นลง เช่น ชื่อจังหวัด หรือชื่อบริษัท` };
  const today = todayKey_();
  const shown = found.slice(0, 8), items = [];
  shown.forEach((r, i) => {
    const st = stageOf_(r.jobStatus), end = parseDay_(r.contractEnd);
    let endTxt = 'ยังไม่มีวันสิ้นสุดสัญญา', endCol = '#7C7C7C';
    if (end !== null) {
      const d = Math.round((end - today) / DAY);
      endTxt = 'สัญญาถึง ' + thDate_(end) + (d < 0 ? ` · เกิน ${-d} วัน` : ` · อีก ${d} วัน`);
      endCol = d < 0 ? '#FF5A5A' : d <= 30 ? '#FF5A5A' : d <= 90 ? '#F0A534' : '#B8B8B8';
    }
    if (i) items.push({ type: 'separator', margin: 'md', color: '#262626' });
    items.push({ type: 'box', layout: 'vertical', margin: 'md', action: { type: 'uri', label: 'แผนที่', uri: navUrl_(r) }, contents: [
      { type: 'text', text: '📍 ' + String(r.name), weight: 'bold', size: 'sm', wrap: true, color: '#F5F5F5' },
      { type: 'text', text: [r.province, r.charger].filter(String).join(' · ') || '-', size: 'xs', color: '#B8B8B8', wrap: true },
      { type: 'box', layout: 'horizontal', margin: 'xs', spacing: 'sm', contents: [
        { type: 'text', text: '● ' + (r.jobStatus || STAGE_LABEL[st]), size: 'xs', color: STAGE_COLOR[st], flex: 0 },
        { type: 'text', text: endTxt, size: 'xs', color: endCol, wrap: true, flex: 1 } ] }
    ] });
  });
  if (found.length > shown.length) items.push({ type: 'text', text: `และอีก ${found.length - shown.length} รายการ — ดูทั้งหมดใน Dashboard`, size: 'xs', color: '#7C7C7C', margin: 'lg', wrap: true });
  return { type: 'flex', altText: `ผลค้นหา "${q}" · ${found.length} สถานี`,
    contents: { type: 'bubble', size: 'mega', styles: DARK_, header: header_('🔍 ผลค้นหา', `"${q}" · ${found.length} สถานี`),
      body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: items }, footer: footer_() } };
}

function helpFlex_() {
  const row = (cmd, desc) => ({ type: 'box', layout: 'horizontal', margin: 'md', spacing: 'md', contents: [
    { type: 'box', layout: 'vertical', flex: 0, width: '84px', backgroundColor: '#262626', cornerRadius: '6px', paddingAll: '5px',
      contents: [{ type: 'text', text: cmd, size: 'xs', color: Y, weight: 'bold', align: 'center' }] },
    { type: 'text', text: desc, size: 'xs', color: '#B8B8B8', wrap: true, flex: 1, gravity: 'center' } ] });
  return { type: 'flex', altText: 'วิธีใช้ Total Solutions Bot',
    contents: { type: 'bubble', size: 'mega', styles: DARK_, header: header_('❓ ช่วยเหลือ', 'คำสั่งที่พิมพ์ในแชทได้'),
      body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: [
        row('เมนู', 'เปิดเมนูปุ่มกด'),
        row('สรุป', 'รายการหมดอายุแล้ว + ภายใน 30 วัน'),
        row('หมดอายุ', 'สัญญา/SIM ที่จะหมดใน 90 วัน'),
        row('สถานะ', 'จำนวนสถานีแยกตามสถานะงาน'),
        row('ค้นหา xxx', 'ค้นหาสถานีจากชื่อ จังหวัด ผู้รับเหมา'),
        row('แผนที่', 'เปิดแผนที่สถานีทั้งประเทศ'),
        row('แผนที่ xxx', 'ส่งหมุดตำแหน่งสถานี กดนำทางได้'),
        { type: 'separator', margin: 'lg' },
        { type: 'text', text: `แจ้งเตือนอัตโนมัติทุกวัน ${CONFIG.RUN_HOUR}:00 น. เมื่อเหลือ 90/60/30/15/7/3/1 วัน และสรุปทุกวันจันทร์ · แก้ข้อมูลที่ Google Sheet ได้ทันที`, size: 'xxs', color: '#7C7C7C', wrap: true, margin: 'lg' }
      ] },
      footer: { type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '12px', contents: [
        btn_('Dashboard', { type: 'uri', label: 'Dashboard', uri: CONFIG.BASE_URL }, true),
        btn_('Google Sheet', { type: 'uri', label: 'Google Sheet', uri: 'https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID + '/edit' }, false)
      ] } } };
}

/* ═══════════════ Rich Menu (แชท 1:1 กับบอท) — Run ครั้งเดียว ═══════════════ */
function setupRichMenu() {
  const props = PropertiesService.getScriptProperties();
  const old = props.getProperty('RICHMENU_ID');
  const W = 2500, H = 1686, cw = [833, 834, 833], rh = [843, 843];
  const actions = [
    { type: 'message', label: 'สรุปด่วน', text: 'สรุป' },
    { type: 'message', label: 'ใกล้หมดอายุ', text: 'หมดอายุ' },
    { type: 'message', label: 'สถานะงาน', text: 'สถานะ' },
    { type: 'postback', label: 'ค้นหาสถานี', data: 'action=search', inputOption: 'openKeyboard', fillInText: 'ค้นหา ' },
    { type: 'uri', label: 'แผนที่สถานี', uri: CONFIG.BASE_URL + '#map' },
    { type: 'message', label: 'ช่วยเหลือ', text: 'ช่วยเหลือ' }
  ];
  const areas = actions.map((a, i) => {
    const c = i % 3, r = Math.floor(i / 3);
    return { bounds: { x: cw.slice(0, c).reduce((s, v) => s + v, 0), y: r * rh[0], width: cw[c], height: rh[r] }, action: a };
  });
  const created = api_('https://api.line.me/v2/bot/richmenu', 'post',
    { size: { width: W, height: H }, selected: true, name: 'Total Solutions Menu', chatBarText: 'เมนู Total', areas: areas });
  const id = created.richMenuId;
  const img = UrlFetchApp.fetch(CONFIG.BASE_URL + 'assets/richmenu.png').getBlob().getBytes();
  api_('https://api-data.line.me/v2/bot/richmenu/' + id + '/content', 'post', img, 'image/png');
  api_('https://api.line.me/v2/bot/user/all/richmenu/' + id, 'post');
  props.setProperty('RICHMENU_ID', id);
  if (old && old !== id) { try { api_('https://api.line.me/v2/bot/richmenu/' + old, 'delete'); } catch (e) { Logger.log('ลบเมนูเก่าไม่ได้: ' + e); } }
  Logger.log('ตั้ง Rich menu สำเร็จ: %s', id);
}

/* ═══════════════ แผนที่ / พิกัด ═══════════════ */
function parseLatLng_(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  const m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{2,3}\.\d{3,})/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return (lat > 4.5 && lat < 21 && lng > 96.5 && lng < 106.5) ? { lat: lat, lng: lng } : null;
}
function geo_(r) {
  return parseLatLng_(r.location) || ((r.lat !== undefined && r.lat !== '' && r.lng !== undefined && r.lng !== '') ? parseLatLng_(r.lat + ',' + r.lng) : null);
}
function navUrl_(r) {
  const g = geo_(r);
  return g ? 'https://www.google.com/maps/dir/?api=1&destination=' + g.lat + ',' + g.lng
           : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(r.name) + ' ' + String(r.province || ''));
}
function mapFlex_(rows) {
  const withGeo = rows.filter(r => geo_(r)).length;
  return { type: 'flex', altText: 'แผนที่สถานี Total Solutions',
    contents: { type: 'bubble', size: 'mega', styles: DARK_, header: header_('🗺️ แผนที่สถานี', rows.length + ' สถานีทั่วประเทศ'),
      body: { type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'sm', contents: [
        { type: 'text', text: 'ดูหมุดทุกสถานี แยกสีตามสถานะงาน พร้อมสัญลักษณ์แจ้งเตือนสัญญา/SIM และกดนำทางได้', size: 'sm', color: '#B8B8B8', wrap: true },
        { type: 'text', text: `มีพิกัดจริง ${withGeo} / ${rows.length} สถานี`, size: 'xs', color: '#7C7C7C', margin: 'md' },
        { type: 'text', text: 'ส่งหมุดสถานีเข้าแชท: พิมพ์  แผนที่ ชื่อสถานี', size: 'xs', color: '#7C7C7C', wrap: true }
      ] },
      footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [
        btn_('🗺️ เปิดแผนที่', { type: 'uri', label: 'เปิดแผนที่', uri: CONFIG.BASE_URL + '#map' }, true)
      ] } } };
}
function locationReply_(rows, q) {
  const k = q.toLowerCase();
  const found = rows.filter(r => [r.id, r.name, r.province, r.charger].join(' ').toLowerCase().indexOf(k) >= 0);
  if (!found.length) return [withQuick_({ type: 'text', text: `🗺️ ไม่พบสถานีที่ตรงกับ "${q}"` })];
  const msgs = [];
  found.filter(r => geo_(r)).slice(0, 4).forEach(r => {
    const g = geo_(r);
    msgs.push({ type: 'location', title: String(r.name).slice(0, 100),
      address: [r.province, r.charger, r.jobStatus].filter(String).join(' · ').slice(0, 100) || '-', latitude: g.lat, longitude: g.lng });
  });
  const noGeo = found.filter(r => !geo_(r));
  let text = '';
  if (noGeo.length) text += `ยังไม่มีพิกัดในชีต ${noGeo.length} สถานี — กดค้นหาใน Google Maps:\n` +
    noGeo.slice(0, 5).map(r => '• ' + r.name + '\n  ' + navUrl_(r)).join('\n');
  if (found.length > msgs.length + Math.min(noGeo.length, 5)) text += (text ? '\n\n' : '') + `พบทั้งหมด ${found.length} สถานี — ดูทั้งหมดที่ ${CONFIG.BASE_URL}#map`;
  if (text) msgs.push({ type: 'text', text: text });
  msgs[msgs.length - 1] = withQuick_(msgs[msgs.length - 1]);
  return msgs.slice(0, 5);
}
