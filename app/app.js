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
const CFG = { url: 'cfgUrl', token: 'cfgToken', event: 'cfgEvent', tone: 'cfgTone', length: 'cfgLength', sig: 'cfgSig', extra: 'cfgExtra' };
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
  try { const j = await api({ action: 'ping' }); status(j.hasKey ? '✅ 接続OK(APIキー設定済み)' : '⚠ 接続OKですが CLAUDE_API_KEY が未設定です', !j.hasKey); }
  catch (e) { status(e.message, true); }
};
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
  setBusy(true); status('解析中…(10〜30秒)');
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
    const j = await api({ action: 'save', data: formData(), memo: $('memo').value, images, event: store.get('event'), dupMode, mergeRow });
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
      status((j.merged ? '✅ 既存の行に追記しました' : '✅ 登録しました') + (j.draft ? '。Gmail下書きを作成済み' : '(メール無しのため下書きなし)'));
      bumpCount(); resetForm(); window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } catch (e) { status(e.message, true); }
  setBusy(false);
}
$('btnSave').onclick = () => { if (!busy) doSave('', ''); };
$('btnMerge').onclick = () => { if (!busy) doSave('merge', matches[0].row); };
$('btnNew').onclick = () => { if (!busy) doSave('new', ''); };
$('btnDupCancel').onclick = () => { $('dup').classList.add('hidden'); status(''); };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
