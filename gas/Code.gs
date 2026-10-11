/**
 * 展示会名刺メモ - バックエンド(Google Apps Script)
 * スプレッドシートの「拡張機能 > Apps Script」に貼り付けて使う(コンテナバインド)。
 * スクリプトプロパティ: CLAUDE_API_KEY, TOKEN(合言葉), SIGNATURE(既定の署名・任意), MODEL(任意)
 *
 * action: ping / analyze / save
 */
const SHEET_NAME = '名刺';
const COLS = ['ID', '登録日時', '展示会', '温度感', '氏名', 'ふりがな', '会社名', '部署・役職', 'メール', '電話', '住所', 'URL',
  '商談要約', '次のアクション', '話した内容(原文)', '名刺(表)', '名刺(裏)', '下書き', '対応状況', '備考'];
const COL = {}; COLS.forEach(function (n, i) { COL[n] = i; });

const TONES = {
  formal: '非常に丁寧なビジネス敬語(謙譲語・尊敬語を正確に使う)',
  standard: '標準的で読みやすいビジネス敬語',
  friendly: '丁寧さは保ちつつ、親しみのある柔らかい表現'
};
const LENGTHS = {
  short: '本文は150〜250字程度で簡潔に',
  standard: '本文は300〜450字程度',
  long: '本文は500〜700字程度で、話した内容に詳しく触れる'
};

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (!prop_('TOKEN') || req.token !== prop_('TOKEN')) return json_({ ok: false, error: '合言葉が違います' });
    if (req.action === 'ping') return json_({ ok: true, hasKey: !!prop_('CLAUDE_API_KEY') });
    if (req.action === 'analyze') return json_({ ok: true, data: analyze_(req) });
    if (req.action === 'save') {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try { return json_(Object.assign({ ok: true }, save_(req))); } finally { lock.releaseLock(); }
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

// ---------- 解析 ----------
function analyze_(req) {
  const content = [];
  const imgs = req.images || (req.image ? { front: req.image } : {});
  if (imgs.front) {
    content.push({ type: 'text', text: '名刺(表面)の画像:' });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imgs.front } });
  }
  if (imgs.back) {
    content.push({ type: 'text', text: '名刺(裏面)の画像(英語表記・追加情報など):' });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imgs.back } });
  }
  const st = req.style || {};
  const tone = TONES[st.tone] || TONES.standard;
  const len = LENGTHS[st.length] || LENGTHS.standard;
  const sig = (st.signature || prop_('SIGNATURE') || '').trim();
  content.push({ type: 'text', text:
    '展示会で受け取った名刺と商談メモから情報を整理してください。\n' +
    '展示会名: ' + (req.event || '(未指定)') + '\n商談メモ:\n' + (req.memo || '(なし)') + '\n\n' +
    '次のJSONのみを出力してください(説明文・コードブロック不要)。読み取れない項目は空文字。推測で埋めないこと。\n' +
    '{"name":"氏名","kana":"ふりがな","company":"会社名","title":"部署・役職","email":"","phone":"","address":"","url":"",' +
    '"temp":"高|中|低","summary":"商談内容の要約(3〜5行)","next":"次のアクション","subject":"お礼メールの件名","body":"お礼メール本文"}\n\n' +
    '【temp】商談メモから見込み度を判断(具体的な導入時期・予算・デモ希望=高、情報収集段階=中、挨拶程度=低)。メモが無ければ「中」。\n' +
    '【メール本文の要件】\n- 文体: ' + tone + '\n- 長さ: ' + len + '\n' +
    '- 宛名は「会社名 部署・役職 氏名様」\n- 展示会来場への御礼、話した内容への具体的言及、メモにある次のアクション(デモ・資料送付・訪問など)の提案\n' +
    '- メモに無い約束・数値・日程を創作しない\n' +
    (st.extra ? '- 追加指示: ' + st.extra + '\n' : '') +
    (sig ? '- 末尾の署名は次をそのまま使う:\n' + sig : '- 署名は「(署名)」とだけ記載')
  });
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': prop_('CLAUDE_API_KEY'), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: prop_('MODEL') || 'claude-sonnet-5-5', max_tokens: 2500, messages: [{ role: 'user', content: content }] })
  });
  if (res.getResponseCode() !== 200) throw new Error('Claude API エラー: ' + res.getContentText().slice(0, 300));
  const text = JSON.parse(res.getContentText()).content.map(function (c) { return c.text || ''; }).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('解析結果を読み取れませんでした');
  return JSON.parse(m[0]);
}

// ---------- シート ----------
function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (sh && sh.getLastRow() > 0 && sh.getRange(1, 1).getValue() !== COLS[0]) {
    // 旧レイアウトのシートは退避して新規作成
    sh.setName(SHEET_NAME + '_旧' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMddHHmm'));
    sh = null;
  }
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(COLS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, COLS.length).setFontWeight('bold').setBackground('#e8eefc');
    sh.getRange(2, COL['温度感'] + 1, 2000, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['高', '中', '低'], true).build());
    sh.getRange(2, COL['対応状況'] + 1, 2000, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['未対応', 'メール送信済', '商談中', '受注', '見送り'], true).build());
    sh.getRange(2, COL['商談要約'] + 1, 2000, 2).setWrap(true);
    sh.setColumnWidth(COL['商談要約'] + 1, 320);
    sh.setColumnWidth(COL['次のアクション'] + 1, 200);
    sh.setColumnWidth(COL['話した内容(原文)'] + 1, 240);
  }
  return sh;
}

function norm_(s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/[\s　]/g, ''); }
function normCompany_(s) {
  return norm_(s).replace(/株式会社|有限会社|合同会社|\(株\)|\(有\)|㈱|㈲|inc\.?|co\.?,?ltd\.?|corp(oration)?\.?/g, '');
}

function findDup_(sh, d) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, COLS.length).getValues();
  const em = norm_(d.email), nm = norm_(d.name), cp = normCompany_(d.company);
  const out = [];
  rows.forEach(function (r, i) {
    const byMail = em && norm_(r[COL['メール']]) === em;
    const byName = nm && cp && norm_(r[COL['氏名']]) === nm && normCompany_(r[COL['会社名']]) === cp;
    if (byMail || byName) {
      out.push({
        row: i + 2, name: r[COL['氏名']], company: r[COL['会社名']], email: r[COL['メール']],
        date: r[COL['登録日時']] ? Utilities.formatDate(new Date(r[COL['登録日時']]), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '',
        event: r[COL['展示会']], summary: r[COL['商談要約']], reason: byMail ? 'メール一致' : '氏名+会社名一致'
      });
    }
  });
  return out;
}

function folder_() {
  const it = DriveApp.getFoldersByName('名刺画像');
  return it.hasNext() ? it.next() : DriveApp.createFolder('名刺画像');
}
function saveImg_(b64, side, d) {
  if (!b64) return '';
  const name = (d.company || 'card') + '_' + (d.name || '') + '_' + side + '_' + Date.now() + '.jpg';
  return folder_().createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name)).getUrl();
}

function stamp_() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'); }

function save_(req) {
  const d = req.data || {};
  const sh = sheet_();
  const mode = req.dupMode || '';   // '' | 'new' | 'merge'

  if (!mode) {
    const dups = findDup_(sh, d);
    if (dups.length) return { duplicate: true, matches: dups };
  }

  const imgs = req.images || (req.image ? { front: req.image } : {});
  const front = saveImg_(imgs.front, '表', d), back = saveImg_(imgs.back, '裏', d);

  let draft = false;
  const email = String(d.email || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    GmailApp.createDraft(email, d.subject || 'ご来場のお礼', d.body || '');
    draft = true;
  }

  if (mode === 'merge' && req.mergeRow) {
    const row = Number(req.mergeRow);
    const cell = function (n) { return sh.getRange(row, COL[n] + 1); };
    const add = function (n, v) { if (v) { const c = cell(n); c.setValue((c.getValue() ? c.getValue() + '\n' : '') + v); } };
    add('商談要約', '[' + stamp_() + ' ' + (req.event || '') + '] ' + (d.summary || ''));
    add('話した内容(原文)', '[' + stamp_() + '] ' + (req.memo || ''));
    if (d.next) cell('次のアクション').setValue(d.next);
    if (d.temp) cell('温度感').setValue(d.temp);
    add('名刺(表)', front); add('名刺(裏)', back);
    if (draft) cell('下書き').setValue('作成済');
    add('備考', '再会 ' + stamp_() + ' ' + (req.event || ''));
    cell('対応状況').setValue('未対応');
    return { draft: draft, merged: true };
  }

  sh.appendRow([Utilities.getUuid().slice(0, 8), new Date(), req.event || '', d.temp || '', d.name, d.kana, d.company, d.title, email,
    d.phone, d.address, d.url, d.summary, d.next, req.memo || '', front, back, draft ? '作成済' : '', '未対応',
    mode === 'new' ? '重複候補あり(別人として登録)' : '']);
  return { draft: draft };
}

/** 初回のみ手動実行: Gmail/Drive/外部通信の権限承認用 */
function authorize() {
  GmailApp.getDrafts(); DriveApp.getRootFolder(); SpreadsheetApp.getActive();
  UrlFetchApp.fetch('https://api.anthropic.com', { muteHttpExceptions: true });
}
