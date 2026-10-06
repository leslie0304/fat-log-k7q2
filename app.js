/* 轻盈计划 · 减脂健身追踪台 — 前端逻辑 v3（无外部依赖，离线可用） */
'use strict';
const APP_VERSION = 'v3.0';
console.log('%c轻盈计划 ' + APP_VERSION, 'color:#2c5a3f;font-weight:bold');
/* 手机快照模式：页面由 snapshot.js 生成、数据内嵌（window.__SNAPSHOT_DATA__），只读 */
let SNAPSHOT = typeof window !== 'undefined' && !!window.__SNAPSHOT_DATA__;
/* 静态托管模式（GitHub Pages 手机版）：boot 探测后置 true，写操作引导走微信 */
let STATIC_MODE = false;

const MEALS = ['早餐', '午餐', '晚餐', '加餐', '零食'];
const VIEW_TITLES = { dash: '今日总览', body: '身体趋势', diet: '饮食营养', train: '训练与作息', review: '每周复盘', settings: '设置' };
const S = {
  settings: null, foods: [], weights: [], exercises: [], sleeps: [], days: {},
  pendingImport: 0, view: 'dash', date: todayStr(), meal: guessMeal()
};

function todayStr(d) {
  const t = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
}
function guessMeal() {
  const h = new Date().getHours();
  return h < 10 ? '早餐' : h < 14 ? '午餐' : h < 21 ? '晚餐' : '加餐';
}
function dayOf(date) {
  if (!S.days[date]) S.days[date] = { records: [], photos: [] };
  return S.days[date];
}
function dayKcal(date) { return dayOf(date).records.reduce((s, r) => s + (+r.kcal || 0), 0); }
function dayMacros(date) {
  const acc = { protein: 0, carb: 0, fat: 0 };
  for (const r of dayOf(date).records) {
    if (r.protein != null) { acc.protein += +r.protein || 0; acc.carb += +r.carb || 0; acc.fat += +r.fat || 0; continue; }
    const f = S.foods.find(x => x.name === r.name);
    if (f) { acc.protein += (+f.protein || 0) * r.grams / 100; acc.carb += (+f.carb || 0) * r.grams / 100; acc.fat += (+f.fat || 0) * r.grams / 100; }
  }
  return { protein: Math.round(acc.protein), carb: Math.round(acc.carb), fat: Math.round(acc.fat) };
}
function latestWeight() { return S.weights.length ? +S.weights[S.weights.length - 1].kg : +S.settings.weight || 100; }
function avg7() {
  const ws = S.weights.slice(-7).map(w => +w.kg);
  return ws.length ? (ws.reduce((a, b) => a + b, 0) / ws.length).toFixed(1) : latestWeight().toFixed(1);
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ============ API ============ */
async function api(path, body) {
  if ((SNAPSHOT || STATIC_MODE) && body) { toast('手机版为只读 · 记录请发微信「文件传输助手」，晚上自动整理入账'); return { ok: true }; }
  const opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({ ok: false, error: '响应解析失败' }));
  if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
async function saveDay(date) {
  const d = dayOf(date);
  await api('/api/day', { date, records: d.records, photos: d.photos });
}
const saveFile = (name, data) => api('/api/save', { file: name, data });
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ============ 计算 / 解析 / 组合 ============ */
function calcBMR(st) {
  const base = 10 * (+st.weight) + 6.25 * (+st.height) - 5 * (+st.age);
  return Math.round(st.gender === 'female' ? base - 161 : base + 5);
}
const tdee = () => Math.round(calcBMR(S.settings) * (+S.settings.activity || 1.35));
function recKcal(food, grams) { return Math.round((food ? +food.kcal100 : 0) * grams / 100); }
function findFood(name) {
  const n = name.trim();
  return S.foods.find(f => f.name === n) || S.foods.find(f => f.name.includes(n) || n.includes(f.name));
}
function addRecord(name, grams, meal, source, extra) {
  if (SNAPSHOT) { toast('手机快照为只读 · 记录请发微信「文件传输助手」，晚上自动整理入账'); return null; }
  const food = findFood(name);
  const rec = {
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    meal: meal || S.meal, name: food ? food.name : name.trim(),
    grams: Math.round(grams), kcal: recKcal(food, grams), source: source || 'text'
  };
  if (extra) Object.assign(rec, extra);
  dayOf(S.date).records.push(rec);
  saveDay(S.date).catch(e => toast('保存失败：' + e.message));
  return rec;
}
function parseText(input) {
  const segs = input.replace(/^.*?(吃了|吃的|今天|晚上|中午|早上)/, '').split(/[、，,;；\n]+/).map(s => s.trim()).filter(Boolean);
  const items = [];
  for (const seg of segs) {
    let name = seg, grams = null, count = null;
    const m = seg.match(/^(\d+(?:\.\d+)?)(克|g|毫升|ml|ML|Gr)?\s*(.+)$/);
    if (m && m[3]) {
      if (m[2]) { grams = parseFloat(m[1]); name = m[3].trim(); }
      else { count = parseFloat(m[1]); name = m[3].trim(); }
    }
    if (name) name = name.replace(/^[个只颗枚片根杯盒勺]/, '').trim();
    if (grams === null && count === null) {
      const m2 = name.match(/^(.+?)\s*(\d+(?:\.\d+)?)(克|g|毫升|ml)$/);
      if (m2) { name = m2[1].trim(); grams = parseFloat(m2[2]); }
      else {
        const m3 = name.match(/^(.+?)\s*(\d+)\s*(个|只|颗|枚|片|根|杯|盒|勺)$/);
        if (m3) { name = m3[1].trim(); count = parseFloat(m3[2]); }
      }
    }
    const food = findFood(name);
    const g = grams !== null ? grams : count !== null ? (food && food.unitGrams ? food.unitGrams : 50) * count : (food ? food.defaultGrams : 0);
    items.push({ name: food ? food.name : name, grams: g, kcal: recKcal(food, g), ok: !!food });
  }
  return items;
}
const COMBOS = [
  { label: '🌅 早餐组合', meal: '早餐', items: [['牛奶', 250], ['燕麦(干)', 40], ['鸡蛋', 50], ['蓝莓', 50], ['核桃仁', 10], ['黑芝麻', 5]] },
  { label: '🥝 加餐组合', meal: '加餐', items: [['无糖希腊酸奶', 150], ['猕猴桃', 100]] }
];

/* ============ 照片 ============ */
async function compressImage(fileOrBlob) {
  const img = await new Promise((ok, err) => {
    const fr = new FileReader();
    fr.onload = () => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = fr.result; };
    fr.onerror = err; fr.readAsDataURL(fileOrBlob);
  });
  const max = 1280, scale = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.72).split(',')[1];
}
async function uploadPhotos(files) {
  for (const f of files) {
    if (!/^image\//.test(f.type)) continue;
    try {
      const b64 = await compressImage(f);
      const r = await api('/api/photo', { date: S.date, filename: f.name, imageBase64: b64 });
      dayOf(S.date).photos.push({ file: r.file, meal: S.meal });
    } catch (e) { toast('照片保存失败：' + e.message); }
  }
  await saveDay(S.date).catch(() => {});
  renderView();
}
async function aiRecognize(photo, el) {
  const b64 = await fetch('photos/' + S.date + '/' + encodeURIComponent(photo.file)).then(r => r.blob()).then(compressImage);
  el.textContent = '识别中…';
  try {
    const r = await api('/api/ai-vision', { imageBase64: b64 });
    showAiModal(r.content, photo);
    el.textContent = 'AI识别';
  } catch (e) { el.textContent = 'AI识别'; toast('识别失败：' + e.message); }
}
function showAiModal(content, photo) {
  let items;
  try {
    const m = String(content).match(/\[[\s\S]*\]/);
    if (!m) throw new Error('AI 未返回有效 JSON');
    items = JSON.parse(m[0]).map(x => ({ name: String(x.name || '未知'), grams: Math.round(+x.grams || 0), kcal: Math.round(+x.kcal || 0), protein: x.protein != null ? Math.round(+x.protein) : null, carb: x.carb != null ? Math.round(+x.carb) : null, fat: x.fat != null ? Math.round(+x.fat) : null }));
  } catch (e) { return toast('AI 返回无法解析，请手动记录'); }
  const box = document.getElementById('modalBox');
  box.innerHTML = '<h4>AI 识别结果（可修改后加入）</h4>' +
    items.map(it => `
      <div class="record-row">
        <span class="name">${esc(it.name)}</span>
        <span class="muted">克</span><input class="g" type="number" value="${it.grams}">
        <span class="muted">kcal</span><input class="k" type="number" value="${it.kcal}">
        <input type="checkbox" class="pick" checked>
      </div>`).join('') +
    `<div class="row" style="margin-top:14px;justify-content:flex-end">
       <button class="btn ghost" id="aiCancel">取消</button>
       <button class="btn orange" id="aiAdd">加入「${esc(photo.meal)}」</button></div>`;
  document.getElementById('modalMask').classList.remove('hidden');
  document.getElementById('aiCancel').onclick = closeModal;
  document.getElementById('aiAdd').onclick = () => {
    box.querySelectorAll('.record-row').forEach(row => {
      if (!row.querySelector('.pick').checked) return;
      const name = row.querySelector('.name').textContent;
      const grams = +row.querySelector('.g').value || 0, kcal = +row.querySelector('.k').value || 0;
      const food = findFood(name);
      dayOf(S.date).records.push({
        id: Date.now() + '_' + Math.random().toString(36).slice(2, 7), meal: photo.meal,
        name: food ? food.name : name, grams, kcal, source: 'photo'
      });
    });
    closeModal(); saveDay(S.date).then(renderView);
  };
}
function closeModal() { document.getElementById('modalMask').classList.add('hidden'); }

/* ============ 简易图表 ============ */
function prepCanvas(cv, w, h) {
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.width = Math.min(w, cv.parentElement.clientWidth - 4) + 'px';
  cv.style.height = h + 'px';
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  return ctx;
}
function barChart(cv, labels, values, goal) {
  const W = Math.max(labels.length * 46, 320), H = 200;
  const ctx = prepCanvas(cv, W, H);
  const padL = 34, padB = 22, padT = 14;
  const maxV = Math.max(goal, ...values) * 1.15 || 100;
  const plotW = W - padL - 8, plotH = H - padT - padB;
  ctx.font = '11px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - plotH * i / 4;
    ctx.fillStyle = '#8a917f'; ctx.fillText(Math.round(maxV * i / 4), 2, y + 4);
    ctx.strokeStyle = '#efe9dc'; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - 8, y); ctx.stroke();
  }
  const bw = Math.min(30, plotW / labels.length * 0.6);
  labels.forEach((lb, i) => {
    const x = padL + plotW / labels.length * (i + 0.5);
    const h = plotH * (values[i] || 0) / maxV;
    ctx.fillStyle = (values[i] || 0) > goal ? '#e8663c' : '#2c5a3f';
    ctx.beginPath(); ctx.roundRect(x - bw / 2, padT + plotH - h, bw, h, 4); ctx.fill();
    ctx.fillStyle = '#8a917f'; ctx.textAlign = 'center';
    ctx.fillText(lb.slice(5), x, H - 6);
  });
  const gy = padT + plotH - plotH * goal / maxV;
  ctx.strokeStyle = '#e8663c'; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - 8, gy); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#e8663c'; ctx.textAlign = 'left'; ctx.fillText('目标' + goal, padL + 2, gy - 4);
}
function lineChart(cv, points, target) {
  const W = Math.max(points.length * 46, 320), H = 200;
  const ctx = prepCanvas(cv, W, H);
  if (points.length < 2) { ctx.fillStyle = '#8a917f'; ctx.font = '13px sans-serif'; ctx.fillText('记录 2 次以上显示曲线', 20, 100); return; }
  const padL = 38, padB = 22, padT = 14;
  const vals = points.map(p => p.v);
  const min = Math.min(...vals, target || Infinity) - 1, max = Math.max(...vals) + 1;
  const plotW = W - padL - 10, plotH = H - padT - padB;
  const X = i => padL + plotW * i / (points.length - 1);
  const Y = v => padT + plotH - plotH * (v - min) / (max - min || 1);
  ctx.font = '11px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const v = min + (max - min) * i / 4, y = Y(v);
    ctx.fillStyle = '#8a917f'; ctx.textAlign = 'left'; ctx.fillText(v.toFixed(1), 2, y + 4);
    ctx.strokeStyle = '#efe9dc'; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - 10, y); ctx.stroke();
  }
  ctx.strokeStyle = '#2c5a3f'; ctx.lineWidth = 2; ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p.v)) : ctx.moveTo(X(i), Y(p.v)));
  ctx.stroke(); ctx.lineWidth = 1;
  points.forEach((p, i) => {
    ctx.fillStyle = '#2c5a3f'; ctx.beginPath(); ctx.arc(X(i), Y(p.v), 3, 0, 7); ctx.fill();
    if (i % Math.ceil(points.length / 8) === 0) { ctx.fillStyle = '#8a917f'; ctx.textAlign = 'center'; ctx.fillText(p.label.slice(5), X(i), H - 6); }
  });
  if (target) {
    const ty = Y(target);
    ctx.strokeStyle = '#e8663c'; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(W - 10, ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#e8663c'; ctx.textAlign = 'left'; ctx.fillText('目标' + target + 'kg', padL + 2, ty - 4);
  }
}
function ringSvg(pct, color) {
  const r = 45, c = 2 * Math.PI * r, p = Math.min(100, Math.max(0, pct));
  return `<svg width="110" height="110" viewBox="0 0 110 110">
    <circle cx="55" cy="55" r="${r}" fill="none" stroke="#efe9dc" stroke-width="9"/>
    <circle cx="55" cy="55" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}"/></svg>`;
}

/* ============ 每日激励（按日期轮换，2026-10-03 陛下钦定） ============ */
const MOTI = [
  { f: 'm1.jpg', t: '今天举起的哑铃，就是明年的线条。' },
  { f: 'm2.jpg', t: '腿蹬起来，体重就掉下来。' },
  { f: 'm3.jpg', t: '自律的人，不用别人催。' },
  { f: 'm4.jpg', t: '先动起来，状态自己会跟上。' },
];
function motiOf(date) {
  const idx = Math.floor(new Date(date + 'T00:00:00').getTime() / 86400000);
  return MOTI[((idx % MOTI.length) + MOTI.length) % MOTI.length];
}

/* ============ 每日摄入维度分析（总览页能量卡 & 简报共用逻辑） ============ */
/* 运动消耗估算：MET × 体重(kg) × 小时（Compendium of Physical Activities 常用值） */
const EX_MET = {
  '骑自行车': 5.5, '跑步': 8, '快走': 4.3, '游泳': 6, '跳绳': 10, '力量训练': 4, '瑜伽': 3,
  '椭圆机': 5, '羽毛球': 5.5, '步行': 3.5, '户外步行': 4.0, '爬楼梯': 8, '爬山': 6.5,
  '球类运动': 7, '舞蹈': 5, '拉伸': 2.3, '家务': 3.0, '通勤步行': 3.5
};
function exBurnKcal(date) {
  const w = latestWeight() || 70;
  let s = 0;
  S.exercises.filter(e => e.date === date).forEach(e => {
    const met = EX_MET[e.type] || 4;
    s += met * w * ((+e.minutes || 0) / 60);
  });
  return Math.round(s);
}
function macroAnalysis(kcal, mac, st, goal, exKcal) {
  const pT = +st.proteinTarget || 120, cT = +st.carbTarget || 215, fT = +st.fatTarget || 57;
  const out = [];
  if (!kcal) return ['今天还没记录，吃了东西随手记一下即可。'];
  const t = tdee();
  const realDeficit = t + (exKcal || 0) - kcal;
  out.push(exKcal > 0
    ? `摄入 ${kcal} kcal，运动燃烧约 ${exKcal} kcal → 实际缺口约 ${realDeficit} kcal${realDeficit < 0 ? '（今天超标，明天回归即可）' : ''}`
    : (kcal > goal ? `热量已超参考值 ${kcal - goal} kcal——一天超了不要紧，明天自然回归即可` : `热量余 ${goal - kcal} kcal，总量节奏正常`));
  if (mac.protein < pT * 0.8) out.push(`蛋白质缺口较大（差 ${pT - mac.protein}g）：下一餐加鸡蛋/鱼虾/瘦肉/无糖酸奶补上`);
  else if (mac.protein >= pT) out.push(`蛋白质已达标（${mac.protein}g），保肌肉的关键做对了`);
  else out.push(`蛋白质接近达标（差 ${pT - mac.protein}g），下一餐补一点`);
  if (mac.carb < cT * 0.5) out.push(`碳水偏低（${mac.carb}/${cT}g）：长期过低会乏力、掉发，主食别省——米饭/荞麦面/薯类都行`);
  else if (mac.carb > cT) out.push(`碳水超出 ${mac.carb - cT}g：下一餐主食减半即可`);
  else out.push(`碳水在轨道内（${mac.carb}/${cT}g）`);
  if (mac.fat > fT * 1.15) out.push(`脂肪已超 ${mac.fat - fT}g：今天剩的几餐避开油炸、肥肉和浓汤底`);
  else if (mac.fat > fT) out.push(`脂肪略超（+${mac.fat - fT}g），问题不大`);
  else out.push(`脂肪在轨道内（${mac.fat}/${fT}g）`);
  return out;
}

/* ============ 视图：今日总览 ============ */
function renderDash(el) {
  const st = S.settings, goal = +st.goalCalories || 1900;
  const kcal = dayKcal(S.date), mac = dayMacros(S.date);
  const w = latestWeight();
  const exMin = S.exercises.filter(e => e.date === S.date).reduce((s, e) => s + (+e.minutes || 0), 0);
  const exKcal = exBurnKcal(S.date);
  const exTarget = +st.activityMinutesTarget || 30;
  const startDate = S.weights.length ? S.weights[0].date : S.date;
  const planDays = Math.max(1, Math.round((new Date(S.date) - new Date(startDate)) / 86400000) + 1);
  const hour = new Date().getHours();
  const hello = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';

  let tipTitle, tipBody, tipBtn, tipView;
  if (S.pendingImport > 0) {
    tipTitle = '有新照片待整理'; tipBody = `微信自动采集了 ${S.pendingImport} 张照片，夜间将自动整理。也可现在手动补录。`;
    tipBtn = '查看照片'; tipView = 'diet';
  } else if (!S.weights.some(x => x.date === S.date)) {
    tipTitle = '补记晨间体重，趋势会更清楚'; tipBody = '每天固定时间称一次（建议晨起空腹），趋势最准。';
    tipBtn = '记录体重'; tipView = 'body';
  } else if (kcal === 0) {
    tipTitle = '今天还没记录饮食'; tipBody = '点几个常用食物按钮，或在「饮食营养」页拖入照片，10 秒搞定。';
    tipBtn = '去记录'; tipView = 'diet';
  } else {
    tipTitle = '今天按节奏推进中'; tipBody = `已摄入 ${kcal} kcal，距目标还余 ${Math.max(0, goal - kcal)} kcal。晚上自动整理会生成简报。`;
    tipBtn = '查看饮食'; tipView = 'diet';
  }

  el.innerHTML = `
  ${SNAPSHOT ? '<div class="todo-strip">📱 手机快照 · 生成于 ' + esc((typeof window !== 'undefined' && window.__SNAPSHOT_TIME__) || '') + ' · 数据截至昨晚跑批。今日记录请发微信「文件传输助手」，晚上自动整理入账。</div>' : ''}
  ${STATIC_MODE ? '<div class="todo-strip" style="background:#f3ead6">📱 手机版（只读）· 数据截至前一晚自动整理。白天记录请发微信「文件传输助手」，晚上电脑自动入账。</div>' : ''}
  ${S.pendingImport > 0 ? `<div class="todo-strip">📥 已自动采集 <b>${S.pendingImport}</b> 张微信照片，今晚 22:30 将自动整理归档；您也可以随时去「饮食营养」页手动补录。</div>` : ''}
  <div class="hero">
    <div class="hero-left">
      <div class="hi">${hello} · 陛下</div>
      <h1>陛下，今天也按<br>自己的节奏来。</h1>
      <div class="date">${S.date} · 星期${'日一二三四五六'[new Date().getDay()]}</div>
      <div class="hero-chips"><span>计划第 ${planDays} 天</span><span>距目标 ${Math.max(0, (w - (+st.targetWeight || 75))).toFixed(1)} kg</span><span>数据在本机 · 不上传</span></div>
    </div>
    <div class="hero-right">
      <div class="tip-title">${tipTitle}</div>
      <div class="tip-body">${tipBody}</div>
      <button class="hero-btn" id="heroGo">${tipBtn}</button>
    </div>
    <div class="hero-moti" id="motiBox">
      <img src="photos/motivation/${motiOf(S.date).f}" alt="今日激励" onerror="document.getElementById('motiBox').classList.add('noimg')">
      <div class="moti-cap">${motiOf(S.date).t}</div>
    </div>
  </div>

  <div class="dash-grid">
    <div>
      <div class="card">
        <h3>今日能量 <span class="link" data-go="diet">调整可在饮食页 ›</span></h3>
        <div class="energy-top">
          <div class="energy-big"><span class="have">${kcal}<small>kcal 已摄入</small></span></div>
          <div class="energy-big"><span class="goal">${goal}<small>kcal 新参考值</small></span></div>
        </div>
        <div class="macro m-kcal"><div class="m-head"><b>热量</b><span>${kcal} / ${goal} kcal</span></div><div class="bar"><i style="width:${Math.min(100, kcal / goal * 100)}%"></i></div></div>
        <div class="macro m-protein"><div class="m-head"><b>蛋白质</b><span>${mac.protein} / ${st.proteinTarget}g</span></div><div class="bar"><i style="width:${Math.min(100, mac.protein / (+st.proteinTarget || 120) * 100)}%"></i></div></div>
        <div class="macro m-carb"><div class="m-head"><b>碳水</b><span>${mac.carb} / ${st.carbTarget}g</span></div><div class="bar"><i style="width:${Math.min(100, mac.carb / (+st.carbTarget || 215) * 100)}%"></i></div></div>
        <div class="macro m-fat"><div class="m-head"><b>脂肪</b><span>${mac.fat} / ${st.fatTarget}g</span></div><div class="bar"><i style="width:${Math.min(100, mac.fat / (+st.fatTarget || 57) * 100)}%"></i></div></div>
        <div class="ana"><div class="ana-title">今日摄入分析</div>${macroAnalysis(kcal, mac, st, goal, exKcal).map(t => `<div class="ana-line">${t}</div>`).join('')}</div>
      </div>
      <div class="card">
        <h3>快速记录 <span class="link" data-go="diet">更多 ›</span></h3>
        <div class="meal-tabs">${MEALS.map(m => `<button class="meal-tab ${m === S.meal ? 'active' : ''}" data-meal="${m}">${m}</button>`).join('')}</div>
        <div class="chips">${S.foods.slice(0, 10).map((f, i) => `<button class="chip" data-food="${i}">${esc(f.name)}</button>`).join('')}</div>
        <div class="text-input-row">
          <input id="txtInput" placeholder="文字记录，如：250克菠菜、80克水浸金枪鱼、2个鸡蛋">
          <button class="btn" id="txtAdd">解析</button>
        </div>
      </div>
    </div>
    <div>
      <div class="card">
        <h3>身体趋势 <span class="link" data-go="body">查看 ›</span></h3>
        <div class="body-num"><span class="v">${w.toFixed(1)}</span><span class="u">kg 当前体重</span></div>
        <div class="body-sub">
          <div class="pill"><div class="k">7 日均衡</div><div class="v">${avg7()}<em> kg</em></div></div>
          <div class="pill"><div class="k">距目标</div><div class="v">${Math.max(0, w - (+st.targetWeight || 75)).toFixed(1)}<em> kg</em></div></div>
        </div>
      </div>
      <div class="card">
        <h3>今日活动 <span class="link" data-go="train">记录 ›</span></h3>
        <div class="ring-wrap">
          <div class="ring">${ringSvg(exMin / exTarget * 100, '#e8663c')}
            <div class="ring-txt"><span class="v">${Math.round(exMin / exTarget * 100)}%</span><span class="k">达成</span></div>
          </div>
          <div class="ring-side">
            <div class="big">${exMin}<small> / ${exTarget} 分钟</small></div>
            <div class="sub">${exMin >= exTarget ? '今日活动达标 ✓' : 'BMI≥32 起步建议：快走 / 游泳等低冲击'}</div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>今日照片 <span class="link" data-go="diet">整理 ›</span></h3>
        <div class="photo-grid">${dayOf(S.date).photos.slice(-6).map(p => `<div class="photo-item"><img src="photos/${S.date}/${encodeURIComponent(p.file)}" data-open="photos/${S.date}/${encodeURIComponent(p.file)}"></div>`).join('') || '<div class="muted">白天微信拍的照片，会自动出现在这里</div>'}</div>
      </div>
    </div>
  </div>`;

  el.querySelector('#heroGo').onclick = () => { S.view = tipView || 'diet'; renderView(); };
  el.querySelectorAll('.link[data-go]').forEach(a => a.onclick = () => { S.view = a.dataset.go; renderView(); });
  el.querySelectorAll('.meal-tab').forEach(b => b.onclick = () => { S.meal = b.dataset.meal; renderDash(el); });
  el.querySelectorAll('.chip').forEach(b => b.onclick = () => {
    const f = S.foods[+b.dataset.food];
    addRecord(f.name, f.defaultGrams); toast(`已记录 ${f.name} ${f.defaultGrams}${f.unit || '克'}`); renderView();
  });
  const txtAdd = () => {
    const v = el.querySelector('#txtInput').value.trim(); if (!v) return;
    parseText(v).forEach(it => addRecord(it.name, it.grams));
    toast('已解析记录'); el.querySelector('#txtInput').value = '';
    saveDay(S.date).then(renderView);
  };
  el.querySelector('#txtAdd').onclick = txtAdd;
  el.querySelector('#txtInput').onkeydown = e => { if (e.key === 'Enter') txtAdd(); };
  el.querySelectorAll('img[data-open]').forEach(im => im.onclick = () => window.open(im.dataset.open, '_blank'));
}

/* ============ 视图：饮食营养 ============ */
function renderDiet(el) {
  const d = dayOf(S.date);
  const kcal = dayKcal(S.date), goal = +S.settings.goalCalories || 1900;
  const base = new Date(S.date + 'T00:00:00');
  const prev = todayStr(new Date(base.getTime() - 86400000));
  const next = todayStr(new Date(base.getTime() + 86400000));
  el.innerHTML = `
  <div class="date-nav">
    <button id="dPrev">‹</button><input type="date" id="dDate" value="${S.date}"><button id="dNext">›</button>
    ${S.days[prev] && S.days[prev].records.length ? '<button class="btn ghost small" id="copyPrev">📋 重复前一天</button>' : ''}
    <span class="muted">${S.date === todayStr() ? '今天' : esc(S.date)} · 已摄入 ${kcal} / ${goal} kcal</span>
  </div>
  <div class="card">
    <h3>快速记录</h3>
    <div class="meal-tabs">${MEALS.map(m => `<button class="meal-tab ${m === S.meal ? 'active' : ''}" data-meal="${m}">${m}</button>`).join('')}</div>
    <div class="row" style="margin-bottom:10px">${COMBOS.map((c, i) => `<button class="combo-btn" data-combo="${i}">${c.label}</button>`).join('')}</div>
    <div class="chips">${S.foods.map((f, i) => `<button class="chip" data-food="${i}">${esc(f.name)} <span class="muted">${f.defaultGrams}${(f.unit || '克').replace('毫升', 'ml')}</span></button>`).join('')}</div>
    <div class="text-input-row">
      <input id="txtInput" placeholder="文字记录，如：250克菠菜、80克水浸金枪鱼、2个鸡蛋">
      <button class="btn" id="txtAdd">解析</button>
    </div>
  </div>
  <div class="card">
    <h3>照片（白天微信拍的会自动进来，也可手动拖入）</h3>
    <div class="dropzone" id="dropzone">从微信窗口把照片拖到这里，或点击选择文件<br><span class="muted">建议白天用微信「文件传输助手」以「文件」方式发照片，系统每 2 分钟自动采集一次</span></div>
    <input type="file" id="fileInput" accept="image/*" multiple class="hidden">
    <div class="photo-grid" id="photoGrid"></div>
  </div>
  <div class="card"><h3>当日明细</h3><div id="recList"></div></div>`;

  el.querySelector('#dPrev').onclick = () => { S.date = prev; renderView(); };
  el.querySelector('#dNext').onclick = () => { if (S.date < todayStr()) { S.date = next; renderView(); } };
  el.querySelector('#dDate').onchange = e => { S.date = e.target.value || S.date; renderView(); };
  el.querySelectorAll('.meal-tab').forEach(b => b.onclick = () => { S.meal = b.dataset.meal; renderDiet(el); });
  el.querySelectorAll('.chip').forEach(b => b.onclick = () => {
    const f = S.foods[+b.dataset.food];
    addRecord(f.name, f.defaultGrams); toast(`已记录 ${f.name}`); renderDiet(el);
  });
  el.querySelectorAll('.combo-btn').forEach(b => b.onclick = () => {
    const c = COMBOS[+b.dataset.combo];
    c.items.forEach(([n, g]) => addRecord(n, g, c.meal, 'combo'));
    toast('已记录' + c.label); renderDiet(el);
  });
  const cp = el.querySelector('#copyPrev');
  if (cp) cp.onclick = () => {
    dayOf(prev).records.forEach(r => d.records.push({ ...r, id: r.id + '_c' + Math.random().toString(36).slice(2, 5) }));
    saveDay(S.date).then(() => { toast('已复制前一日记录'); renderView(); });
  };
  const txtAdd = () => {
    const v = el.querySelector('#txtInput').value.trim(); if (!v) return;
    const items = parseText(v);
    items.forEach(it => addRecord(it.name, it.grams));
    const miss = items.filter(i => !i.ok).length;
    toast('已记录 ' + items.length + ' 项' + (miss ? `（${miss} 项不在食物库，热量为 0，请手动补）` : ''));
    el.querySelector('#txtInput').value = '';
    saveDay(S.date).then(renderView);
  };
  el.querySelector('#txtAdd').onclick = txtAdd;
  el.querySelector('#txtInput').onkeydown = e => { if (e.key === 'Enter') txtAdd(); };

  const dz = el.querySelector('#dropzone'), fi = el.querySelector('#fileInput');
  dz.onclick = () => fi.click();
  fi.onchange = () => { uploadPhotos([...fi.files]); fi.value = ''; };
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => uploadPhotos([...e.dataTransfer.files]));

  const pg = el.querySelector('#photoGrid');
  pg.innerHTML = d.photos.map((p, i) => `
    <div class="photo-item">
      <img src="photos/${S.date}/${encodeURIComponent(p.file)}" data-open="photos/${S.date}/${encodeURIComponent(p.file)}">
      <select data-i="${i}">${MEALS.map(m => `<option ${m === p.meal ? 'selected' : ''}>${m}</option>`).join('')}</select>
      ${S.settings.aiKey ? `<button class="ai-btn" data-i="${i}">AI识别</button>` : ''}
    </div>`).join('') || '<div class="muted">本日还没有照片</div>';
  pg.querySelectorAll('select').forEach(s => s.onchange = () => { d.photos[+s.dataset.i].meal = s.value; saveDay(S.date).then(() => { toast('照片餐次已改为「' + s.value + '」'); renderView(); }); });
  pg.querySelectorAll('img').forEach(im => im.onclick = () => window.open(im.dataset.open, '_blank'));
  pg.querySelectorAll('.ai-btn').forEach(b => b.onclick = () => aiRecognize(d.photos[+b.dataset.i], b));

  /* 明细列表 */
  const box = el.querySelector('#recList');
  let html = '', grand = 0;
  for (const m of MEALS) {
    const recs = d.records.filter(r => r.meal === m);
    if (!recs.length) continue;
    const sub = recs.reduce((s, r) => s + (+r.kcal || 0), 0); grand += sub;
    html += `<div class="meal-title">${m}<span class="sub">${sub} kcal</span></div>` +
      recs.map(r => `<div class="record-row" data-id="${esc(r.id)}">
        <input class="rname" value="${esc(r.name)}" title="可修改菜名">
        <input class="grams" type="number" value="${r.grams}"><span class="muted">克</span>
        <span class="kcal">${r.kcal || 0}</span><button class="del">✕</button></div>`).join('');
  }
  box.innerHTML = html || '<div class="muted" style="padding:8px 0">本日还没有记录</div>';
  if (grand) box.insertAdjacentHTML('beforeend', `<div class="meal-title" style="text-align:right">合计：${grand} kcal</div>`);
  box.querySelectorAll('.record-row').forEach(row => {
    const rec = d.records.find(r => r.id === row.dataset.id); if (!rec) return;
    row.querySelector('.rname').onchange = e => {
      rec.name = e.target.value.trim() || rec.name;
      const food = findFood(rec.name);
      if (food) rec.kcal = recKcal(food, rec.grams);
      saveDay(S.date).then(renderView);
    };
    row.querySelector('.grams').onchange = e => {
      rec.grams = +e.target.value || 0;
      const food = findFood(rec.name);
      rec.kcal = food ? recKcal(food, rec.grams) : rec.kcal;
      saveDay(S.date).then(renderView);
    };
    row.querySelector('.del').onclick = () => {
      d.records = d.records.filter(r => r.id !== rec.id);
      saveDay(S.date).then(renderView);
    };
  });
}

/* ============ 视图：身体趋势 ============ */
function renderBody(el) {
  const w = latestWeight();
  el.innerHTML = `
  <div class="card">
    <h3>⚖️ 体重打卡</h3>
    <div class="row">
      <input type="date" id="wDate" value="${todayStr()}" style="border:1px solid var(--line);border-radius:10px;padding:8px">
      <input type="number" step="0.1" id="wKg" placeholder="kg" style="width:90px;border:1px solid var(--line);border-radius:10px;padding:8px">
      <button class="btn orange" id="wAdd">记录</button>
      <span class="muted">当前 ${w.toFixed(1)}kg · 目标 ${S.settings.targetWeight}kg · 还差 ${(w - (+S.settings.targetWeight || 75)).toFixed(1)}kg</span>
    </div>
    <div class="chart-box" style="margin-top:12px"><canvas id="chartW"></canvas></div>
  </div>
  <div class="card">
    <h3>历史记录</h3>
    ${S.weights.length ? `<table><tr><th>日期</th><th>体重 kg</th><th>较上次</th></tr>
      ${S.weights.slice(-15).reverse().map((x, i, arr) => {
        const prev = arr[i + 1];
        const diff = prev ? (x.kg - prev.kg) : null;
        return `<tr><td>${esc(x.date)}</td><td class="num">${(+x.kg).toFixed(1)}</td>
        <td class="num ${diff == null ? 'muted' : diff <= 0 ? 'good' : 'bad'}">${diff == null ? '—' : (diff > 0 ? '+' : '') + diff.toFixed(1)}</td></tr>`;
      }).join('')}</table>` : '<div class="muted">还没有体重记录</div>'}
  </div>
  <div class="card"><h3>💡 提示</h3><div class="muted" style="line-height:1.9">
    · 建议每天<strong>晨起空腹、同一时间</strong>称重，波动 1–2kg 属正常（水分/肠道内容物）。<br>
    · 看趋势比看单日更重要：连续 2 周不降再启动平台期分析。<br>
    · BMI≥32：运动前建议先做体检（血压/血糖/血脂/关节），本工具不提供医疗建议。
  </div></div>`;
  lineChart(el.querySelector('#chartW'), S.weights.slice(-30).map(x => ({ label: x.date, v: +x.kg })), +S.settings.targetWeight || null);
  el.querySelector('#wAdd').onclick = () => {
    const kg = parseFloat(el.querySelector('#wKg').value);
    if (!kg) return toast('请输入体重');
    const date = el.querySelector('#wDate').value || todayStr();
    S.weights = S.weights.filter(x => x.date !== date);
    S.weights.push({ date, kg }); S.weights.sort((a, b) => a.date < b.date ? -1 : 1);
    S.settings.weight = kg;
    saveFile('weights', S.weights).then(() => saveFile('settings', S.settings)).then(() => { toast('体重已记录'); renderView(); });
  };
}

/* ============ 视图：训练与作息 ============ */
function renderTrain(el) {
  el.innerHTML = `
  <div class="card">
    <h3>🏃 运动打卡</h3>
    <div class="row">
      <select id="eType" style="border:1px solid var(--line);border-radius:10px;padding:8px">
        <option>快走</option><option>游泳</option><option>力量训练</option><option>骑行</option><option>拉伸/瑜伽</option><option>其他</option>
      </select>
      <input type="number" id="eMin" placeholder="分钟" style="width:90px;border:1px solid var(--line);border-radius:10px;padding:8px">
      <input type="date" id="eDate" value="${todayStr()}" style="border:1px solid var(--line);border-radius:10px;padding:8px">
      <button class="btn" id="eAdd">记录</button>
    </div>
    ${tableRecent(S.exercises.slice(-10).reverse(), 'type')}
  </div>
  <div class="card">
    <h3>😴 睡眠打卡</h3>
    <div class="row">
      <input type="number" step="0.5" id="sH" placeholder="小时" style="width:90px;border:1px solid var(--line);border-radius:10px;padding:8px">
      <select id="sQ" style="border:1px solid var(--line);border-radius:10px;padding:8px">
        <option value="5">很好</option><option value="4">较好</option><option value="3" selected>一般</option><option value="2">较差</option><option value="1">很差</option>
      </select>
      <input type="date" id="sDate" value="${todayStr()}" style="border:1px solid var(--line);border-radius:10px;padding:8px">
      <button class="btn" id="sAdd">记录</button>
    </div>
    ${tableRecent(S.sleeps.slice(-10).reverse(), 'sleep')}
    ${huaweiSleepPanel(S.sleeps)}
  </div>
  <div class="card"><h3>💡 起步阶段建议（BMI≥32 适用）</h3><div class="muted" style="line-height:1.9">
    · 以<strong>快走、游泳、椭圆机</strong>等低冲击运动为主，保护膝踝关节，从每次 20–30 分钟开始。<br>
    · 睡眠目标 7–9 小时；睡前 90 分钟少糖少屏。<br>
    · 如有头晕、心慌、关节疼痛，立即停止并咨询医生。
  </div></div>`;
  el.querySelector('#eAdd').onclick = () => {
    const min = parseInt(el.querySelector('#eMin').value);
    if (!min) return toast('请输入时长');
    S.exercises.push({ date: el.querySelector('#eDate').value || todayStr(), type: el.querySelector('#eType').value, minutes: min });
    saveFile('exercises', S.exercises).then(() => { toast('运动已记录'); renderView(); });
  };
  el.querySelector('#sAdd').onclick = () => {
    const h = parseFloat(el.querySelector('#sH').value);
    if (!h) return toast('请输入时长');
    S.sleeps.push({ date: el.querySelector('#sDate').value || todayStr(), hours: h, quality: +el.querySelector('#sQ').value });
    saveFile('sleeps', S.sleeps).then(() => { toast('睡眠已记录'); renderView(); });
  };
}
function tableRecent(rows, kind) {
  if (!rows.length) return '<div class="muted" style="margin-top:8px">还没有记录</div>';
  const Q = { 5: '很好', 4: '较好', 3: '一般', 2: '较差', 1: '很差' };
  return `<table style="margin-top:10px"><tr><th>日期</th><th>${kind === 'type' ? '类型' : '时长(h)'}</th><th>${kind === 'type' ? '分钟' : '质量'}</th></tr>` +
    rows.map(r => `<tr><td>${esc(r.date)}</td><td class="num">${esc(kind === 'type' ? r.type : r.hours)}</td><td class="num">${esc(kind === 'type' ? r.minutes : (Q[r.quality] || r.quality))}</td></tr>`).join('') + '</table>';
}

/* ============ 华为手环睡眠详情（由夜间整理从睡眠长图读取写入） ============ */
function huaweiSleepPanel(sleeps) {
  const withDetail = (sleeps || []).filter(s => s.score || s.hrv || s.spo2);
  if (!withDetail.length) {
    return `<div class="muted" style="margin-top:12px">⌚️ 华为手环睡眠详情：暂未读到。<br>
    <span style="font-size:12px">提示：睡眠长图请用「文件」方式发到文件传输助手（jpg 明文可读）；发「照片」是微信压缩格式，读不出内容。</span></div>`;
  }
  const s = withDetail[withDetail.length - 1];
  const mm = v => v == null ? '—' : `${Math.floor(v / 60)}时${String(v % 60).padStart(2, '0')}分`;
  const grade = (v, good, bad) => v == null ? '' : (v >= good ? 'good' : v <= bad ? 'bad' : 'warn');
  return `
  <div style="margin-top:16px;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--cream,#fdfbf6)">
    <div style="font-weight:600;margin-bottom:4px">⌚️ 华为手环睡眠详情 <span class="muted" style="font-weight:400;font-size:12px">${esc(s.date)}${s.bedtime ? ` · 入睡 ${esc(s.bedtime)} → 醒来 ${esc(s.waketime)}` : ''}</span></div>
    <div class="stat-cards" style="margin:10px 0 4px">
      <div class="stat-card"><div class="v ${grade(s.score, 80, 60)}">${s.score ?? '—'}</div><div class="k">睡眠评分</div></div>
      <div class="stat-card"><div class="v">${mm(s.deepMin)}</div><div class="k">深睡 ${s.deepPct != null ? s.deepPct + '%' : ''}</div></div>
      <div class="stat-card"><div class="v">${mm(s.remMin)}</div><div class="k">快速动眼 ${s.remPct != null ? s.remPct + '%' : ''}</div></div>
      <div class="stat-card"><div class="v ${grade(s.efficiency, 85, 70)}">${s.efficiency != null ? s.efficiency + '%' : '—'}</div><div class="k">清醒次数 ${s.awakeCount ?? '—'}</div></div>
      <div class="stat-card"><div class="v ${grade(s.hrv, 60, 40)}">${s.hrv ?? '—'}<span style="font-size:12px">ms</span></div><div class="k">心率变异性</div></div>
      <div class="stat-card"><div class="v ${grade(s.restingHr, 0, 70)}">${s.restingHr ?? '—'}</div><div class="k">静息心率 次/分</div></div>
      <div class="stat-card"><div class="v ${grade(s.spo2, 95, 92)}">${s.spo2 != null ? s.spo2 + '%' : '—'}</div><div class="k">平均血氧</div></div>
      <div class="stat-card"><div class="v">${s.respRate ?? '—'}</div><div class="k">呼吸 次/分</div></div>
    </div>
    <div class="muted" style="font-size:12px;margin-top:8px">
      浅睡 ${mm(s.lightMin)}（${s.lightPct ?? '—'}%）· 清醒占比 ${s.awakePct ?? '—'}% ·
      夜间心率 ${s.peakHR ?? '—'} 次/分 ·
      建议：${s.score >= 80 ? '睡眠质量良好，保持作息。' : s.score >= 70 ? '尚可，争取把入睡时间提前到 23:30 前。' : '评分偏低，重点是固定入睡时间与睡前 90 分钟不看屏幕。'}
    </div>
  </div>`;
}

/* ============ 视图：每周复盘 ============ */
function renderReview(el) {
  const st = S.settings, goal = +st.goalCalories || 1900;
  const pT = +st.proteinTarget || 120, cT = +st.carbTarget || 215, fT = +st.fatTarget || 57;
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const dt = todayStr(new Date(Date.now() - i * 86400000));
    days.push({ date: dt, kcal: S.days[dt] ? dayKcal(dt) : 0, has: !!(S.days[dt] && S.days[dt].records.length) });
  }
  const last7 = days.slice(7);
  const valid = last7.filter(d => d.has);
  const n = valid.length || 1;
  const avg = valid.length ? Math.round(valid.reduce((s, d) => s + d.kcal, 0) / n) : 0;
  const okDays = valid.filter(d => d.kcal <= goal).length;
  const rate = valid.length ? Math.round(okDays / n * 100) : 0;
  const w7 = S.weights.filter(w => w.date >= last7[0].date);
  const wDelta = w7.length >= 2 ? (w7[w7.length - 1].kg - w7[0].kg) : null;
  const wNow = latestWeight();

  /* ---- 三大营养素 7 日均值与达标率 ---- */
  let sP = 0, sC = 0, sF = 0;
  valid.forEach(d => { const m = dayMacros(d.date); sP += m.protein; sC += m.carb; sF += m.fat; });
  const aP = Math.round(sP / n), aC = Math.round(sC / n), aF = Math.round(sF / n);
  const rP = valid.length ? Math.round(valid.filter(d => dayMacros(d.date).protein >= pT * 0.9).length / n * 100) : 0;
  const rC = valid.length ? Math.round(valid.filter(d => { const m = dayMacros(d.date); return m.carb >= cT * 0.5 && m.carb <= cT; }).length / n * 100) : 0;
  const rF = valid.length ? Math.round(valid.filter(d => dayMacros(d.date).fat <= fT).length / n * 100) : 0;

  /* ---- 运动 7 日：累计分钟 + MET 折算消耗（目标 = 设置里的每日活动目标 × 7，下限兜 WHO 150） ---- */
  const exMinTarget = Math.max(150, (+st.activityMinutesTarget || 30) * 7);
  let exMin = 0, exK = 0, exDays = 0;
  last7.forEach(d => {
    const mins = S.exercises.filter(e => e.date === d.date).reduce((s, e) => s + (+e.minutes || 0), 0);
    if (mins > 0) exDays++;
    exMin += mins; exK += exBurnKcal(d.date);
  });

  /* ---- 睡眠 7 日 ---- */
  const sl7 = S.sleeps.filter(s => last7.some(d => d.date === s.date));
  const slH = sl7.length ? (sl7.reduce((s, x) => s + (+x.hours || 0), 0) / sl7.length) : 0;
  const slQ = sl7.length ? (sl7.reduce((s, x) => s + (+x.quality || 0), 0) / sl7.length) : 0;

  /* ---- 平台期预警：14 天体重几乎没动 ---- */
  const w14 = S.weights.filter(x => x.date >= todayStr(new Date(Date.now() - 13 * 86400000)));
  const plateau = w14.length >= 3 && Math.abs(w14[w14.length - 1].kg - w14[0].kg) < 0.3;

  /* ---- 目标重算建议（TDEE 随体重自动下行） ---- */
  const sugGoal = Math.round(tdee() - (+st.deficitTarget || 600));
  const needDown = sugGoal < goal - 20;
  const sugP = Math.round(wNow * 1.2), sugF = Math.round(wNow * 0.6);
  const sugC = Math.max(0, Math.round((sugGoal - sugP * 4 - sugF * 9) / 4));

  /* ---- 本周结论（工作台内展示，不出周报文件） ---- */
  const sug = [];
  sug.push(rate >= 70 ? `缺口达标率 ${rate}%，节奏稳，保持这个吃法。` : `缺口达标率仅 ${rate}%，超出的日子多在聚餐/外食，下次提前控一控。`);
  if (aP < pT * 0.9) sug.push(`蛋白 7 日均 ${aP}g（目标 ${pT}g），每天补一份鸡蛋 / 无糖酸奶 / 鱼虾最省事。`);
  if (aC < cT * 0.5) sug.push(`碳水 7 日均 ${aC}g 偏低，长期过低会乏力掉发，主食别省。`);
  if (aF > fT) sug.push(`脂肪 7 日均 ${aF}g，超目标 ${aF - fT}g，明天起换清蒸白灼、少喝汤底。`);
  if (exMin < exMinTarget) sug.push(`运动 7 日累计 ${exMin} 分钟（目标 ${exMinTarget}），只动了 ${exDays} 天，建议每天快走 20–30 分钟补齐。`);
  else sug.push(`运动 7 日累计 ${exMin} 分钟，已达${exMinTarget} 分钟目标，保持这个节奏。`);
  if (slH && slH < 7) sug.push(`睡眠 7 日均 ${slH.toFixed(1)}h，偏少会拖慢减脂节奏（还会抬高食欲），今晚早点躺。`);
  if (plateau) sug.push('⚠️ 近两周体重几乎没变化，建议做一次平台期诊断（核对热量实际值、肌肉量、水分与睡眠）。');

  el.innerHTML = `
  <div class="card">
    <h3>近 7 天概览</h3>
    <div class="stat-cards">
      <div class="stat-card"><div class="v">${valid.length ? avg : '—'}</div><div class="k">日均摄入 kcal</div></div>
      <div class="stat-card"><div class="v ${rate >= 70 ? 'good' : 'bad'}">${valid.length ? rate + '%' : '—'}</div><div class="k">缺口达成率（≤${goal}）</div></div>
      <div class="stat-card"><div class="v">${okDays}/${valid.length || 0}</div><div class="k">达标天数</div></div>
      <div class="stat-card"><div class="v ${wDelta !== null && wDelta <= 0 ? 'good' : wDelta === null ? '' : 'bad'}">${wDelta === null ? '—' : (wDelta > 0 ? '+' : '') + wDelta.toFixed(1) + 'kg'}</div><div class="k">本周体重变化</div></div>
      <div class="stat-card"><div class="v">${(latestWeight() || 0).toFixed(1)}<em>kg</em></div><div class="k">最新体重（距目标 ${((latestWeight() || 0) - (+S.settings.targetWeight || 75)).toFixed(1)}kg）</div></div>
    </div>
    <div class="muted">理论减重速度：${((+S.settings.deficitTarget || 600) * 7 / 7700).toFixed(2)} kg/周。看趋势，不纠结单日波动。</div>
  </div>
  <div class="card">
    <h3>三大营养素 7 日趋势</h3>
    <div class="macro m-protein"><div class="m-head"><b>蛋白 7 日均</b><span>${aP} / ${pT} g · 达标率 ${rP}%</span></div><div class="bar"><i style="width:${Math.min(100, aP / pT * 100)}%"></i></div></div>
    <div class="macro m-carb"><div class="m-head"><b>碳水 7 日均</b><span>${aC} / ${cT} g · 达标率 ${rC}%</span></div><div class="bar"><i style="width:${Math.min(100, aC / cT * 100)}%"></i></div></div>
    <div class="macro m-fat"><div class="m-head"><b>脂肪 7 日均</b><span>${aF} / ${fT} g · 达标率 ${rF}%</span></div><div class="bar"><i style="width:${Math.min(100, aF / fT * 100)}%"></i></div></div>
  </div>
  <div class="card">
    <h3>运动与睡眠 7 日</h3>
    <div class="stat-cards">
      <div class="stat-card"><div class="v ${exMin >= exMinTarget ? 'good' : ''}">${exMin}<em>min</em></div><div class="k">运动累计（目标${exMinTarget}）</div></div>
      <div class="stat-card"><div class="v">${exK}<em>kcal</em></div><div class="k">运动消耗（MET折算）</div></div>
      <div class="stat-card"><div class="v">${exDays}<em>天</em></div><div class="k">有运动天数</div></div>
      <div class="stat-card"><div class="v ${slH >= 7 ? 'good' : 'bad'}">${slH ? slH.toFixed(1) : '—'}<em>h</em></div><div class="k">日均睡眠（7-9h）</div></div>
      <div class="stat-card"><div class="v">${slQ ? slQ.toFixed(1) : '—'}<em>/5</em></div><div class="k">睡眠质量</div></div>
    </div>
    <div class="muted">运动消耗 = MET × 体重 × 时长（体重取当前 ${(latestWeight() || 0).toFixed(1)}kg），不进摄入账，只进消耗侧影响实际缺口。<br>
    口径提醒：TDEE 已含「活动系数 1.3（久坐）」的日常活动量，额外运动只应累加<b>超出日常部分</b>；若当日运动量很大、实际缺口已远超目标，吃回来一点是合理的，别硬扛。</div>
  </div>
  <div class="card">
    <h3>目标重算建议</h3>
    ${needDown ? `<div class="ana" style="border:0;padding:0;margin-top:0">
      <div class="ana-line">体重降到 ${wNow.toFixed(1)}kg 后，TDEE ≈ ${tdee()} kcal，按缺口 ${st.deficitTarget || 600} 折算，建议把每日目标从 <b>${goal}</b> 调到 <b>${sugGoal}</b> kcal。</div>
      <div class="ana-line">配套营养素：蛋白 ${sugP}g / 碳水 ${sugC}g / 脂肪 ${sugF}g（按 1.2g/kg 蛋白、0.6g/kg 脂肪、余量碳水）。</div>
    </div>
    <div class="row" style="margin-top:10px"><button class="btn" id="rvApply">按建议重设目标（${sugGoal} kcal）</button></div>`
      : `<div class="ana" style="border:0;padding:0;margin-top:0"><div class="ana-line">当前目标 ${goal} kcal 与公式建议 ${sugGoal} kcal 基本一致（差 ${Math.abs(goal - sugGoal)} kcal），暂不需要调整。</div></div>`}
  </div>
  ${plateau ? `<div class="card" style="border-left:3px solid var(--orange)">
    <h3>⚠️ 平台期预警</h3>
    <div class="muted">近两周体重变化不足 0.3kg。建议按平台期决策树逐项排查：①实际摄入是否高于记录 ②脂肪/碳水比例是否失衡 ③水分与睡眠波动 ④是否需要一次 refeed（连续 3 天回到基础代谢）。</div>
  </div>` : ''}
  <div class="card">
    <h3>本周结论与下周动作</h3>
    <div class="ana" style="border:0;padding:0;margin:0">${sug.map(s => `<div class="ana-line">${s}</div>`).join('')}</div>
  </div>
  <div class="card"><h3>近 14 天热量摄入（绿=达标，橙=超标）</h3><div class="chart-box"><canvas id="cK"></canvas></div></div>
  <div class="card"><h3>体重趋势</h3><div class="chart-box"><canvas id="cW"></canvas></div></div>
  <div class="card">
    <h3>近 7 天明细</h3>
    <table><tr><th>日期</th><th>摄入 kcal</th><th>vs 目标${goal}</th></tr>
    ${last7.map(d => `<tr><td>${d.date}</td><td class="num">${d.has ? d.kcal : '—'}</td>
      <td class="num ${!d.has ? 'muted' : d.kcal <= goal ? 'good' : 'bad'}">${!d.has ? '未记录' : d.kcal <= goal ? '达标 ✓' : '+' + (d.kcal - goal)}</td></tr>`).join('')}
    </table>
  </div>`;
  const ap = el.querySelector('#rvApply');
  if (ap) ap.onclick = async () => {
    st.goalCalories = sugGoal; st.proteinTarget = sugP; st.carbTarget = sugC; st.fatTarget = sugF;
    await saveFile('settings', st); toast('目标已重设为 ' + sugGoal + ' kcal'); renderView();
  };
  barChart(el.querySelector('#cK'), days.map(d => d.date), days.map(d => d.kcal), goal);
  lineChart(el.querySelector('#cW'), S.weights.slice(-30).map(x => ({ label: x.date, v: +x.kg })), +S.settings.targetWeight || null);
}

/* ============ 视图：设置 ============ */
function renderSettings(el) {
  const st = S.settings;
  const bmr = calcBMR(st), t = tdee();
  el.innerHTML = `
  <div class="card">
    <h3>基础信息（保存后自动重算）</h3>
    <div class="form-grid">
      <div class="form-item"><label>身高 cm</label><input id="stH" type="number" value="${st.height}"></div>
      <div class="form-item"><label>当前体重 kg</label><input id="stW" type="number" step="0.1" value="${st.weight}"></div>
      <div class="form-item"><label>年龄</label><input id="stA" type="number" value="${st.age}"></div>
      <div class="form-item"><label>性别</label><select id="stG"><option value="male" ${st.gender === 'male' ? 'selected' : ''}>男</option><option value="female" ${st.gender === 'female' ? 'selected' : ''}>女</option></select></div>
      <div class="form-item"><label>活动系数（1.3久坐/1.35轻/1.45中）</label><input id="stAc" type="number" step="0.01" value="${st.activity}"></div>
      <div class="form-item"><label>目标体重 kg</label><input id="stT" type="number" step="0.1" value="${st.targetWeight}"></div>
      <div class="form-item"><label>每日摄入目标 kcal</label><input id="stGoal" type="number" value="${st.goalCalories}"></div>
      <div class="form-item"><label>每日缺口目标 kcal</label><input id="stDef" type="number" value="${st.deficitTarget}"></div>
      <div class="form-item"><label>蛋白质目标 g</label><input id="stP" type="number" value="${st.proteinTarget}"></div>
      <div class="form-item"><label>碳水目标 g</label><input id="stC" type="number" value="${st.carbTarget}"></div>
      <div class="form-item"><label>脂肪目标 g</label><input id="stF" type="number" value="${st.fatTarget}"></div>
      <div class="form-item"><label>每日活动目标 分钟</label><input id="stMin" type="number" value="${st.activityMinutesTarget}"></div>
    </div>
    <div class="muted" style="margin:10px 0">BMR ≈ ${bmr} kcal（Mifflin-St Jeor）· TDEE ≈ ${t} kcal · 公式建议目标 = TDEE − 600 ≈ <b>${t - 600}</b> kcal</div>
    <div class="row"><button class="btn" id="stSave">保存设置</button>
    <button class="btn ghost" id="stAuto">按公式重设目标(${t - 600})</button></div>
  </div>
  <div class="card">
    <h3>白天自动采集（微信照片）</h3>
    <div class="muted" style="line-height:1.9;margin-bottom:10px">
      工作原理：白天用微信把照片发给「文件传输助手」<strong>（建议用「文件」方式发，普通图片消息在 PC 端是加密文件读不了）</strong>→
      电脑开机后服务每 2 分钟自动扫描微信文件目录，把新照片按日期归档。<br>
      已自动检测到 <b>${(st.watchDirs || []).length ? '手动配置 ' + st.watchDirs.length + ' 个' : ''}</b>目录；如照片没自动出现，把微信接收文件夹路径贴到下面（可多行）。
    </div>
    <div class="form-item"><label>监控目录（每行一个，留空=自动检测）</label>
      <input type="text" id="stWatch" value="${esc((st.watchDirs || []).join('\n'))}" placeholder="如 C:\\Users\\Admin\\Documents\\WeChat Files\\wxid_xxx\\FileStorage\\File"></div>
    <button class="btn" id="watchSave" style="margin-top:10px">保存采集目录</button>
    <button class="btn ghost" id="watchTest" style="margin-top:10px">立即扫描一次</button>
  </div>
  <div class="card">
    <h3>手环数据（转发截图即可）</h3>
    <div class="muted" style="line-height:1.9">
      运动、睡眠、体重、心率、HRV、血氧、压力——<b>把华为手环 App 里的卡片截图转发到「文件传输助手」</b>即可，
      夜间自动整理会看图读全字段入账（深睡 / REM / 静息心率 / 睡眠效率 / 评分 / 步数 / 活动消耗等）。<br>
      <b>转发小窍门</b>：一次多截几张（睡眠详情页、运动详情页、步数页），字段更全；同一天截多次以最新一张为准。<br>
      建议固定在<b>次日早晨</b>转发头一天的卡片，这样最省事。
    </div>
  </div>
  <div class="card">
    <h3>AI 拍照识别（可选，免费模型）</h3>
    <div class="muted" style="margin-bottom:8px">填写免费视觉模型 key 后照片可一键识别；不填不影响使用（照片留档+手动点选/夜间自动整理仍可由 AI 助手完成）。推荐智谱 glm-4v-flash（bigmodel.cn 注册后有免费额度）。</div>
    <div class="form-grid">
      <div class="form-item"><label>API Key</label><input id="aiKey" type="password" value="${esc(st.aiKey || '')}" placeholder="不填则不启用"></div>
      <div class="form-item"><label>接口地址</label><input id="aiEp" value="${esc(st.aiEndpoint || '')}"></div>
      <div class="form-item"><label>模型</label><input id="aiModel" value="${esc(st.aiModel || '')}"></div>
    </div>
    <button class="btn" id="aiSave" style="margin-top:10px">保存 AI 设置</button>
  </div>
  <div class="card">
    <h3>食物库 <span class="muted">每100g：热量kcal / 蛋白g / 碳水g / 脂肪g</span></h3>
    <div style="overflow-x:auto"><table id="foodTable"><tr><th>名称</th><th>kcal</th><th>蛋白</th><th>碳水</th><th>脂肪</th><th>默认克</th><th></th></tr>
    ${S.foods.map((f, i) => `<tr data-i="${i}"><td><input value="${esc(f.name)}" class="fn" style="width:110px"></td>
      <td><input type="number" value="${f.kcal100}" class="fk" style="width:64px"></td>
      <td><input type="number" step="0.1" value="${f.protein || 0}" class="fp" style="width:56px"></td>
      <td><input type="number" step="0.1" value="${f.carb || 0}" class="fc" style="width:56px"></td>
      <td><input type="number" step="0.1" value="${f.fat || 0}" class="ff" style="width:56px"></td>
      <td><input type="number" value="${f.defaultGrams}" class="fg" style="width:64px"></td>
      <td><button class="del" data-i="${i}">✕</button></td></tr>`).join('')}</table></div>
    <div class="row" style="margin-top:10px">
      <button class="btn ghost" id="foodAdd">＋ 加食物</button>
      <button class="btn" id="foodSave">保存食物库</button>
    </div>
  </div>
  <div class="card">
    <h3>数据与备份</h3>
    <div class="muted" style="margin-bottom:10px">全部数据在本机 E:\\WorkBuddy\\减脂大作战\\（data\\ 记录、photos\\ 照片、reports\\ 简报），不上传任何服务器。建议每周备份整个文件夹。前端版本 ${APP_VERSION}。</div>
    <button class="btn ghost" id="exportBtn2">导出全部数据(JSON)</button>
  </div>`;

  el.querySelector('#stSave').onclick = async () => {
    const g = id => el.querySelector('#' + id).value;
    Object.assign(st, {
      height: +g('stH'), weight: +g('stW'), age: +g('stA'), gender: g('stG'),
      activity: +g('stAc') || 1.35, targetWeight: +g('stT'),
      goalCalories: +g('stGoal'), deficitTarget: +g('stDef'),
      proteinTarget: +g('stP'), carbTarget: +g('stC'), fatTarget: +g('stF'),
      activityMinutesTarget: +g('stMin') || 30
    });
    await saveFile('settings', st); toast('设置已保存'); renderView();
  };
  el.querySelector('#stAuto').onclick = async () => {
    st.goalCalories = t - 600; el.querySelector('#stGoal').value = st.goalCalories;
    await saveFile('settings', st); toast('已按公式重设目标 ' + st.goalCalories + ' kcal');
  };
  el.querySelector('#watchSave').onclick = async () => {
    st.watchDirs = el.querySelector('#stWatch').value.split('\n').map(s => s.trim()).filter(Boolean);
    await saveFile('settings', st); toast('采集目录已保存');
  };
  el.querySelector('#watchTest').onclick = async () => {
    try {
      const r = await api('/api/auto-import', {});
      toast(r.imported.length ? '新采集 ' + r.imported.length + ' 张照片' : '没有新照片');
    } catch (e) { toast('扫描失败：' + e.message); }
  };
  el.querySelector('#aiSave').onclick = async () => {
    Object.assign(st, { aiKey: el.querySelector('#aiKey').value.trim(), aiEndpoint: el.querySelector('#aiEp').value.trim(), aiModel: el.querySelector('#aiModel').value.trim() });
    await saveFile('settings', st); toast('AI 设置已保存');
  };
  el.querySelector('#foodAdd').onclick = () => {
    S.foods.push({ name: '新食物', kcal100: 100, protein: 5, carb: 10, fat: 3, defaultGrams: 100, unit: '克', unitGrams: 100 });
    renderView();
  };
  el.querySelector('#foodSave').onclick = async () => {
    el.querySelectorAll('#foodTable tr[data-i]').forEach(tr => {
      const f = S.foods[+tr.dataset.i];
      f.name = tr.querySelector('.fn').value.trim() || f.name;
      f.kcal100 = +tr.querySelector('.fk').value || 0;
      f.protein = +tr.querySelector('.fp').value || 0;
      f.carb = +tr.querySelector('.fc').value || 0;
      f.fat = +tr.querySelector('.ff').value || 0;
      f.defaultGrams = +tr.querySelector('.fg').value || 100;
    });
    await saveFile('foods', S.foods); toast('食物库已保存');
  };
  el.querySelectorAll('#foodTable .del').forEach(b => b.onclick = () => { S.foods.splice(+b.dataset.i, 1); saveFile('foods', S.foods).then(renderView); });
}

/* ============ 路由与启动 ============ */
const VIEWS = { dash: renderDash, body: renderBody, diet: renderDiet, train: renderTrain, review: renderReview, settings: renderSettings };
let _loadingData = null;
function fillDefaults() {
  if (!S.settings || typeof S.settings !== 'object') S.settings = {};
  const D = { height: 173, weight: 100, age: 40, activity: 1.35, targetWeight: 75, goalCalories: 1900, deficitTarget: 600, proteinTarget: 120, carbTarget: 215, fatTarget: 57, activityMinutesTarget: 30 };
  ['height', 'weight', 'age', 'activity', 'targetWeight', 'goalCalories', 'deficitTarget', 'proteinTarget', 'carbTarget', 'fatTarget', 'activityMinutesTarget'].forEach(k => { if (!(k in S.settings)) S.settings[k] = D[k]; });
}
async function loadData() {
  try {
    const j = await api('/api/data');
    Object.assign(S, j.data);
    fillDefaults();
  } catch (e) {
    // 本地服务不可达（电脑关机/手机访问 GitHub Pages）→ 静态托管模式：直接拉取发布在云端的 JSON
    const base = 'data/';
    const J = async f => fetch(base + f).then(r => { if (!r.ok) throw new Error(f + ' HTTP ' + r.status); return r.json(); });
    const [settings, days, foods, weights, exercises, sleeps] = await Promise.all([
      J('settings.json'), J('all-days.json'),
      J('foods.json').catch(() => []), J('weights.json').catch(() => []),
      J('exercises.json').catch(() => []), J('sleeps.json').catch(() => [])
    ]);
    Object.assign(S, { settings, days: days || {}, foods: foods || [], weights: weights || [], exercises: exercises || [], sleeps: sleeps || [] });
    STATIC_MODE = true;
    fillDefaults();
  }
}
async function renderView() {
  const main = document.getElementById('main');
  if (!S.settings) { // 数据未就绪 → 自愈：先拉取数据再渲染，而不是崩在 null 上
    try {
      if (!_loadingData) _loadingData = loadData().finally(() => { _loadingData = null; });
      await _loadingData;
    } catch (e) {
      main.innerHTML = '<div class="card"><h3>加载失败</h3><div class="muted">' + esc(e.message) + '<br>请通过「启动减脂工作台.bat」启动后再打开本页。</div></div>';
      return;
    }
  }
  main.innerHTML = '';
  try {
    VIEWS[S.view](main);
  } catch (e) {
    console.error('render error:', e);
    main.innerHTML = '<div class="card"><h3>页面渲染出错</h3><div class="muted">' + esc(e && e.message || e) + '<br>点击左侧任意菜单会自动重试。</div></div>';
  }
  document.getElementById('viewTitle').textContent = VIEW_TITLES[S.view];
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
}
document.getElementById('sidebar').addEventListener('click', e => {
  const b = e.target.closest('.nav-btn');
  if (!b) return;
  S.view = b.dataset.view; renderView();
});
/* hash 路由：支持 #review / #diet 直接进入某页（可收藏、可深链） */
function readHash() {
  const v = (location.hash || '').replace('#', '');
  if (v && VIEWS[v]) S.view = v;
}
window.addEventListener('hashchange', () => { readHash(); renderView(); });
document.getElementById('importNow').onclick = async () => {
  try {
    const r = await api('/api/auto-import', {});
    toast(r.imported.length ? '新采集 ' + r.imported.length + ' 张照片' : '暂无新照片');
    if (r.imported.length) { const j = await api('/api/data'); Object.assign(S, j.data); renderView(); }
  } catch (e) { toast('扫描失败：' + e.message); }
};
document.getElementById('exportBtn').onclick = doExport;
document.getElementById('modalMask').addEventListener('click', e => { if (e.target.id === 'modalMask') closeModal(); });
function doExport() {
  const blob = new Blob([JSON.stringify({ settings: S.settings, foods: S.foods, weights: S.weights, exercises: S.exercises, sleeps: S.sleeps, days: S.days }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = '轻盈计划备份_' + todayStr() + '.json'; a.click();
}

(async function boot() {
  readHash();
  if (SNAPSHOT) { // 手机快照版：数据已内嵌，直接渲染（只读）
    Object.assign(S, window.__SNAPSHOT_DATA__);
    fillDefaults();
    S.pendingImport = 0;
    renderView();
    return;
  }
  try {
    await loadData();
  } catch (e) {
    document.getElementById('main').innerHTML = '<div class="card"><h3>加载失败</h3><div class="muted">' + esc(e.message) + '<br>' + (location.protocol === 'file:' ? '手机版请通过 GitHub Pages 网址访问（不要直接打开本地文件）。' : '请通过「启动减脂工作台.bat」启动后再打开本页。') + '</div></div>';
    return;
  }
  renderView();
})();
