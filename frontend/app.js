/* ============================================
   财富自由指南灯 · 纯前端版（GitHub Pages）
   数据存储：localStorage  无需后端服务器
   ============================================ */

(() => {
  'use strict';

  // ===================== 日期工具 =====================
  const _iso = (d) => {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  };
  const parseDate = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);
  const addYears = (d, n) => {
    try { return new Date(d.getFullYear() + n, d.getMonth(), d.getDate()); }
    catch { return new Date(d.getFullYear() + n, d.getMonth(), 28); }
  };
  const todayISO = () => _iso(new Date());
  const nowISO  = () => new Date().toISOString();

  // ===================== 本地文件直连（File System Access API） =====================
  const fileStore = (() => {
    const IDB = 'wg_fs', STORE = 'handles', KEY = 'main';
    let _handle = null, _connected = false;

    function openDB() {
      return new Promise((res, rej) => {
        const r = indexedDB.open(IDB, 1);
        r.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
        r.onsuccess = e => res(e.target.result);
        r.onerror = rej;
      });
    }
    async function idbPut(val) {
      const db = await openDB();
      return new Promise((res, rej) => { const tx = db.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(val, KEY); tx.oncomplete = res; tx.onerror = rej; });
    }
    async function idbGet() {
      const db = await openDB();
      return new Promise((res, rej) => { const tx = db.transaction(STORE,'readonly'); const r = tx.objectStore(STORE).get(KEY); r.onsuccess = e => res(e.target.result); r.onerror = rej; });
    }
    async function idbDel() {
      const db = await openDB();
      return new Promise((res, rej) => { const tx = db.transaction(STORE,'readwrite'); tx.objectStore(STORE).delete(KEY); tx.oncomplete = res; tx.onerror = rej; });
    }
    async function readFile(h) {
      const f = await h.getFile(); const t = await f.text();
      if (!t.trim()) return null; return JSON.parse(t);
    }
    async function writeFile(h, data) {
      const w = await h.createWritable();
      await w.write(JSON.stringify(data, null, 2)); await w.close();
    }

    return {
      get connected() { return _connected; },
      get name() { return _handle?.name || null; },

      async tryRestore() {
        if (!('showSaveFilePicker' in window)) return 'unsupported';
        try {
          const h = await idbGet();
          if (!h) return 'none';
          _handle = h;
          const perm = await h.queryPermission({ mode: 'readwrite' });
          if (perm === 'granted') { _connected = true; return 'connected'; }
          return 'needs-auth';
        } catch { return 'none'; }
      },

      async requestPermission() {
        if (!_handle) return false;
        const p = await _handle.requestPermission({ mode: 'readwrite' });
        if (p === 'granted') { _connected = true; return true; }
        return false;
      },

      async connect() {
        if (!('showSaveFilePicker' in window)) return 'unsupported';
        try {
          const h = await window.showSaveFilePicker({
            suggestedName: 'wealth-grid-data.json',
            types: [{ description: 'JSON 数据文件', accept: { 'application/json': ['.json'] } }],
          });
          _handle = h;
          await idbPut(h);
          _connected = true;
          try { return await readFile(h); } catch { return null; }
        } catch (e) { if (e.name === 'AbortError') return 'cancelled'; throw e; }
      },

      async disconnect() { _handle = null; _connected = false; await idbDel(); },
      async read() {
        if (!_connected || !_handle) return null;
        try { return await readFile(_handle); } catch { return null; }
      },
      async write(settings, transactions) {
        if (!_connected || !_handle) return;
        await writeFile(_handle, { settings, transactions, saved_at: new Date().toISOString() });
      },
    };
  })();

  // ===================== localStorage 存储层 =====================
  const KEYS = { settings: 'wg_settings', transactions: 'wg_transactions' };
  const store = {
    getSettings()     { try { return JSON.parse(localStorage.getItem(KEYS.settings));     } catch { return null; } },
    saveSettings(s)   {
      localStorage.setItem(KEYS.settings, JSON.stringify(s));
      if (fileStore.connected) fileStore.write(s, this.getTxs()).catch(console.error);
    },
    getTxs()          { try { return JSON.parse(localStorage.getItem(KEYS.transactions)) || []; } catch { return []; } },
    saveTxs(txs)      {
      localStorage.setItem(KEYS.transactions, JSON.stringify(txs));
      if (fileStore.connected) fileStore.write(this.getSettings(), txs).catch(console.error);
    },
    addTx(body) {
      const txs = this.getTxs();
      const id = txs.length > 0 ? Math.max(...txs.map(t => t.id)) + 1 : 1;
      const tx = { id, occurred_on: body.occurred_on || todayISO(), type: body.type, amount: body.amount, note: body.note || '', created_at: nowISO() };
      txs.push(tx);
      this.saveTxs(txs);
      return tx;
    },
    delTx(id) { this.saveTxs(this.getTxs().filter(t => t.id !== id)); },
    exportData() {
      return {
        exported_at: nowISO(),
        settings: this.getSettings(),
        transactions: [...this.getTxs()].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.id - b.id),
      };
    },
    importData(data) {
      if (data.settings)     this.saveSettings(data.settings);
      if (data.transactions) this.saveTxs(data.transactions);
    },
  };

  // ===================== 飞书多维表格同步 =====================
  const feishuSync = (() => {
    const CFG_KEY = 'wg_feishu';

    function getCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; } }
    function saveCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }

    function parseUrl(url) {
      try {
        const u = new URL(url.trim());
        const parts = u.pathname.split('/');
        const bi = parts.lastIndexOf('base');
        return { app_token: bi >= 0 ? parts[bi + 1]?.split('?')[0] : null, table_id: u.searchParams.get('table') };
      } catch { return {}; }
    }

    async function getToken(appId, appSecret) {
      const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const d = await r.json();
      if (d.code !== 0) throw new Error('飞书认证失败：' + (d.msg || d.code));
      return d.tenant_access_token;
    }

    async function fetchAll(token, appToken, tableId) {
      const all = []; let page = '';
      do {
        const qs = new URLSearchParams({ page_size: '100' });
        if (page) qs.set('page_token', page);
        const r = await fetch(
          `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?${qs}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const d = await r.json();
        if (d.code !== 0) throw new Error('读取表格失败：' + (d.msg || d.code));
        all.push(...(d.data?.items || []));
        page = d.data?.has_more ? d.data.page_token : '';
      } while (page);
      return all;
    }

    function parseField(v) {
      if (v === null || v === undefined) return null;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) return v.map(x => x.text || '').join('');
      return String(v);
    }

    return {
      getCfg, saveCfg,
      loadIntoForm(els) {
        const c = getCfg();
        if (els.fsUrl)       els.fsUrl.value       = c.url       || '';
        if (els.fsAppId)     els.fsAppId.value     = c.app_id    || '';
        if (els.fsAppSecret) els.fsAppSecret.value = c.app_secret || '';
      },
      saveFromForm(els) {
        const url = els.fsUrl?.value.trim() || '';
        const { app_token, table_id } = parseUrl(url);
        const c = getCfg();
        saveCfg({ ...c, url, app_token, table_id, app_id: els.fsAppId?.value.trim() || '', app_secret: els.fsAppSecret?.value.trim() || '' });
      },
      async sync() {
        const c = getCfg();
        if (!c.app_id || !c.app_secret || !c.app_token || !c.table_id)
          throw new Error('请先在设置中填写飞书表格地址、App ID 和 App Secret');
        const token  = await getToken(c.app_id, c.app_secret);
        const records = await fetchAll(token, c.app_token, c.table_id);
        const synced  = new Set(c.synced_ids || []);
        const newTxs  = [];
        for (const rec of records) {
          if (synced.has(rec.record_id)) continue;
          const f      = rec.fields;
          const amount = parseFloat(parseField(f['金额']));
          if (!(amount > 0)) continue;
          let occurred_on = todayISO();
          const dv = f['日期'];
          if (typeof dv === 'number') occurred_on = _iso(new Date(dv));
          else if (typeof dv === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dv)) occurred_on = dv.slice(0, 10);
          const cat  = parseField(f['类别']) || '';
          const note = parseField(f['备注']) || '';
          newTxs.push({ type: 'expense', amount, occurred_on, note: [cat, note].filter(Boolean).join(' · ') });
          synced.add(rec.record_id);
        }
        saveCfg({ ...c, synced_ids: [...synced] });
        return newTxs;
      },
    };
  })();

  // ===================== 核心计算（对应 Python backend compute_stats）=====================
  function computeStats(settings, transactions) {
    let totalIncome = 0, totalExpense = 0, firstStr = null, lastStr = null;
    for (const tx of transactions) {
      if (tx.type === 'income') totalIncome += tx.amount; else totalExpense += tx.amount;
      if (!firstStr || tx.occurred_on < firstStr) firstStr = tx.occurred_on;
      if (!lastStr  || tx.occurred_on > lastStr)  lastStr  = tx.occurred_on;
    }

    let trackingDays = 0;
    if (firstStr && lastStr)
      trackingDays = Math.max(daysBetween(parseDate(firstStr), parseDate(lastStr)) + 1, 1);

    let avg = (trackingDays > 0 && totalExpense > 0) ? totalExpense / trackingDays : 0;
    const tdOvr  = settings?.tracking_days_override     || 0;
    const avgOvr = settings?.avg_daily_expense_override || 0;
    if (tdOvr  > 0) trackingDays = tdOvr;
    if (avgOvr > 0) avg = avgOvr;

    const useAssets     = !!(settings?.use_initial_assets);
    const initialAssets = settings?.initial_assets || 0;
    const assetFreedom  = (avg > 0 && useAssets && initialAssets > 0) ? Math.floor(initialAssets / avg) : 0;
    const netSavings    = totalIncome - totalExpense;
    const incomeFreedom = (avg > 0 && netSavings > 0) ? Math.floor(netSavings / avg) : 0;
    const freedomDaysBought = assetFreedom + incomeFreedom;

    let futureCells = 0, pastCells = 0;
    if (settings?.birth_date) {
      const todayD = parseDate(todayISO());
      const birth  = parseDate(settings.birth_date);
      const end    = addYears(birth, settings.target_age || 80);
      futureCells  = Math.max(daysBetween(todayD, end), 0);
      pastCells    = Math.max(daysBetween(birth, todayD), 0);
    }
    const showPast   = !!(settings?.show_past);
    const totalCells = showPast ? (pastCells + futureCells) : futureCells;
    const assetLit   = futureCells > 0 ? Math.min(assetFreedom, futureCells) : assetFreedom;
    const incomeLit  = futureCells > 0 ? Math.min(incomeFreedom, Math.max(0, futureCells - assetLit)) : incomeFreedom;
    const lit        = assetLit + incomeLit;
    const overflow   = futureCells > 0 ? Math.max(freedomDaysBought - futureCells, 0) : 0;

    let trackedPastCells = 0;
    if (firstStr && showPast) {
      const firstD = parseDate(firstStr);
      const todayD = parseDate(todayISO());
      if (firstD < todayD) trackedPastCells = Math.min(pastCells, daysBetween(firstD, todayD));
    }
    const r = (n, d = 2) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
    return {
      total_income: r(totalIncome), total_expense: r(totalExpense),
      tracking_days: trackingDays,  avg_daily_expense: r(avg, 4),
      freedom_days_bought: freedomDaysBought,
      asset_freedom: assetFreedom,  income_freedom: incomeFreedom,
      asset_lit: assetLit,          income_lit: incomeLit,
      expense_days_equiv: avg > 0 ? Math.floor(totalExpense / avg) : 0,
      income_days_equiv:  avg > 0 ? Math.floor(totalIncome  / avg) : 0,
      lit_count: lit,               total_cells: totalCells,
      future_cells: futureCells,    past_cells: showPast ? pastCells : 0,
      tracked_past_cells: trackedPastCells,
      show_past: showPast,          use_initial_assets: useAssets,
      initial_assets: r(initialAssets),
      overflow,                     first_record: firstStr, last_record: lastStr,
    };
  }

  // ===================== 本地 API shim =====================
  const api = {
    state: () => Promise.resolve((() => {
      const settings = store.getSettings();
      const txs      = store.getTxs();
      const stats    = computeStats(settings, txs);
      const recent   = [...txs].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.id - a.id).slice(0, 50);
      return { settings, stats, transactions: recent };
    })()),
    settings: (body) => Promise.resolve((() => {
      store.saveSettings(body);
      return { settings: body, stats: computeStats(body, store.getTxs()) };
    })()),
    addTx: (body) => Promise.resolve((() => {
      const settings  = store.getSettings();
      const litBefore = computeStats(settings, store.getTxs()).lit_count;
      const tx        = store.addTx(body);
      const stats     = computeStats(settings, store.getTxs());
      const delta     = stats.lit_count - litBefore;
      return { transaction: tx, stats, lit_before: litBefore, lit_after: stats.lit_count, delta,
               animation: delta > 0 ? 'light_up' : (delta < 0 ? 'extinguish' : 'none') };
    })()),
    delTx: (id) => Promise.resolve((() => {
      const settings  = store.getSettings();
      const litBefore = computeStats(settings, store.getTxs()).lit_count;
      store.delTx(id);
      const stats     = computeStats(settings, store.getTxs());
      const delta     = stats.lit_count - litBefore;
      return { deleted: id, stats, lit_before: litBefore, lit_after: stats.lit_count, delta,
               animation: delta > 0 ? 'light_up' : (delta < 0 ? 'extinguish' : 'none') };
    })()),
  };

  // ===================== 格式化 =====================
  const $ = (sel) => document.querySelector(sel);
  const fmtCNY = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const fmtInt = (n) => Number(n || 0).toLocaleString('zh-CN');

  // ===================== DOM 引用 =====================
  const els = {
    overlay:              $('#overlay'),
    btnSettings:          $('#btn-settings'),
    cfgBirth:             $('#cfg-birth'),
    cfgTargetAge:         $('#cfg-target-age'),
    cfgShowPast:          $('#cfg-show-past'),
    cfgUseAssets:         $('#cfg-use-assets'),
    cfgInitialAssets:     $('#cfg-initial-assets'),
    cfgAssetsField:       $('#cfg-assets-field'),
    cfgTrackingDays:      $('#cfg-tracking-days'),
    cfgAvgExpense:        $('#cfg-avg-expense'),
    cfgSave:              $('#cfg-save'),
    cfgCancel:            $('#cfg-cancel'),
    modalTargetAgeDisplay:$('#modal-target-age-display'),
    ringPct:              $('#ring-pct'),
    litCount:             $('#lit-count'),
    remainingDays:        $('#remaining-days'),
    barAsset:             $('#bar-asset'),
    barIncome:            $('#bar-income'),
    rowAsset:             $('#row-asset'),
    assetDays:            $('#asset-days'),
    assetAmount:          $('#asset-amount'),
    incomeDays:           $('#income-days'),
    netSaving:            $('#net-saving'),
    segBtns:              document.querySelectorAll('.seg__btn'),
    txAmount:             $('#tx-amount'),
    txDate:               $('#tx-date'),
    btnSubmit:            $('#btn-submit'),
    stIncome:             $('#st-income'),
    stExpense:            $('#st-expense'),
    stAvg:                $('#st-avg'),
    stDays:               $('#st-days'),
    txList:               $('#tx-list'),
    txItems:              $('#tx-items'),
    txCount:              $('#tx-count'),
    btnTxToggle:          $('#btn-tx-toggle'),
    legendOverflow:       $('#legend-overflow'),
    legendExpense:        $('#legend-expense'),
    stageFooter:          $('#stage-footer-text'),
    freedomBanner:        $('#freedom-banner'),
    canvas:               $('#grid'),
    starfield:            $('#starfield'),
    btnExport:            $('#btn-export'),
    btnImport:            $('#btn-import'),
    fileImport:           $('#file-import'),
    dataStatusText:       $('#data-status-text'),
    fileLink:             $('#file-link'),
    fileLinkDot:          $('#file-link-dot'),
    fileLinkName:         $('#file-link-name'),
    btnFileLink:          $('#btn-file-link'),
    btnFeishuSync:        $('#btn-feishu-sync'),
    fsUrl:                $('#fs-url'),
    fsAppId:              $('#fs-app-id'),
    fsAppSecret:          $('#fs-app-secret'),
  };

  // ===================== 引擎 =====================
  const audio = new window.RitualAudio();
  const grid  = new window.LifeGrid(els.canvas, audio);
  const stars = new window.Starfield(els.starfield);
  document.addEventListener('pointerdown', () => audio.ensure(), { once: true });

  // ===================== 全局 state =====================
  const state = {
    settings: null,
    stats: { total_income: 0, total_expense: 0, tracking_days: 0, avg_daily_expense: 0,
             freedom_days_bought: 0, total_cells: 0, lit_count: 0, overflow: 0,
             expense_days_equiv: 0 },
    transactions: [],
    txType: 'income',
    busy: false,
  };

  // ===================== DatePicker =====================
  class DatePicker {
    constructor(root) {
      this.root     = root;
      this.hidden   = root.querySelector('input[type=hidden]');
      this.trigger  = root.querySelector('.date-input__trigger');
      this.valueEl  = root.querySelector('.date-input__value');
      this.popover  = root.querySelector('.date-popover');
      this.titleEl  = root.querySelector('.date-popover__title');
      this.gridEl   = root.querySelector('.date-popover__grid');
      this.viewYear = new Date().getFullYear();
      this.viewMonth= new Date().getMonth();
      this._bind();
      this._sync();
    }
    get value() { return this.hidden.value || ''; }
    setValue(iso) {
      this.hidden.value = iso || '';
      if (iso) { const d = this._parse(iso); this.viewYear = d.getFullYear(); this.viewMonth = d.getMonth(); }
      this._sync();
      this.root.dispatchEvent(new CustomEvent('change', { detail: this.value }));
    }
    open() {
      if (this.value) { const d = this._parse(this.value); this.viewYear = d.getFullYear(); this.viewMonth = d.getMonth(); }
      this._render();
      this.popover.hidden = false;
      this._positionPopover();
      this.root.classList.add('is-open');
      setTimeout(() => document.addEventListener('pointerdown', this._outside, true), 0);
      document.addEventListener('keydown', this._onEsc);
    }
    close() {
      this.popover.hidden = true;
      this.root.classList.remove('is-open');
      document.removeEventListener('pointerdown', this._outside, true);
      document.removeEventListener('keydown', this._onEsc);
    }
    _positionPopover() {
      const rect = this.trigger.getBoundingClientRect();
      const popW = 280, popH = 340, margin = 8;
      const vw = window.innerWidth, vh = window.innerHeight;
      // 水平：左对齐，超出右边界则右对齐
      let left = rect.left;
      if (left + popW > vw - margin) left = Math.max(margin, vw - popW - margin);
      // 垂直：下方空间足够则向下，否则向上
      const spaceBelow = vh - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      let top;
      if (spaceBelow >= popH || spaceBelow >= spaceAbove) {
        top = rect.bottom + 6;
        this.popover.style.maxHeight = Math.min(popH, spaceBelow) + 'px';
      } else {
        top = Math.max(margin, rect.top - popH - 6);
        this.popover.style.maxHeight = Math.min(popH, spaceAbove) + 'px';
      }
      this.popover.style.left = left + 'px';
      this.popover.style.top  = top  + 'px';
    }
    _bind() {
      this.trigger.addEventListener('click', () => this.popover.hidden ? this.open() : this.close());
      this.popover.addEventListener('click', (e) => {
        const nav    = e.target.closest('[data-nav]');
        const action = e.target.closest('[data-action]');
        const day    = e.target.closest('[data-day]');
        if (nav) {
          const dir = nav.dataset.nav;
          if (dir === 'prev')           { if (--this.viewMonth < 0)  { this.viewMonth = 11; this.viewYear--; } }
          else if (dir === 'next')      { if (++this.viewMonth > 11) { this.viewMonth = 0;  this.viewYear++; } }
          else if (dir === 'prev-year') this.viewYear--;
          else if (dir === 'next-year') this.viewYear++;
          this._render();
        } else if (action === null && day) {
          if (!day.classList.contains('is-disabled')) { this.setValue(day.dataset.day); this.close(); }
        } else if (action) {
          if (action.dataset.action === 'today') { this.setValue(_iso(new Date())); this.close(); }
          else if (action.dataset.action === 'clear') { this.setValue(''); this.close(); }
        }
      });
      this._outside = (e) => { if (!this.root.contains(e.target) && !this.popover.contains(e.target)) this.close(); };
      this._onEsc   = (e) => { if (e.key === 'Escape') this.close(); };
    }
    _sync() {
      const v = this.value;
      if (v) {
        const d = this._parse(v);
        this.valueEl.textContent = `${d.getFullYear()} 年 ${d.getMonth()+1} 月 ${d.getDate()} 日`;
        this.root.classList.remove('is-empty');
      } else {
        this.valueEl.textContent = this.valueEl.dataset.placeholder || '选择日期';
        this.root.classList.add('is-empty');
      }
    }
    _render() {
      this.titleEl.textContent = `${this.viewYear} 年 ${this.viewMonth + 1} 月`;
      const y = this.viewYear, m = this.viewMonth;
      const todayStr = _iso(new Date()), valueStr = this.value;
      const first = new Date(y, m, 1);
      const daysIn = new Date(y, m + 1, 0).getDate();
      const prevLast = new Date(y, m, 0).getDate();
      const startDow = first.getDay();
      const cells = [];
      for (let i = startDow - 1; i >= 0; i--) cells.push({ d: new Date(y, m-1, prevLast-i), day: prevLast-i, other: true });
      for (let day = 1; day <= daysIn; day++) cells.push({ d: new Date(y, m, day), day, other: false });
      while (cells.length < 42) { const k = cells.length - startDow - daysIn + 1; cells.push({ d: new Date(y, m+1, k), day: k, other: true }); }
      this.gridEl.innerHTML = cells.map(c => {
        const iso = this._iso(c.d);
        const cls = ['date-day'];
        if (c.other) cls.push('is-other');
        if (iso === todayStr) cls.push('is-today');
        if (iso === valueStr) cls.push('is-selected');
        return `<button type="button" class="${cls.join(' ')}" data-day="${iso}">${c.day}</button>`;
      }).join('');
    }
    _iso(d) { const m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0'); return `${d.getFullYear()}-${m}-${day}`; }
    _parse(iso) { const [y,m,d] = iso.split('-').map(Number); return new Date(y, m-1, d); }
  }

  const datePickers = new Map();
  document.querySelectorAll('.date-input[data-picker]').forEach(root => {
    const id = root.querySelector('input[type=hidden]').id;
    datePickers.set(id, new DatePicker(root));
  });
  const txDP    = datePickers.get('tx-date');
  const birthDP = datePickers.get('cfg-birth');

  // ===================== 渲染 =====================
  function renderProgress() {
    const s = state.stats;
    const future = s.future_cells || s.total_cells || 1;
    const lit    = s.lit_count || 0;
    els.ringPct.textContent = (Math.min(lit / future, 1) * 100).toFixed(1);
    els.litCount.textContent = fmtInt(lit);
    els.remainingDays.textContent = fmtInt(Math.max(0, future - lit));
    const denom = (s.future_cells || s.total_cells) || 1;
    els.barAsset.style.width  = Math.min(100, (s.asset_lit / denom) * 100).toFixed(2) + '%';
    els.barIncome.style.width = Math.min(100 - (s.asset_lit / denom) * 100, (s.income_lit / denom) * 100).toFixed(2) + '%';
    const showAsset = !!(s.use_initial_assets && s.initial_assets > 0);
    els.rowAsset.hidden = !showAsset;
    els.assetDays.textContent  = fmtInt(s.asset_lit || 0);
    els.assetAmount.textContent = fmtCNY(s.initial_assets || 0);
    els.incomeDays.textContent  = fmtInt(s.income_lit || 0);
    els.netSaving.textContent   = fmtCNY(Math.max(0, (s.total_income || 0) - (s.total_expense || 0)));
    els.legendOverflow.hidden = !s.overflow;
    els.legendExpense.hidden  = true; // 支出区改为熄灭色，图例不再单独显示
  }

  function renderStats() {
    const s = state.stats;
    els.stIncome.textContent  = fmtCNY(s.total_income);
    els.stExpense.textContent = fmtCNY(s.total_expense);
    els.stAvg.textContent     = fmtCNY(s.avg_daily_expense);
    els.stDays.textContent    = fmtInt(s.tracking_days);
    els.stageFooter.textContent = s.tracking_days > 0
      ? `已记账 ${s.tracking_days} 天 · 平均日花销 ${fmtCNY(s.avg_daily_expense)} · 已买 ${fmtInt(s.lit_count)} 天自由`
      : '设置生日后开始你的财富自由之旅';
  }

  function renderTxList(autoExpand = false) {
    const items = state.transactions;
    els.txCount.textContent = items.length ? `(${items.length})` : '';
    els.txList.classList.toggle('is-empty', items.length === 0);
    if (autoExpand && items.length > 0) {
      els.txList.classList.add('is-open');
      els.btnTxToggle.setAttribute('aria-expanded', 'true');
    }
    els.txItems.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const t of items) {
      const li = document.createElement('li');
      li.className = `tx-item tx-item--${t.type}`;
      li.innerHTML = `
        <span class="tx-item__bar"></span>
        <div class="tx-item__main">
          <div class="tx-item__note">${escHtml(t.note) || (t.type === 'income' ? '收入' : '支出')}</div>
          <div class="tx-item__date">${t.occurred_on}</div>
        </div>
        <div class="tx-item__amount">${t.type === 'income' ? '+' : '−'}${fmtCNY(t.amount)}</div>
        <button class="tx-item__del" title="删除" aria-label="删除交易">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>`;
      li.querySelector('.tx-item__del').addEventListener('click', () => onDelete(t.id));
      frag.appendChild(li);
    }
    els.txItems.appendChild(frag);
  }

  const escHtml = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  function renderAll() { renderProgress(); renderStats(); renderTxList(); }

  // ===================== 交互编排 =====================
  async function loadAndPaint() {
    const data = await api.state();
    state.settings     = data.settings;
    state.stats        = data.stats;
    state.transactions = data.transactions;
    grid.setData(state.stats);
    renderAll();
    if (!state.settings) showOverlay();
  }

  function showOverlay() {
    els.overlay.hidden = false;
    birthDP.setValue(state.settings?.birth_date || '');
    els.cfgTargetAge.value     = state.settings?.target_age || 80;
    els.cfgShowPast.checked    = !!(state.settings?.show_past);
    els.cfgUseAssets.checked   = !!(state.settings?.use_initial_assets);
    els.cfgInitialAssets.value = state.settings?.initial_assets || '';
    els.cfgTrackingDays.value  = state.settings?.tracking_days_override || '';
    els.cfgAvgExpense.value    = state.settings?.avg_daily_expense_override || '';
    els.cfgAssetsField.hidden  = !els.cfgUseAssets.checked;
    els.modalTargetAgeDisplay.textContent = els.cfgTargetAge.value;
    feishuSync.loadIntoForm(els);
    setTimeout(() => birthDP.trigger.focus(), 80);
  }
  function hideOverlay() { els.overlay.hidden = true; }

  els.btnSettings.addEventListener('click', showOverlay);
  els.btnTxToggle.addEventListener('click', () => {
    const open = els.txList.classList.toggle('is-open');
    els.btnTxToggle.setAttribute('aria-expanded', open.toString());
  });
  els.cfgCancel.addEventListener('click', () => { if (state.settings) hideOverlay(); });
  els.cfgTargetAge.addEventListener('input', e => { els.modalTargetAgeDisplay.textContent = e.target.value || '80'; });
  els.cfgUseAssets.addEventListener('change', () => {
    els.cfgAssetsField.hidden = !els.cfgUseAssets.checked;
    if (els.cfgUseAssets.checked) setTimeout(() => els.cfgInitialAssets.focus(), 60);
  });

  els.cfgSave.addEventListener('click', async () => {
    if (state.busy) return;
    const birth = birthDP.value;
    if (!birth) { birthDP.open(); return; }
    state.busy = true;
    try {
      const r = await api.settings({
        birth_date: birth, target_age: parseInt(els.cfgTargetAge.value, 10) || 80, currency: 'CNY',
        show_past:                  !!(els.cfgShowPast.checked),
        use_initial_assets:         !!(els.cfgUseAssets.checked),
        initial_assets:             parseFloat(els.cfgInitialAssets.value) || 0,
        tracking_days_override:     parseInt(els.cfgTrackingDays.value, 10) || 0,
        avg_daily_expense_override: parseFloat(els.cfgAvgExpense.value) || 0,
      });
      state.settings = r.settings; state.stats = r.stats;
      feishuSync.saveFromForm(els);
      grid.setData(state.stats); renderAll(); hideOverlay();
    } finally { state.busy = false; }
  });

  els.segBtns.forEach(b => {
    b.addEventListener('click', () => {
      els.segBtns.forEach(x => { x.classList.toggle('is-active', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      state.txType = b.dataset.type;
      els.btnSubmit.querySelector('.btn__text').textContent = state.txType === 'income' ? '点亮人生' : '记下花销';
    });
  });

  txDP.setValue(todayISO());
  els.txAmount.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onSubmitTx(); } });
  els.btnSubmit.addEventListener('click', onSubmitTx);

  async function onSubmitTx() {
    if (state.busy) return;
    if (!state.settings) { showOverlay(); return; }
    const amount = parseFloat(els.txAmount.value);
    if (!(amount > 0)) { els.txAmount.focus(); return; }
    audio.ensure();
    state.busy = true; els.btnSubmit.disabled = true;
    try {
      const res = await api.addTx({ type: state.txType, amount, note: '', occurred_on: txDP.value || todayISO() });
      state.transactions.unshift(res.transaction);
      state.transactions = state.transactions.slice(0, 50);
      state.stats = res.stats;
      renderStats(); renderTxList(true);
      els.txAmount.value = '';
      await playAnimation(res);
      grid.setData(state.stats); renderProgress();
    } catch (e) { console.error(e); }
    finally { state.busy = false; els.btnSubmit.disabled = false; }
  }

  async function onDelete(id) {
    if (state.busy) return;
    audio.ensure(); state.busy = true;
    try {
      const res = await api.delTx(id);
      state.transactions = state.transactions.filter(t => t.id !== id);
      state.stats = res.stats;
      renderStats(); renderTxList(false);
      await playAnimation(res);
      grid.setData(state.stats); renderProgress();
    } catch (e) { console.error(e); }
    finally { state.busy = false; }
  }

  async function playAnimation(res) {
    const before = res.lit_before ?? 0;
    const after  = res.lit_after  ?? 0;
    if (after > before)      await grid.lightUp(before, after);
    else if (after < before) await grid.extinguish(after, before);
    const future = state.stats.future_cells || 0;
    if (future > 0 && after >= future && before < future) await celebrateFreedom();
  }

  async function celebrateFreedom() {
    grid.pause();
    els.freedomBanner.hidden = false;
    if (audio?.celebrateChord) audio.celebrateChord();
    await new Promise(r => setTimeout(r, 6500));
    els.freedomBanner.hidden = true;
    grid.resume();
  }

  // ===================== 导出 =====================
  els.btnExport.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store.exportData(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `ledger-${todayISO()}.json`; a.click();
    URL.revokeObjectURL(a.href);
    els.dataStatusText.textContent = '备份已导出 ✓';
    setTimeout(() => { els.dataStatusText.textContent = '已保存到本地'; }, 3000);
  });

  // ===================== 导入 =====================
  els.btnImport.addEventListener('click', () => els.fileImport.click());
  els.fileImport.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.transactions && !data.settings) throw new Error('格式不正确');
      if (!confirm(`将导入 ${(data.transactions || []).length} 笔交易，现有数据将被替换，确认吗？`)) return;
      store.importData(data);
      els.dataStatusText.textContent = '导入成功 ✓';
      setTimeout(() => { els.dataStatusText.textContent = '已保存到本地'; }, 3000);
      await loadAndPaint();
    } catch (err) { alert('导入失败：' + err.message); }
    finally { els.fileImport.value = ''; }
  });

  // ===================== 飞书同步按钮 =====================
  els.btnFeishuSync.addEventListener('click', async () => {
    if (state.busy) return;
    const btn = els.btnFeishuSync;
    const origText = btn.textContent;
    btn.textContent = '同步中…'; btn.disabled = true; state.busy = true;
    try {
      const newTxs = await feishuSync.sync();
      if (newTxs.length === 0) {
        els.dataStatusText.textContent = '没有新记录';
        setTimeout(() => { els.dataStatusText.textContent = fileStore.connected ? '已连接本地文件' : '已保存到本地'; }, 2500);
        return;
      }
      // Batch import
      const litBefore = computeStats(store.getSettings(), store.getTxs()).lit_count;
      for (const tx of newTxs) store.addTx(tx);
      const txsAfter   = store.getTxs();
      const statsAfter = computeStats(store.getSettings(), txsAfter);
      state.stats        = statsAfter;
      state.transactions = [...txsAfter].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.id - a.id).slice(0, 50);
      renderStats(); renderTxList(true);
      grid.setData(statsAfter);
      const litAfter = statsAfter.lit_count;
      if (litAfter > litBefore)      await grid.lightUp(litBefore, litAfter);
      else if (litAfter < litBefore) await grid.extinguish(litAfter, litBefore);
      renderProgress();
      els.dataStatusText.textContent = `飞书同步完成，导入 ${newTxs.length} 笔`;
      setTimeout(() => { els.dataStatusText.textContent = fileStore.connected ? '已连接本地文件' : '已保存到本地'; }, 3000);
    } catch (err) {
      console.error(err);
      els.dataStatusText.textContent = '同步失败：' + err.message;
      setTimeout(() => { els.dataStatusText.textContent = fileStore.connected ? '已连接本地文件' : '已保存到本地'; }, 4000);
    } finally {
      btn.textContent = origText; btn.disabled = false; state.busy = false;
    }
  });

  // ===================== 本地文件直连 UI =====================
  function updateFileLinkUI(status) {
    const { fileLinkDot: dot, fileLinkName: name, btnFileLink: btn } = els;
    if (status === 'connected') {
      dot.className = 'file-link__dot file-link__dot--on';
      name.textContent = fileStore.name || '本地文件';
      btn.textContent = '断开';
      btn.dataset.action = 'disconnect';
    } else if (status === 'needs-auth') {
      dot.className = 'file-link__dot file-link__dot--warn';
      name.textContent = (fileStore.name || '需重新授权');
      btn.textContent = '重新授权';
      btn.dataset.action = 'reauth';
    } else {
      dot.className = 'file-link__dot';
      name.textContent = '未连接';
      btn.textContent = '连接文件';
      btn.dataset.action = 'connect';
    }
  }

  async function initFileLink() {
    if (!('showSaveFilePicker' in window)) return;
    els.fileLink.hidden = false;
    const status = await fileStore.tryRestore();
    updateFileLinkUI(status);
    if (status === 'connected') {
      const data = await fileStore.read();
      if (data) store.importData(data);
      els.dataStatusText.textContent = '已连接本地文件';
    }
    els.btnFileLink.addEventListener('click', async () => {
      const action = els.btnFileLink.dataset.action;
      if (action === 'connect') {
        const result = await fileStore.connect();
        if (result === 'cancelled' || result === 'unsupported') return;
        if (result && (result.settings || (result.transactions && result.transactions.length > 0))) {
          if (confirm(`文件中已有数据（${(result.transactions || []).length} 笔交易），是否载入并替换当前数据？`)) {
            store.importData(result);
            await loadAndPaint();
          } else {
            await fileStore.write(store.getSettings(), store.getTxs()).catch(console.error);
          }
        } else {
          await fileStore.write(store.getSettings(), store.getTxs()).catch(console.error);
        }
        updateFileLinkUI('connected');
        els.dataStatusText.textContent = '已连接本地文件 ✓';
        setTimeout(() => { els.dataStatusText.textContent = '已连接本地文件'; }, 2500);
      } else if (action === 'reauth') {
        const ok = await fileStore.requestPermission();
        if (ok) {
          const data = await fileStore.read();
          if (data) { store.importData(data); await loadAndPaint(); }
          updateFileLinkUI('connected');
          els.dataStatusText.textContent = '已连接本地文件';
        }
      } else if (action === 'disconnect') {
        await fileStore.disconnect();
        updateFileLinkUI('none');
        els.dataStatusText.textContent = '已保存到本地';
      }
    });
  }

  // ===================== 启动 =====================
  grid.mount();
  stars.mount();
  initFileLink().then(() => loadAndPaint());

})();
