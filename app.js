/* ===== machi no spoon — app logic ===== */
(function(){
  'use strict';
  const $ = (s,el=document)=>el.querySelector(s);
  const $$ = (s,el=document)=>[...el.querySelectorAll(s)];
  const pad = n=>String(n).padStart(2,'0');
  const ymd = d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const WD = ['日','月','火','水','木','金','土'];
  const today = new Date(); today.setHours(0,0,0,0);
  const todayKey = ymd(today);

  /* ============================================================
     CSV URLs
  ============================================================ */
  const MENU_CSV_URL     = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vThV8t5ZEvCpBCUOHvsRFO5os_tU5JjHiznCnx-E7juJ0DHJgSQG06mODZ79_qIyyuTYtz7e10C6qqG/pub?gid=1292739685&single=true&output=csv';
  const SCHEDULE_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vThV8t5ZEvCpBCUOHvsRFO5os_tU5JjHiznCnx-E7juJ0DHJgSQG06mODZ79_qIyyuTYtz7e10C6qqG/pub?gid=0&single=true&output=csv';

  /* ============================================================
     CSV ユーティリティ
  ============================================================ */

  /**
   * CSV テキストを 2次元配列へパース。
   * RFC4180 準拠：ダブルクォート囲み・内部エスケープ ("") に対応。
   * UTF-8 BOM・CR+LF・CR のみ・LF のみいずれも処理する。
   */
  function parseCSV(text) {
    // BOM 除去
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    // 改行を統一
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const rows = [];
    let row = [], field = '', inQuote = false;
    const len = text.length;

    for (let i = 0; i < len; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } // "" → "
          else inQuote = false;
        } else {
          field += c;
        }
      } else {
        if      (c === '"') { inQuote = true; }
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') {
          row.push(field); field = '';
          if (row.some(f => f !== '')) rows.push(row);
          row = [];
        } else {
          field += c;
        }
      }
    }
    // 末尾に改行がない場合の残余処理
    if (field || row.length) {
      row.push(field);
      if (row.some(f => f !== '')) rows.push(row);
    }
    return rows;
  }

  /** CSV rows → オブジェクト配列（1行目をヘッダとして使用） */
  function rowsToObjects(rows) {
    if (rows.length < 2) return [];
    const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    return rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (row[i] !== undefined ? row[i] : '').trim(); });
      return obj;
    });
  }

  /** recommend 列の値を boolean へ正規化 */
  function isTruthy(val) {
    if (val === true) return true;
    return String(val).toUpperCase() === 'TRUE' || val === '1';
  }

  /** CSV を fetch してオブジェクト配列を返す */
  async function fetchCSV(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return rowsToObjects(parseCSV(text));
  }

  /* ============================================================
     UI ヘルパー
  ============================================================ */

  /** HTML 特殊文字エスケープ（XSS 対策） */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setLoading(el) {
    if (el) el.innerHTML = '<div class="data-loading">読み込み中…</div>';
  }
  function setError(el) {
    if (el) el.innerHTML = '<div class="data-error">現在情報を取得できません</div>';
  }
  function setEmpty(el, msg) {
    if (el) el.innerHTML = `<div class="data-empty">${esc(msg)}</div>`;
  }

  /* ============================================================
     SCHEDULE
  ============================================================ */

  let schedule = [];

  /** date 文字列を Date オブジェクトへ変換（複数フォーマット対応） */
  function parseDate(str) {
    if (!str) return null;
    // yyyy-mm-dd / yyyy/mm/dd
    const iso = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (iso) {
      const d = new Date(+iso[1], +iso[2] - 1, +iso[3]);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    // m/d/yyyy (US export)
    const us = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (us) {
      const d = new Date(+us[3], +us[1] - 1, +us[2]);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    const d = new Date(str);
    if (!isNaN(d.getTime())) { d.setHours(0, 0, 0, 0); return d; }
    return null;
  }

  async function loadSchedule() {
    // 読み込み中を即時表示（await 前なので同期的に反映）
    setLoading($('#statusCard'));
    $('#statusMini').innerHTML = '';
    setLoading($('#calGrid'));

    try {
      const objs = await fetchCSV(SCHEDULE_CSV_URL);

      schedule = objs
        .filter(s => s.status !== 'hidden')        // hidden は除外
        .map(s => {
          const d = parseDate(s.date);
          if (!d) return null;
          return {
            date:    d,
            key:     ymd(d),
            start:   s.start_time || '',
            end:     s.end_time   || '',
            place:   s.place      || '',
            address: s.address    || '',
            map_url: s.map_url    || '',
            note:    s.note       || '',
            status:  s.status     || 'open',
          };
        })
        .filter(s => s && s.key >= todayKey)        // 今日以降のみ
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    } catch (e) {
      console.error('[machi no spoon] schedule fetch error:', e);
      setError($('#statusCard'));
      setError($('#calGrid'));
      return;
    }

    renderStatus();
    renderCal();
  }

  /* ---------- 出店予定 自動判定 ---------- */
  function renderStatus() {
    const card = $('#statusCard');
    if (!card) return;

    if (!schedule.length) {
      setEmpty(card, '現在予定されている出店情報はありません');
      $('#statusMini').innerHTML = '';
      return;
    }

    const now = new Date();
    // todayKey は loadSchedule のフィルタで既に適用済みだが、renderCal 再描画にも備え再利用
    const upcoming = schedule; // 既にソート・フィルタ済み

    let main  = upcoming[0];
    let label, state = 'open';

    if (main.key === todayKey) {
      if (main.status === 'canceled') {
        label = '本日は出店中止'; state = 'closed';
      } else if (main.status === 'soldout') {
        label = '本日は完売しました'; state = 'closed';
      } else {
        const [sh, sm] = (main.start || '00:00').split(':').map(Number);
        const [eh, em] = (main.end   || '23:59').split(':').map(Number);
        const mins = now.getHours() * 60 + now.getMinutes();
        if (mins < sh * 60 + sm) {
          label = '本日 出店予定'; state = 'soon';
        } else if (mins <= eh * 60 + em) {
          label = '本日 営業中！'; state = 'open';
        } else {
          // 本日分終了 → 次の予定へ
          if (upcoming[1]) main = upcoming[1];
          label = makeFutureLabel(main);
          state = main.status === 'canceled' ? 'closed' : 'open';
        }
      }
    } else {
      label = makeFutureLabel(main);
      state = main.status === 'canceled' ? 'closed' : 'open';
    }

    card.className = 'card statuscard ' +
      (state === 'closed' ? 'is-closed' : state === 'soon' ? 'is-soon' : '');

    const dlabel = (main.date.getMonth() + 1) + '月' + main.date.getDate() + '日(' + WD[main.date.getDay()] + ')';
    const mapBtn = main.map_url
      ? `<a class="btn blue" href="${esc(main.map_url)}" target="_blank" rel="noopener">📍 Googleマップで見る</a>`
      : '';
    const timeRow = (main.start || main.end)
      ? `<span class="ico">⏰</span>${esc(main.start)} – ${esc(main.end)}${main.note ? `　<span class="ico">📝</span>${esc(main.note)}` : ''}`
      : (main.note ? `<span class="ico">📝</span>${esc(main.note)}` : '');

    card.innerHTML = `
      <div class="flag">${label}</div>
      <div class="body">
        <div style="flex:1">
          <div class="en" style="font-weight:600;color:var(--green-deep);font-size:14px">${dlabel}</div>
          <div class="place">${esc(main.place)}</div>
          ${main.address ? `<div class="meta"><span class="ico">📍</span>${esc(main.address)}</div>` : ''}
          ${timeRow ? `<div class="meta">${timeRow}</div>` : ''}
        </div>
      </div>
      <div class="actions">
        ${mapBtn}
        <a class="btn" href="#calendar">📅 今月の出店をすべて見る</a>
      </div>`;

    // 次の予定 mini（main の次から最大2件）
    const mini  = $('#statusMini');
    const rest  = upcoming.filter(s => s !== main).slice(0, 2);
    mini.innerHTML = rest.length
      ? '<div class="en" style="width:100%;text-align:center;font-weight:600;color:var(--brown-2);font-size:13px;margin-bottom:2px">NEXT ▸ このあとの予定</div>' +
        rest.map(s => {
          const dl = (s.date.getMonth() + 1) + '/' + s.date.getDate() + '(' + WD[s.date.getDay()] + ')';
          const st = s.status === 'canceled' ? '（中止）' : s.status === 'soldout' ? '（完売）' : '';
          return `<div class="m"><div class="d">${dl} ${esc(s.start)}–${esc(s.end)}</div><div class="p">${esc(s.place)}${st}</div></div>`;
        }).join('')
      : '';
  }

  function makeFutureLabel(s) {
    const tmrKey = ymd(new Date(today.getTime() + 86400000));
    if (s.key === todayKey) return '本日 出店予定';
    if (s.key === tmrKey)   return '次の出店予定 ▸ 明日';
    return '次の出店予定';
  }

  /* ---------- 出店カレンダー ---------- */
  let calMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  function renderCal() {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    $('#calMonth').textContent = `${y}年 ${m + 1}月`;
    const first = new Date(y, m, 1).getDay();
    const days  = new Date(y, m + 1, 0).getDate();
    const grid  = $('#calGrid');

    grid.innerHTML = WD.map(w => `<div class="dow">${w}</div>`).join('');
    for (let i = 0; i < first; i++)
      grid.insertAdjacentHTML('beforeend', '<div class="cell empty"></div>');

    for (let d = 1; d <= days; d++) {
      const dt  = new Date(y, m, d);
      const key = ymd(dt);
      const ev  = schedule.find(s => s.key === key);
      let cls   = 'cell';
      let inner = `<span>${d}</span>`;

      if (key === todayKey) cls += ' today';
      if (ev) {
        cls  += ev.status === 'canceled' ? ' has cancel' : ' has';
        const short = ev.place.length > 5 ? ev.place.slice(0, 5) : ev.place;
        inner += `<span class="lbl">${ev.status === 'canceled' ? '中止' : esc(short)}</span>`;
      }
      const cell = document.createElement('div');
      cell.className = cls;
      cell.innerHTML = inner;
      if (ev) cell.addEventListener('click', () => showCalDetail(ev));
      grid.appendChild(cell);
    }
  }

  function showCalDetail(ev) {
    const box = $('#calDetail');
    const dl  = (ev.date.getMonth() + 1) + '月' + ev.date.getDate() + '日(' + WD[ev.date.getDay()] + ')';
    const st  = ev.status === 'canceled'
      ? '<span class="tag" style="background:var(--pink)">出店中止</span>'
      : ev.status === 'soldout'
        ? '<span class="tag season">完売</span>'
        : '';
    const mapBtn = ev.map_url
      ? `<a class="btn blue" style="margin-top:12px" href="${esc(ev.map_url)}" target="_blank" rel="noopener">📍 Googleマップ</a>`
      : '';

    box.innerHTML = `
      <div class="en" style="font-weight:600;color:var(--green-deep)">${dl}</div>
      <div class="place">${esc(ev.place)} ${st}</div>
      ${ev.address ? `<div style="color:var(--brown-2);margin-top:4px">📍 ${esc(ev.address)}</div>` : ''}
      ${(ev.start || ev.end) ? `<div style="color:var(--brown-2)">⏰ ${esc(ev.start)}–${esc(ev.end)}</div>` : ''}
      ${ev.note   ? `<div style="color:var(--brown-2)">📝 ${esc(ev.note)}</div>` : ''}
      ${mapBtn}`;
    box.classList.add('show');
  }

  /* ============================================================
     MENU
  ============================================================ */

  let menuData = [];
  const CAT_ORDER = ['soup', 'sandwich', 'drink', 'side'];
  const catLabel  = { all:'すべて', soup:'スープ', sandwich:'ホットサンド', drink:'ドリンク', side:'サイド' };

  async function loadMenu() {
    setLoading($('#menuGrid'));
    setLoading($('#recGrid'));
    $('#menuFilter').innerHTML = '';

    try {
      const objs = await fetchCSV(MENU_CSV_URL);

      menuData = objs
        .filter(m => m.name)
        .map(m => ({
          cat:       m.category || '',
          name:      m.name     || '',
          desc:      m.desc     || '',
          price:     parseInt(m.price, 10) || 0,
          img:       m.image    || '',
          recommend: isTruthy(m.recommend),
        }))
        .sort((a, b) => {
          const ai = CAT_ORDER.indexOf(a.cat);
          const bi = CAT_ORDER.indexOf(b.cat);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

    } catch (e) {
      console.error('[machi no spoon] menu fetch error:', e);
      setError($('#menuGrid'));
      setError($('#recGrid'));
      return;
    }

    if (!menuData.length) {
      setEmpty($('#menuGrid'), '現在表示できるメニューはありません');
      setEmpty($('#recGrid'), '現在表示できるメニューはありません');
      return;
    }

    renderFilters();
    renderMenu('all');
    renderRecommend();
  }

  function menuImgHTML(m, cls) {
    if (!m.img) {
      return `<div class="ph ${cls}">商品写真</div>`;
    }
    // onerror でプレースホルダーへフォールバック
    return `<img class="${cls}" src="${esc(m.img)}" alt="${esc(m.name)}" loading="lazy"
      onerror="this.outerHTML='<div class=\\'ph ${cls}\\'>商品写真</div>'">`;
  }

  function menuCardHTML(m) {
    const labels = m.recommend ? '<span class="tag star">★ おすすめ</span>' : '';
    return `<div class="card mcard" data-cat="${esc(m.cat)}">
      ${menuImgHTML(m, 'mimg')}
      <div class="mbody">
        <div class="labels">${labels}</div>
        <div class="row1"><h3>${esc(m.name)}</h3></div>
        <div class="row1"><p>${esc(m.desc)}</p><div class="price"><small>¥</small>${m.price}</div></div>
      </div>
    </div>`;
  }

  function renderMenu(cat = 'all') {
    const grid     = $('#menuGrid');
    const filtered = menuData.filter(m => cat === 'all' || m.cat === cat);
    if (!filtered.length) {
      setEmpty(grid, '現在表示できるメニューはありません');
      return;
    }
    grid.innerHTML = filtered.map(menuCardHTML).join('');
  }

  function renderFilters() {
    const wrap = $('#menuFilter');
    wrap.innerHTML = Object.keys(catLabel)
      .map((k, i) => `<button class="pill${i === 0 ? ' on' : ''}" data-cat="${k}">${catLabel[k]}</button>`)
      .join('');
    wrap.addEventListener('click', e => {
      const b = e.target.closest('.pill');
      if (!b) return;
      $$('.pill', wrap).forEach(p => p.classList.toggle('on', p === b));
      renderMenu(b.dataset.cat);
    });
  }

  /* ---------- 今月のおすすめ（カルーセル） ---------- */
  function renderRecommend() {
    const track = $('#recGrid');
    const outer = $('#recCarouselOuter');
    const recs  = menuData.filter(m => m.recommend);

    if (!recs.length) {
      setEmpty(track, '現在表示できるメニューはありません');
      return;
    }

    function makeCard(m, hidden) {
      const el = document.createElement('div');
      el.className = 'card rcard';
      if (hidden) el.setAttribute('aria-hidden', 'true');
      el.innerHTML = `
        <span class="tag star star-tag">★ おすすめ</span>
        ${menuImgHTML(m, 'rimg')}
        <div class="rbody">
          <h3>${esc(m.name)}</h3>
          <div class="rdesc">${esc(m.desc)}</div>
          <div class="rprice en"><small>¥</small>${m.price}</div>
        </div>`;
      return el;
    }

    // オリジナル + クローン（ループ用）を連結
    track.innerHTML = '';
    recs.forEach(m => track.appendChild(makeCard(m, false)));
    recs.forEach(m => track.appendChild(makeCard(m, true)));

    // レイアウト確定後にカルーセルを初期化
    requestAnimationFrame(() => initRecCarousel(track, outer, recs.length));
  }

  /**
   * 無限ループ横スクロールカルーセル
   * - RAF ベースで毎フレーム SPEED px 進む
   * - hover で一時停止、離れたら再開
   * - pointerdown/move/up でドラッグ操作
   */
  function initRecCarousel(track, outer, origCount) {
    const SPEED = 0.45; // px/frame（約27px/s @60fps）

    let pos       = 0;      // 現在のスクロール量（px）
    let setWidth  = 0;      // オリジナル1セット分の幅
    let isPaused  = false;  // hover 一時停止
    let isDragging = false;
    let dragStartX = 0;
    let dragStartPos = 0;

    /** オリジナル1セットの幅を計測 */
    function measureSetWidth() {
      const gap  = parseFloat(getComputedStyle(track).gap) || 16;
      const kids = [...track.children];
      let w = 0;
      for (let i = 0; i < origCount; i++) {
        w += (kids[i] ? kids[i].getBoundingClientRect().width : 0) + gap;
      }
      return w;
    }

    function applyPos() {
      track.style.transform = `translateX(${-pos}px)`;
    }

    function tick() {
      if (!isDragging && !isPaused) {
        pos += SPEED;
        if (!setWidth) setWidth = measureSetWidth();
        if (pos >= setWidth) pos -= setWidth;  // シームレスループ
      }
      applyPos();
      requestAnimationFrame(tick);
    }

    // --- Hover 一時停止（デスクトップ） ---
    outer.addEventListener('mouseenter', () => { isPaused = true;  });
    outer.addEventListener('mouseleave', () => { isPaused = false; });

    // --- ポインタドラッグ（マウス・タッチ共通） ---
    track.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return; // 右クリック無視
      isDragging   = true;
      dragStartX   = e.clientX;
      dragStartPos = pos;
      track.setPointerCapture(e.pointerId);
      e.preventDefault(); // テキスト選択などを防止
    }, { passive: false });

    track.addEventListener('pointermove', e => {
      if (!isDragging) return;
      if (!setWidth) setWidth = measureSetWidth();
      const dx = dragStartX - e.clientX;
      // マイナス方向もループに対応
      pos = ((dragStartPos + dx) % setWidth + setWidth) % setWidth;
      applyPos();
    });

    track.addEventListener('pointerup',     () => { isDragging = false; });
    track.addEventListener('pointercancel', () => { isDragging = false; });

    // 初期計測してからスタート
    setWidth = measureSetWidth();
    tick();
  }

  /* ============================================================
     ギャラリーカルーセル（プレースホルダー）
  ============================================================ */
  function renderCarousel() {
    const posts = ['今日の出店風景','とろ〜りホットサンド','スープの湯気','さくら通りマルシェ','青空とキッチンカー','完売御礼！ありがとう'];
    $('#carousel').innerHTML = posts.map(p => `
      <div class="post">
        <div class="ph pimg">投稿写真<small>${p}</small></div>
        <div class="cap">${p}</div>
      </div>`).join('');
  }

  /* ============================================================
     モバイルドロワーナビ
  ============================================================ */
  function initNav() {
    const btn = $('#menubtn'), drawer = $('#drawer'), overlay = $('#drawerOverlay');
    if (!btn || !drawer) return;

    function openDrawer() {
      drawer.classList.add('open'); overlay.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    }
    function closeDrawer() {
      drawer.classList.remove('open'); overlay.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }
    btn.addEventListener('click', openDrawer);
    overlay.addEventListener('click', closeDrawer);
    $('#drawerClose').addEventListener('click', closeDrawer);
    $$('a', drawer).forEach(a => a.addEventListener('click', closeDrawer));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  }

  /* ============================================================
     注釈トグル
  ============================================================ */
  function initNotes() {
    const t = $('#noteToggle');
    if (!t) return;
    t.addEventListener('click', () => {
      document.body.classList.toggle('hidenotes');
      t.textContent = document.body.classList.contains('hidenotes') ? '📝 注釈を表示' : '📝 注釈を隠す';
    });
  }

  /* ============================================================
     初期化
  ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initNav();
    initNotes();
    renderCarousel();

    // カレンダーナビのイベントを先にバインド（データロード前でも動作）
    $('#calPrev').addEventListener('click', () => {
      calMonth.setMonth(calMonth.getMonth() - 1);
      renderCal();
      $('#calDetail').classList.remove('show');
    });
    $('#calNext').addEventListener('click', () => {
      calMonth.setMonth(calMonth.getMonth() + 1);
      renderCal();
      $('#calDetail').classList.remove('show');
    });

    // CSV を並列取得
    loadSchedule();
    loadMenu();
  });

})();
