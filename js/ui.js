/* 체스 아레나 — 공용 UI: 체스판, 엠블럼, 모달, 토스트, 승급 연출 */
(function () {
  'use strict';
  const C = window.Chess;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const glyph = p => GLYPH[p.toLowerCase()] + '︎';
  const pieceHTML = p => `<span class="pc ${C.colorOf(p)}">${glyph(p)}</span>`;

  const TIER_PIECE = { placement: 'p', bronze: 'p', silver: 'n', gold: 'b', platinum: 'r', diamond: 'q', champion: 'k', ai: 'n' };
  function emblem(tier, size) {
    const t = TIER_PIECE[tier] ? tier : 'placement';
    const s = size || 40;
    return `<svg class="emblem" width="${s}" height="${s}" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 2 L35 8 V19 C35 28 28 34.5 20 38 C12 34.5 5 28 5 19 V8 Z" fill="url(#g-${t})" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/>
      <path d="M20 5.5 L32 10.4 V19 C32 26.4 26.4 31.6 20 34.6 C13.6 31.6 8 26.4 8 19 V10.4 Z" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1"/>
      <text x="20" y="27.5" text-anchor="middle" font-size="19" fill="#fff" stroke="rgba(0,0,0,.55)" stroke-width=".8" font-family="'Segoe UI Symbol','Noto Sans Symbols 2','DejaVu Sans',serif">${GLYPH[TIER_PIECE[t]]}&#xFE0E;</text>
    </svg>`;
  }

  function toast(msg, kind) {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3100);
  }

  function modal(html, opts) {
    opts = opts || {};
    const root = $('#modal-root');
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${opts.cls || ''}" role="dialog" aria-modal="true">
      ${opts.title ? `<h2>${esc(opts.title)}</h2>` : ''}<div class="modal-body">${html}</div>
      ${opts.noClose ? '' : '<button class="modal-x" type="button" aria-label="닫기">×</button>'}</div>`;
    const close = () => { bg.remove(); opts.onClose && opts.onClose(); };
    bg.addEventListener('click', e => { if (e.target === bg && !opts.noClose) close(); });
    const x = $('.modal-x', bg);
    if (x) x.onclick = close;
    root.appendChild(bg);
    bg.close = close;
    return bg;
  }

  function confirmBox(html, okText, danger) {
    return new Promise(res => {
      const m = modal(`<p>${html}</p><div class="row end"><button class="btn" data-a="no">취소</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="ok">${esc(okText || '확인')}</button></div>`,
        { onClose: () => res(false) });
      $('[data-a=no]', m).onclick = () => m.close();
      $('[data-a=ok]', m).onclick = () => { res(true); m.remove(); };
    });
  }

  /* ---------- 체스판 ---------- */
  class Board {
    constructor(el) {
      this.el = el;
      this.el.classList.add('board');
      this.sel = -1;
      this.flipped = false;
      this.interactive = false;
      this.myColor = null;
      this.onMove = null;
      this.game = null;
      this.el.addEventListener('click', e => this._click(e));
    }
    set(game, o) {
      o = o || {};
      if (this.game && game && game.history.length !== this.game.history.length) this.sel = -1;
      this.game = game;
      if ('flipped' in o) this.flipped = o.flipped;
      if ('interactive' in o) this.interactive = o.interactive;
      if ('myColor' in o) this.myColor = o.myColor;
      if (!this.interactive) this.sel = -1;
      this.render();
    }
    canAct() { return this.interactive && this.game && this.game.turn === this.myColor && !this.game.status().over; }
    render() {
      const g = this.game;
      if (!g) { this.el.innerHTML = ''; return; }
      const b = g.state.board;
      const last = g.history[g.history.length - 1];
      const checkSq = g.inCheck() ? b.indexOf(g.turn === 'w' ? 'K' : 'k') : -1;
      const targets = this.sel >= 0 ? g.movesFrom(this.sel) : [];
      const tset = new Map(targets.map(m => [m.to, m]));
      let html = '';
      for (let d = 0; d < 64; d++) {
        const sq = this.flipped ? 63 - d : d;
        const r = sq >> 3, f = sq & 7;
        const cls = ['sq', (r + f) % 2 ? 'dark' : 'light'];
        if (last && (sq === last.from || sq === last.to)) cls.push('last');
        if (sq === this.sel) cls.push('sel');
        if (sq === checkSq) cls.push('check');
        if (tset.has(sq)) cls.push(b[sq] || tset.get(sq).flag === 'ep' ? 'cap' : 'tgt');
        if (this.canAct() && b[sq] && C.colorOf(b[sq]) === this.myColor) cls.push('mine');
        let coord = '';
        if (d % 8 === 0) coord += `<i class="rk">${8 - r}</i>`;
        if (d >= 56) coord += `<i class="fl">${'abcdefgh'[f]}</i>`;
        html += `<div class="${cls.join(' ')}" data-sq="${sq}">${coord}${b[sq] ? pieceHTML(b[sq]) : ''}</div>`;
      }
      this.el.innerHTML = html;
    }
    _click(e) {
      const cell = e.target.closest('[data-sq]');
      if (!cell || !this.canAct()) return;
      const sq = Number(cell.dataset.sq);
      const g = this.game;
      const p = g.state.board[sq];
      if (this.sel >= 0) {
        const ms = g.movesFrom(this.sel).filter(m => m.to === sq);
        if (ms.length) {
          const from = this.sel;
          this.sel = -1;
          if (ms.length > 1) this._promo(from, sq);
          else this.onMove && this.onMove(C.uciOf(ms[0]));
          this.render();
          return;
        }
      }
      this.sel = p && C.colorOf(p) === this.myColor && sq !== this.sel ? sq : -1;
      this.render();
    }
    _promo(from, to) {
      const c = this.myColor;
      const m = modal(`<div class="promo-row">${'qrbn'.split('').map(x =>
        `<button class="promo-btn" data-p="${x}">${pieceHTML(c === 'w' ? x.toUpperCase() : x)}</button>`).join('')}</div>`,
        { title: '승진할 기물을 고르세요', cls: 'sm' });
      $$('.promo-btn', m).forEach(btn => btn.onclick = () => {
        m.remove();
        this.onMove && this.onMove(C.sqName(from) + C.sqName(to) + btn.dataset.p);
      });
    }
  }

  /* ---------- 기보 다시 보기 ---------- */
  function replay(moves, title, flipped) {
    const full = C.Game.fromMoves(moves);
    const sans = full.history.map(h => h.san);
    let idx = sans.length;
    const m = modal(`<div class="replay"><div class="replay-board"></div>
      <div class="replay-nav"><button class="btn sm" data-n="0">⏮</button><button class="btn sm" data-n="-1">◀</button>
      <span class="replay-pos"></span><button class="btn sm" data-n="1">▶</button><button class="btn sm" data-n="9999">⏭</button></div>
      <div class="movelist replay-list"></div></div>`, { title: title || '기보', cls: 'wide' });
    const board = new Board($('.replay-board', m));
    const draw = () => {
      const g = C.Game.fromMoves(moves.slice(0, idx));
      board.set(g, { flipped: !!flipped, interactive: false });
      $('.replay-pos', m).textContent = `${idx} / ${sans.length}`;
      $('.replay-list', m).innerHTML = moveListHTML(sans, idx - 1);
      $$('.replay-list [data-i]', m).forEach(el => el.onclick = () => { idx = Number(el.dataset.i) + 1; draw(); });
    };
    $$('[data-n]', m).forEach(b => b.onclick = () => {
      const n = Number(b.dataset.n);
      idx = n === 0 ? 0 : n === 9999 ? sans.length : Math.max(0, Math.min(sans.length, idx + n));
      draw();
    });
    draw();
  }

  function moveListHTML(sans, cur) {
    if (!sans.length) return '<span class="muted">아직 둔 수가 없어요.</span>';
    let h = '';
    for (let i = 0; i < sans.length; i += 2) {
      h += `<span class="mv-no">${i / 2 + 1}.</span><span class="mv ${cur === i ? 'cur' : ''}" data-i="${i}">${esc(sans[i])}</span>` +
        (sans[i + 1] ? `<span class="mv ${cur === i + 1 ? 'cur' : ''}" data-i="${i + 1}">${esc(sans[i + 1])}</span>` : '<span></span>');
    }
    return h;
  }

  /* ---------- 승급 연출 ---------- */
  function tierUp(from, to, toName, kicker) {
    const colors = { bronze: '#e09a62', silver: '#dfe6f0', gold: '#f5c542', platinum: '#3fd1c2', diamond: '#7fa6ff', champion: '#ff8a3d' };
    let bits = '';
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2, d = 110 + Math.random() * 90;
      bits += `<i style="--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;--c:${colors[to] || '#fff'};--dl:${(Math.random() * 0.25).toFixed(2)}s"></i>`;
    }
    const m = modal(`<div class="tu">
      <div class="tu-kicker">${esc(kicker || '티어가 올랐어요!')}</div>
      <div class="tu-stage"><div class="tu-old">${emblem(from, 110)}</div><div class="tu-new">${emblem(to, 130)}</div><div class="tu-burst">${bits}</div></div>
      <div class="tu-name tier-text-${esc(to)}">${esc(toName)}</div>
      <button class="btn primary" data-a="ok">좋아요!</button></div>`, { cls: 'tu-modal', noClose: true });
    $('[data-a=ok]', m).onclick = () => m.close();
  }

  const fmtTime = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const REASON = { checkmate: '체크메이트', stalemate: '스테일메이트', insufficient: '기물 부족', fifty: '50수 규칙', threefold: '3회 동형 반복', resign: '기권', timeout: '시간 초과', agreed: '무승부 합의' };

  window.UI = { $, $$, esc, emblem, toast, modal, confirmBox, Board, replay, moveListHTML, tierUp, fmtTime, REASON, pieceHTML };
})();
