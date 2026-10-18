const $ = id => document.getElementById(id);
const store = {
  get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
};
const images = { front: '', back: '' };
let busy = false;
let matches = [];

function status(msg, err) { const s = $('status'); s.textContent = msg; s.className = err ? 'err' : ''; }
function setBusy(b) { busy = b; ['btnAnalyze', 'btnSave', 'btnHold', 'btnMerge', 'btnNew'].forEach(i => $(i).disabled = b); }

// ---------- 設定 ----------
const CFG = { url: 'cfgUrl', token: 'cfgToken', event: 'cfgEvent', tone: 'cfgTone', length: 'cfgLength', sig: 'cfgSig', extra: 'cfgExtra', mail: 'cfgMail' };
function mailMode() { return store.get('mail') || 'gmail'; }
Object.entries(CFG).forEach(([k, id]) => { const v = store.get(k); if (v) $(id).value = v; });
if (!store.get('url')) $('settings').classList.remove('hidden');
$('btnSettings').onclick = () => $('settings').classList.toggle('hidden');
$('btnSaveCfg').onclick = () => {
  Object.entries(CFG).forEach(([k, id]) => store.set(k, k === 'token' || k === 'sig' ? $(id).value : $(id).value.trim()));
  $('settings').classList.add('hidden'); status('設定を保存しました');
};
$('btnTest').onclick = async () => {
  store.set('url', $('cfgUrl').value.trim()); store.set('token', $('cfgToken').value);
  status('接続テスト中…');
  try {
    const j = await api({ action: 'ping' });
    if (!j.hasKey) return status('⚠ 接続OKですが CLAUDE_API_KEY が未設定です', true);
    if (j.net) return status('⚠ 接続OK。ただし、このGoogleアカウントでは、AIへの通信(UrlFetch)が使えません(' + String(j.net).slice(0, 90) + ')。24時間後にもう一度試すか、別のGoogleアカウントで設置してください', true);
    const sel = $('cfgMail').value;
    if (j.gmail === false && sel === 'gmail') return status('⚠ 接続OK。ただし、このGoogleアカウントではGmailが使えません。「メール方式」を「メールアプリで開く」にしてください', true);
    status('✅ 接続OK(APIキー設定済み・Gmail' + (j.gmail === false ? '利用不可' : '利用可') + ')');
  } catch (e) { status(e.message, true); }
};
// ---------- メールアプリで開く(Outlook等。mailto:) ----------
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
function mailtoUrl(to, subject, body) {
  const addr = String(to || '').trim();
  return 'mailto:' + (EMAIL_RE.test(addr) ? addr : '') + '?subject=' + encodeURIComponent(subject || '') +
    '&body=' + encodeURIComponent(String(body || '').replace(/\r?\n/g, '\r\n'));
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); status('コピーしました'); return true; }
  catch { status('コピーできませんでした。文面を長押しして、手動でコピーしてください', true); return false; }
}
function linkBtn(text, href, secondary) {
  const a = document.createElement('a'); a.textContent = text; a.href = href;
  a.style.cssText = 'display:block;text-align:center;text-decoration:none;border-radius:12px;padding:6px 12px;font-size:14px;font-weight:600;' +
    (secondary ? 'color:var(--pri);border:1px solid var(--pri)' : 'background:var(--pri);color:#fff');
  return a;
}
let mailCtx = null;
function showMailBox(d) {
  mailCtx = { subject: d.subject || '', body: d.body || '' };
  const url = mailtoUrl(d.email, d.subject, d.body);
  $('mailTo').textContent = '宛先: ' + (EMAIL_RE.test((d.email || '').trim()) ? d.email.trim() : '(未取得。メールアプリで入力してください)') + ' / 件名: ' + (d.subject || '');
  $('btnMailto').href = url;
  $('mailNote').textContent = url.length > 1800
    ? '文面が長いため、メールアプリで本文が途中で切れる場合があります。その場合は「コピー」で貼り付けてください。'
    : 'Outlookで開くには、スマホの「既定のメールアプリ」をOutlookにしてください(iPhone: 設定 → アプリ → メール → 既定のメールアプリ)。';
  $('mailDone').classList.remove('hidden'); $('mailDone').scrollIntoView({ behavior: 'smooth' });
}
$('btnMailCopy').onclick = () => { if (mailCtx) copyText((mailCtx.subject ? '件名: ' + mailCtx.subject + '\n\n' : '') + mailCtx.body); };
$('btnMailClose').onclick = () => { $('mailDone').classList.add('hidden'); mailCtx = null; status(''); window.scrollTo({ top: 0, behavior: 'smooth' }); };

function style() { return { tone: store.get('tone') || 'standard', length: store.get('length') || 'standard', signature: store.get('sig'), extra: store.get('extra') }; }

// ---------- 今日の登録数 ----------
function today() { return new Date().toISOString().slice(0, 10); }
function bumpCount() { const k = 'cnt_' + today(); store.set(k, String((+store.get(k) || 0) + 1)); showCount(); }
function showCount() { $('count').textContent = '本日 ' + (+store.get('cnt_' + today()) || 0) + '件'; }
showCount();

// ---------- 画像(縮小してJPEG化) ----------
async function toB64(file) {
  const bmp = await createImageBitmap(file);
  const r = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}
function showImg(side) {
  const n = side === 'front' ? 1 : 2, img = $('pv' + n);
  if (images[side]) { img.src = 'data:image/jpeg;base64,' + images[side]; img.style.display = 'block'; }
  else { img.removeAttribute('src'); img.style.display = 'none'; }
}
[['front', 1], ['back', 2]].forEach(([side, n]) => {
  $('btnShoot' + n).onclick = () => $('file' + n).click();
  $('file' + n).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    images[side] = (await toB64(f)).split(',')[1]; showImg(side);
  };
});

// ---------- 音声入力 ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
if (!SR) $('btnMic').style.display = 'none';
$('btnMic').onclick = () => {
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = 'ja-JP'; rec.continuous = true; rec.interimResults = false;
  rec.onresult = ev => { for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) $('memo').value += ev.results[i][0].transcript + '\n'; };
  rec.onend = () => { rec = null; $('btnMic').textContent = '🎤 音声入力'; };
  rec.onerror = () => status('音声入力に失敗しました(マイク許可を確認)', true);
  rec.start(); $('btnMic').textContent = '⏹ 停止';
};

// ---------- 保留キュー(IndexedDB。電波が悪い会場でも撮り溜め可能) ----------
const idb = new Promise(res => {
  try {
    const rq = indexedDB.open('meishi', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('q', { keyPath: 'id', autoIncrement: true });
    rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
  } catch { res(null); }
});
async function tx(mode, fn) {
  const db = await idb; if (!db) throw new Error('この端末では保留機能を使えません');
  return new Promise((ok, ng) => {
    const t = db.transaction('q', mode), r = fn(t.objectStore('q'));
    t.oncomplete = () => ok(r && r.result); t.onerror = () => ng(t.error);
  });
}
async function renderQueue() {
  let items = [];
  try { items = await tx('readonly', s => s.getAll()); } catch {}
  $('qn').textContent = items.length;
  $('queueBox').classList.toggle('hidden', !items.length);
  $('queueList').innerHTML = '';
  items.forEach(it => {
    const d = document.createElement('div'); d.className = 'item';
    const t = new Date(it.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    d.append(`${t} ${it.images.front ? '📷' : ''}${it.images.back ? '📷' : ''} ${(it.memo || '(メモなし)').slice(0, 24)}`);
    const row = document.createElement('div'); row.className = 'row'; row.style.marginTop = '6px';
    const open = document.createElement('button'); open.className = 'sm'; open.textContent = '読み込む';
    open.onclick = async () => {
      if (images.front || images.back || $('memo').value.trim()) return status('入力中の内容があります。先に解析・保留してください', true);
      images.front = it.images.front || ''; images.back = it.images.back || ''; showImg('front'); showImg('back');
      $('memo').value = it.memo || ''; await tx('readwrite', s => s.delete(it.id)); renderQueue();
    };
    const del = document.createElement('button'); del.className = 'sec sm'; del.textContent = '削除';
    del.onclick = async () => { if (confirm('この保留を削除しますか?')) { await tx('readwrite', s => s.delete(it.id)); renderQueue(); } };
    row.append(open, del); d.append(row); $('queueList').append(d);
  });
}
renderQueue();

function resetForm() {
  images.front = images.back = ''; showImg('front'); showImg('back');
  $('memo').value = ''; $('file1').value = ''; $('file2').value = '';
  $('result').classList.add('hidden'); $('dup').classList.add('hidden');
}
$('btnHold').onclick = async () => {
  if (!images.front && !images.back && !$('memo').value.trim()) return status('保留する内容がありません', true);
  try {
    await tx('readwrite', s => s.add({ images: { ...images }, memo: $('memo').value, at: Date.now() }));
    resetForm(); renderQueue(); status('保留しました。次の方をどうぞ');
  } catch (e) { status(e.message, true); }
};

// ---------- API ----------
async function api(payload) {
  const url = store.get('url') || $('cfgUrl').value.trim();
  if (!url) { $('settings').classList.remove('hidden'); throw new Error('先に設定でGAS URLを入力してください'); }
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: store.get('token') || $('cfgToken').value, ...payload }) });
  } catch { throw new Error('通信できません。電波状況を確認し、「保留して次へ」で後から処理もできます'); }
  let j;
  try { j = await res.json(); } catch { throw new Error('GASの応答が不正です。デプロイの「アクセスできるユーザー=全員」を確認してください'); }
  if (!j.ok) throw new Error(j.error || 'サーバーエラー');
  return j;
}
const FIELDS = ['name', 'kana', 'company', 'title', 'email', 'phone', 'address', 'url', 'temp', 'summary', 'next', 'subject', 'body'];
function formData() { const d = {}; FIELDS.forEach(k => d[k] = $('f_' + k).value); return d; }

$('btnAnalyze').onclick = async () => {
  if (busy) return;
  if (!images.front && !images.back && !$('memo').value.trim()) return status('名刺画像か話した内容を入力してください', true);
  setBusy(true); status('解析中…(10〜30秒)'); $('mailDone').classList.add('hidden');
  try {
    const j = await api({ action: 'analyze', images, memo: $('memo').value, event: store.get('event'), style: style() });
    FIELDS.forEach(k => $('f_' + k).value = j.data[k] || (k === 'temp' ? '中' : ''));
    $('dup').classList.add('hidden');
    $('result').classList.remove('hidden'); $('result').scrollIntoView({ behavior: 'smooth' });
    status('内容を確認して登録してください');
  } catch (e) { status(e.message, true); }
  setBusy(false);
};

async function doSave(dupMode, mergeRow) {
  setBusy(true); status('登録中…');
  try {
    const d = formData();
    const j = await api({ action: 'save', data: d, memo: $('memo').value, images, event: store.get('event'), dupMode, mergeRow, mailMode: mailMode() });
    if (j.duplicate) {
      matches = j.matches;
      $('dupList').innerHTML = '';
      matches.forEach(m => {
        const d = document.createElement('div'); d.className = 'item';
        d.textContent = `${m.company} ${m.name}(${m.reason}) 初回: ${m.date} ${m.event || ''}`;
        $('dupList').append(d);
      });
      $('dup').classList.remove('hidden'); $('dup').scrollIntoView({ behavior: 'smooth' });
      status('重複候補が見つかりました', true);
    } else {
      const mode = j.mailMode || mailMode();
      const tail = mode === 'none' ? ''
        : mode === 'app' ? '。下の「メールアプリで開く」でお礼メールを作成してください'
        : j.draft ? (j.noAddress ? '。Gmail下書きを作成(宛先が未取得のため、Gmailで入力してください)' : '。Gmail下書きを作成済み')
        : '(Gmail下書きは作成されませんでした。Outlook等をお使いなら、設定の「メール方式」を「メールアプリで開く」に変更してください)';
      status((j.merged ? '✅ 既存の行に追記しました' : '✅ 登録しました') + tail);
      listLoaded = false; bumpCount(); resetForm();
      if (mode === 'app' && d.body) showMailBox(d); else window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } catch (e) { status(e.message, true); }
  setBusy(false);
}
$('btnSave').onclick = () => { if (!busy) doSave('', ''); };
$('btnMerge').onclick = () => { if (!busy) doSave('merge', matches[0].row); };
$('btnNew').onclick = () => { if (!busy) doSave('new', ''); };
$('btnDupCancel').onclick = () => { $('dup').classList.add('hidden'); status(''); };

// ---------- 一覧(保存済みの名刺をスマホで確認) ----------
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function safeUrls(s) { return String(s || '').split(/\s+/).filter(u => /^https:\/\//.test(u)); }
let listLoaded = false, statuses = [];

function showTab(t) {
  $('viewReg').classList.toggle('hidden', t !== 'reg');
  $('viewList').classList.toggle('hidden', t !== 'list');
  $('tabReg').className = t === 'reg' ? '' : 'sec'; $('tabList').className = t === 'list' ? '' : 'sec';
  if (t === 'list' && !listLoaded) loadList();
}
$('tabReg').onclick = () => showTab('reg');
$('tabList').onclick = () => showTab('list');
$('btnReload').onclick = () => loadList();
let qTimer = null;
$('q').oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(loadList, 500); };

async function loadList() {
  $('listInfo').textContent = '読み込み中…';
  try {
    const j = await api({ action: 'list', q: $('q').value.trim(), limit: 50 });
    statuses = j.statuses || []; listLoaded = true;
    $('listInfo').textContent = `全${j.total}件中 ${j.items.length}件を表示(新しい順)`;
    $('listBox').innerHTML = '';
    j.items.forEach(it => $('listBox').append(renderCard(it)));
  } catch (e) { $('listInfo').textContent = e.message; }
}

function dl(parent, label, value) { if (!value) return; parent.append(el('dt', '', label), el('dd', '', value)); }

function renderCard(it) {
  const card = el('div', 'card'), hd = el('div', 'hd');
  const nm = el('div', 'nm', `${it.company} ${it.name}`);
  if (it.temp) nm.append(el('span', 'tag ' + (it.temp === '高' ? 'hi' : it.temp === '中' ? 'mid' : ''), it.temp));
  hd.append(nm, el('div', 'sub', `${it.date} ${it.event} / ${it.status || '未対応'}`));
  if (it.next) hd.append(el('div', 'sub', '次: ' + it.next));
  const detail = el('div', 'detail hidden');
  let built = false;
  hd.onclick = () => { if (!built) { buildDetail(detail, it); built = true; } detail.classList.toggle('hidden'); };
  card.append(hd, detail);
  return card;
}

function buildDetail(box, it) {
  const d = el('dl'); d.style.margin = '0';
  dl(d, '部署・役職', it.title); dl(d, 'ふりがな', it.kana);
  if (it.email) { const a = el('a', '', it.email); a.href = 'mailto:' + it.email; d.append(el('dt', '', 'メール'), (() => { const x = el('dd'); x.append(a); return x; })()); }
  if (it.phone) { const a = el('a', '', it.phone); a.href = 'tel:' + it.phone.replace(/[^\d+]/g, ''); d.append(el('dt', '', '電話'), (() => { const x = el('dd'); x.append(a); return x; })()); }
  dl(d, '住所', it.address); dl(d, 'URL', it.url);
  dl(d, '商談要約', it.summary); dl(d, '次のアクション', it.next); dl(d, '話した内容', it.memo);
  const imgs = [...safeUrls(it.front).map(u => ['名刺(表)', u]), ...safeUrls(it.back).map(u => ['名刺(裏)', u])];
  if (imgs.length) {
    const dd = el('dd'); imgs.forEach(([t, u]) => { const a = el('a', '', t + ' を開く'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; dd.append(a, el('br')); });
    d.append(el('dt', '', '名刺画像(Googleドライブ)'), dd);
  }
  box.append(d);

  // 対応状況の変更
  const sel = el('select'); sel.style.marginTop = '8px';
  statuses.forEach(s => { const o = el('option', '', s); o.value = s; if (s === (it.status || '未対応')) o.selected = true; sel.append(o); });
  sel.onchange = async () => {
    try { await api({ action: 'setStatus', id: it.id, row: it.row, status: sel.value }); it.status = sel.value; status('対応状況を更新しました'); }
    catch (e) { status(e.message, true); }
  };
  const sl = el('div', 'sub', '対応状況'); sl.style.marginTop = '8px';
  box.append(sl, sel);

  // メール文面と下書き
  if (it.body) {
    const l = el('div', 'sub', 'お礼メール文面'); l.style.marginTop = '10px';
    const ta = el('textarea'); ta.readOnly = true; ta.value = (it.subject ? '件名: ' + it.subject + '\n\n' : '') + it.body;
    box.append(l, ta);
    const row = el('div', 'row'); row.style.marginTop = '8px';
    const cp = el('button', 'sec sm', 'コピー');
    cp.onclick = async () => { if (!(await copyText(ta.value))) ta.select(); };
    const ma = linkBtn('メールアプリで開く', mailtoUrl(it.email, it.subject, it.body), mailMode() === 'gmail');
    const mk = el('button', 'sm', it.draft ? 'Gmail下書きを再作成' : 'Gmail下書きを作成');
    mk.onclick = async () => {
      mk.disabled = true;
      try { const j = await api({ action: 'makeDraft', id: it.id, row: it.row }); status(j.noAddress ? '✅ 下書きを作成しました(宛先は未設定)' : '✅ 下書きを作成しました'); it.draft = '作成済'; mk.textContent = 'Gmail下書きを再作成'; }
      catch (e) { status(e.message, true); }
      mk.disabled = false;
    };
    row.append(cp, ma); if (mailMode() === 'gmail') row.append(mk); box.append(row);
  } else {
    const n = el('div', 'sub', 'メール文面は保存されていません(古い形式の登録)'); n.style.marginTop = '8px'; box.append(n);
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
