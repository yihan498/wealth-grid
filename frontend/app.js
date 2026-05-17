/* ============================================
   财富自由指南灯 · 主控
   [POS] frontend/app.js — UI 状态机 + API 网关 + 仪式编排
   [INPUT] window.LifeGrid · backend REST
   [PROTOCOL] 接口契约见 设计方案.md §4
   ============================================ */

(() => {
  'use strict';

  const API = '/api';
  const $ = (sel) => document.querySelector(sel);
  const fmtCNY = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const fmtInt = (n) => Number(n || 0).toLocaleString('zh-CN');
  const todayISO = () => new Date().toISOString().slice(0, 10);

  // ---------- API client ----------
  const api = {
    state:    () => fetch(`${API}/state`).then(r => r.json()),
    settings: (body) => post(`${API}/settings`, body),
    addTx:    (body) => post(`${API}/transactions`, body),
    delTx:    (id) => fetch(`${API}/transactions/${id}`, { method: 'DELETE' }).then(r => r.json()),
  };
  async function post(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  }

  // ---------- 全局 state ----------
  const state = {
    settings: null,
    stats: { total_income: 0, total_expense: 0, tracking_days: 0, avg_daily_expense: 0,
             freedom_days_bought: 0, total_cells: 0, lit_count: 0, overflow: 0 },
    transactions: [],
    txType: 'income',
    busy: false,
  };

  // ---------- 引用 ----------
  const els = {
    overlay: $('#overlay'),
    btnSettings: $('#btn-settings'),
    cfgBirth: $('#cfg-birth'),
    cfgTargetAge: $('#cfg-target-age'),
    cfgShowPast: $('#cfg-show-past'),
    cfgUseAssets: $('#cfg-use-assets'),
    cfgInitialAssets: $('#cfg-initial-assets'),
    cfgAssetsField: $('#cfg-assets-field'),
    cfgTrackingDays: $('#cfg-tracking-days'),
    cfgAvgExpense: $('#cfg-avg-expense'),
    cfgSave: $('#cfg-save'),
    cfgCancel: $('#cfg-cancel'),
    modalTargetAgeDisplay: $('#modal-target-age-display'),

    ringPct: $('#ring-pct'),
    litCount: $('#lit-count'),
    remainingDays: $('#remaining-days'),
    barAsset: $('#bar-asset'),
    barIncome: $('#bar-income'),
    rowAsset: $('#row-asset'),
    assetDays: $('#asset-days'),
    assetAmount: $('#asset-amount'),
    incomeDays: $('#income-days'),
    netSaving: $('#net-saving'),
    avgDisplay: $('#avg-display'),

    segBtns: document.querySelectorAll('.seg__btn'),
    txAmount: $('#tx-amount'),
    txDate: $('#tx-date'),
    txNote: $('#tx-note'),
    btnSubmit: $('#btn-submit'),

    stIncome: $('#st-income'),
    stExpense: $('#st-expense'),
    stAvg: $('#st-avg'),
    stDays: $('#st-days'),

    txList: $('.tx-list'),
    txItems: $('#tx-items'),
    txCount: $('#tx-count'),

    legendOverflow: $('#legend-overflow'),
    legendExpense: $('#legend-expense'),
    stageFooter: $('#stage-footer-text'),
    freedomBanner: $('#freedom-banner'),

    canvas: $('#grid'),
    starfield: $('#starfield'),

    btnExport: $('#btn-export'),
    dataStatusText: $('#data-status-text'),
  };

  // ---------- 引擎 ----------
  const audio = new window.RitualAudio();
  const grid = new window.LifeGrid(els.canvas, audio);
  const stars = new window.Starfield(els.starfield);

  // 首次点击任意按钮即解锁 AudioContext（autoplay policy）
  const primeAudio = () => audio.ensure();
  document.addEventListener('pointerdown', primeAudio, { once: true });

  // ============================================
  // DatePicker · cinematic dark calendar
  //   - 包装 input[type=hidden] · 暴露 .value / change 事件
  //   - 每个 .date-input[data-picker] 实例化一次
  // ============================================
  class DatePicker {
    constructor(root) {
      this.root = root;
      this.hidden = root.querySelector('input[type=hidden]');
      this.trigger = root.querySelector('.date-input__trigger');
      this.valueEl = root.querySelector('.date-input__value');
      this.popover = root.querySelector('.date-popover');
      this.titleEl = root.querySelector('.date-popover__title');
      this.gridEl  = root.querySelector('.date-popover__grid');
      this.viewYear = new Date().getFullYear();
      this.viewMonth = new Date().getMonth();
      this._bind();
      this._sync();
    }
    get value() { return this.hidden.value || ''; }
    setValue(iso) {
      this.hidden.value = iso || '';
      if (iso) {
        const d = this._parse(iso);
        this.viewYear = d.getFullYear();
        this.viewMonth = d.getMonth();
      }
      this._sync();
      this.root.dispatchEvent(new CustomEvent('change', { detail: this.value }));
    }
    open() {
      const v = this.value;
      if (v) {
        const d = this._parse(v);
        this.viewYear = d.getFullYear();
        this.viewMonth = d.getMonth();
      }
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
      const rect   = this.trigger.getBoundingClientRect();
      const popW   = 280;
      const popH   = 340;   // 估算高度（含 footer）
      const margin = 8;
      const vw = window.innerWidth, vh = window.innerHeight;

      // 水平：优先左对齐，超出右边界则右对齐
      let left = rect.left;
      if (left + popW > vw - margin) left = Math.max(margin, vw - popW - margin);

      // 垂直：下方空间够则向下，否则向上
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
        const nav = e.target.closest('[data-nav]');
        const action = e.target.closest('[data-action]');
        const day = e.target.closest('[data-day]');
        if (nav) {
          const dir = nav.dataset.nav;
          if (dir === 'prev')      { if (--this.viewMonth < 0) { this.viewMonth = 11; this.viewYear--; } }
          else if (dir === 'next') { if (++this.viewMonth > 11) { this.viewMonth = 0; this.viewYear++; } }
          else if (dir === 'prev-year') this.viewYear--;
          else if (dir === 'next-year') this.viewYear++;
          this._render();
        } else if (action === null && day) {
          if (!day.classList.contains('is-disabled')) {
            this.setValue(day.dataset.day);
            this.close();
          }
        } else if (action) {
          if (action.dataset.action === 'today')  { this.setValue(this._iso(new Date())); this.close(); }
          else if (action.dataset.action === 'clear') { this.setValue(''); this.close(); }
        }
      });
      this._outside = (e) => { if (!this.root.contains(e.target)) this.close(); };
      this._onEsc = (e) => { if (e.key === 'Escape') this.close(); };
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
      const todayISO = this._iso(new Date());
      const valueISO = this.value;
      const first = new Date(y, m, 1);
      const daysIn = new Date(y, m + 1, 0).getDate();
      const prevLast = new Date(y, m, 0).getDate();
      const startDow = first.getDay();
      const cells = [];
      for (let i = startDow - 1; i >= 0; i--) {
        const d = new Date(y, m - 1, prevLast - i);
        cells.push({ d, day: prevLast - i, other: true });
      }
      for (let day = 1; day <= daysIn; day++) {
        cells.push({ d: new Date(y, m, day), day, other: false });
      }
      while (cells.length < 42) {
        const k = cells.length - startDow - daysIn + 1;
        cells.push({ d: new Date(y, m + 1, k), day: k, other: true });
      }
      this.gridEl.innerHTML = cells.map(c => {
        const iso = this._iso(c.d);
        const cls = ['date-day'];
        if (c.other) cls.push('is-other');
        if (iso === todayISO) cls.push('is-today');
        if (iso === valueISO) cls.push('is-selected');
        return `<button type="button" class="${cls.join(' ')}" data-day="${iso}">${c.day}</button>`;
      }).join('');
    }
    _iso(d) {
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${m}-${day}`;
    }
    _parse(iso) {
      // 避免时区误差，按本地零点解析
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
  }

  // 实例化所有 date-input
  const datePickers = new Map();
  document.querySelectorAll('.date-input[data-picker]').forEach(root => {
    const id = root.querySelector('input[type=hidden]').id;
    datePickers.set(id, new DatePicker(root));
  });
  const txDP = datePickers.get('tx-date');
  const birthDP = datePickers.get('cfg-birth');

  // ============================================
  // 渲染
  // ============================================
  function renderProgress() {
    const s = state.stats;
    const future = s.future_cells || s.total_cells || 1;
    const lit = s.lit_count || 0;
    // 百分比 = 已点亮 / 从今天到终结日 · 与 show_past 无关
    const ratio = Math.min(lit / future, 1);

    // 标题百分比
    els.ringPct.textContent = (ratio * 100).toFixed(1);

    // 大数字 + 副标
    els.litCount.textContent = fmtInt(lit);
    els.remainingDays.textContent = fmtInt(Math.max(0, future - lit));

    // 双段进度条（按未来格 future_cells 算比例，避免 show_past 模式下被 past 段稀释）
    const denom = (s.future_cells || s.total_cells) || 1;
    const assetPct = Math.min(100, (s.asset_lit / denom) * 100);
    const incomePct = Math.min(100 - assetPct, (s.income_lit / denom) * 100);
    els.barAsset.style.width = assetPct.toFixed(2) + '%';
    els.barIncome.style.width = incomePct.toFixed(2) + '%';

    // 分项
    const showAsset = !!s.use_initial_assets && s.initial_assets > 0;
    els.rowAsset.hidden = !showAsset;
    els.assetDays.textContent = fmtInt(s.asset_lit || 0);
    els.assetAmount.textContent = fmtCNY(s.initial_assets || 0);
    els.incomeDays.textContent = fmtInt(s.income_lit || 0);
    els.netSaving.textContent = fmtCNY(Math.max(0, (s.total_income || 0) - (s.total_expense || 0)));

    els.legendOverflow.hidden = !s.overflow;
    els.legendExpense.hidden = true; // 支出区改为熄灭色，图例不再单独显示
  }

  function renderStats() {
    const s = state.stats;
    els.stIncome.textContent = fmtCNY(s.total_income);
    els.stExpense.textContent = fmtCNY(s.total_expense);
    els.stAvg.textContent = fmtCNY(s.avg_daily_expense);
    els.stDays.textContent = fmtInt(s.tracking_days);

    if (s.tracking_days > 0) {
      els.stageFooter.textContent =
        `已记账 ${s.tracking_days} 天 · 平均日花销 ${fmtCNY(s.avg_daily_expense)} · 已买 ${fmtInt(s.lit_count)} 天自由`;
    } else {
      els.stageFooter.textContent = '设置生日后开始你的财富自由之旅';
    }
  }

  function renderTxList() {
    const items = state.transactions;
    els.txCount.textContent = items.length;
    els.txList.classList.toggle('is-empty', items.length === 0);
    els.txItems.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const t of items) {
      const li = document.createElement('li');
      li.className = `tx-item tx-item--${t.type}`;
      li.innerHTML = `
        <span class="tx-item__bar"></span>
        <div class="tx-item__main">
          <div class="tx-item__note">${escapeHtml(t.note) || (t.type === 'income' ? '收入' : '支出')}</div>
          <div class="tx-item__date">${t.occurred_on}</div>
        </div>
        <div class="tx-item__amount">${t.type === 'income' ? '+' : '−'}${fmtCNY(t.amount)}</div>
        <button class="tx-item__del" title="删除" aria-label="删除交易">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      `;
      li.querySelector('.tx-item__del').addEventListener('click', () => onDelete(t.id));
      frag.appendChild(li);
    }
    els.txItems.appendChild(frag);
  }

  const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  function renderAll() {
    renderProgress();
    renderStats();
    renderTxList();
  }

  // ============================================
  // 交互编排
  // ============================================
  async function loadAndPaint() {
    const data = await api.state();
    state.settings = data.settings;
    state.stats = data.stats;
    state.transactions = data.transactions;
    grid.setData(state.stats);
    renderAll();
    if (!state.settings) showOverlay();
  }

  function showOverlay() {
    els.overlay.hidden = false;
    birthDP.setValue(state.settings?.birth_date || '');
    els.cfgTargetAge.value = state.settings?.target_age || 80;
    els.cfgShowPast.checked = !!state.settings?.show_past;
    els.cfgUseAssets.checked = !!state.settings?.use_initial_assets;
    els.cfgInitialAssets.value = state.settings?.initial_assets || '';
    els.cfgTrackingDays.value = state.settings?.tracking_days_override || '';
    els.cfgAvgExpense.value = state.settings?.avg_daily_expense_override || '';
    els.cfgAssetsField.hidden = !els.cfgUseAssets.checked;
    els.modalTargetAgeDisplay.textContent = els.cfgTargetAge.value;
    setTimeout(() => birthDP.trigger.focus(), 80);
  }
  function hideOverlay() { els.overlay.hidden = true; }

  // 设置面板
  els.btnSettings.addEventListener('click', showOverlay);
  els.cfgCancel.addEventListener('click', () => { if (state.settings) hideOverlay(); });
  els.cfgTargetAge.addEventListener('input', e => {
    els.modalTargetAgeDisplay.textContent = e.target.value || '80';
  });
  els.cfgUseAssets.addEventListener('change', () => {
    els.cfgAssetsField.hidden = !els.cfgUseAssets.checked;
    if (els.cfgUseAssets.checked) setTimeout(() => els.cfgInitialAssets.focus(), 60);
  });

  els.cfgSave.addEventListener('click', async () => {
    if (state.busy) return;
    const birth = birthDP.value;
    const age = parseInt(els.cfgTargetAge.value, 10) || 80;
    if (!birth) { birthDP.open(); return; }
    state.busy = true;
    try {
      const r = await api.settings({
        birth_date: birth,
        target_age: age,
        currency: 'CNY',
        show_past: !!els.cfgShowPast.checked,
        use_initial_assets: !!els.cfgUseAssets.checked,
        initial_assets: parseFloat(els.cfgInitialAssets.value) || 0,
        tracking_days_override: parseInt(els.cfgTrackingDays.value, 10) || 0,
        avg_daily_expense_override: parseFloat(els.cfgAvgExpense.value) || 0,
      });
      state.settings = r.settings;
      state.stats = r.stats;
      grid.setData(state.stats);
      renderAll();
      hideOverlay();
    } finally { state.busy = false; }
  });

  // 类型分段切换
  els.segBtns.forEach(b => {
    b.addEventListener('click', () => {
      els.segBtns.forEach(x => {
        x.classList.toggle('is-active', x === b);
        x.setAttribute('aria-selected', x === b ? 'true' : 'false');
      });
      state.txType = b.dataset.type;
      els.btnSubmit.querySelector('.btn__text').textContent =
        state.txType === 'income' ? '点亮人生' : '记下花销';
    });
  });

  txDP.setValue(todayISO());
  els.txAmount.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onSubmitTx(); }
  });
  els.btnSubmit.addEventListener('click', onSubmitTx);

  async function onSubmitTx() {
    if (state.busy) return;
    if (!state.settings) { showOverlay(); return; }
    const amount = parseFloat(els.txAmount.value);
    if (!(amount > 0)) { els.txAmount.focus(); return; }
    audio.ensure(); // 在 user gesture 同步路径里抓 audio context
    state.busy = true;
    els.btnSubmit.disabled = true;
    try {
      const res = await api.addTx({
        type: state.txType,
        amount,
        note: els.txNote.value.trim(),
        occurred_on: txDP.value || todayISO(),
      });
      state.transactions.unshift(res.transaction);
      state.transactions = state.transactions.slice(0, 50);
      state.stats = res.stats;
      renderStats(); renderTxList();
      // 清表单
      els.txAmount.value = '';
      els.txNote.value = '';
      // 启动仪式
      await playAnimation(res);
      // 仪式结束后把 grid 状态对齐到 server（pastCells / totalCells 等字段）
      grid.setData(state.stats);
      renderProgress();
    } catch (e) {
      console.error(e);
    } finally {
      state.busy = false;
      els.btnSubmit.disabled = false;
    }
  }

  async function onDelete(id) {
    if (state.busy) return;
    audio.ensure();
    state.busy = true;
    try {
      const res = await api.delTx(id);
      state.transactions = state.transactions.filter(t => t.id !== id);
      state.stats = res.stats;
      renderStats(); renderTxList();
      await playAnimation(res);
      grid.setData(state.stats);
      renderProgress();
    } catch (e) {
      console.error(e);
    } finally {
      state.busy = false;
    }
  }

  /** 根据后端返回 lit_before/lit_after/animation 编排 grid 动画 */
  async function playAnimation(res) {
    const before = res.lit_before ?? 0;
    const after  = res.lit_after  ?? 0;
    // 加上支出偏移量，使动画目标定位到正确的金色区
    const expOff = state.stats.expense_days_equiv || 0;
    if (after > before) {
      await grid.lightUp(before + expOff, after + expOff);
    } else if (after < before) {
      await grid.extinguish(after + expOff, before + expOff);
    }
    // 达成财富自由（最后一格被点亮 · 首次跨越 future_cells）
    const future = state.stats.future_cells || 0;
    if (future > 0 && after >= future && before < future) {
      await celebrateFreedom();
    }
  }

  async function celebrateFreedom() {
    // 暂停 grid 渲染 · 让 banner CSS 独享主线程 & GPU
    grid.pause();
    els.freedomBanner.hidden = false;
    if (audio && audio.celebrateChord) audio.celebrateChord();
    await new Promise(r => setTimeout(r, 6500));
    els.freedomBanner.hidden = true;
    grid.resume();
  }

  // ============================================
  // 导出备份
  // ============================================
  els.btnExport.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/export');
      const blob = await res.blob();
      const name = res.headers.get('Content-Disposition')?.match(/filename="(.+?)"/)?.[1]
        || `ledger-${todayISO()}.json`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      els.dataStatusText.textContent = '备份已导出 ✓';
      setTimeout(() => { els.dataStatusText.textContent = '已保存到本地'; }, 3000);
    } catch (e) {
      console.error(e);
    }
  });

  // ============================================
  // 启动
  // ============================================
  grid.mount();
  stars.mount();
  loadAndPaint();

})();
