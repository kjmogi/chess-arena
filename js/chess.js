/* 체스 아레나 — 체스 규칙 엔진 (합법 수 생성, 캐슬링, 앙파상, 승진, 체크메이트/무승부 판정, SAN 표기) */
(function () {
  'use strict';
  const FILES = 'abcdefgh';
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const sqName = i => FILES[i & 7] + (8 - (i >> 3));
  const sqIndex = s => (8 - Number(s[1])) * 8 + FILES.indexOf(s[0]);
  const colorOf = p => (p ? (p === p.toUpperCase() ? 'w' : 'b') : null);
  const opp = c => (c === 'w' ? 'b' : 'w');

  const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function parseFEN(fen) {
    const [pos, turn, cast, ep, half, full] = fen.trim().split(/\s+/);
    const board = [];
    for (const ch of pos.replace(/\//g, '')) {
      if (/\d/.test(ch)) for (let k = 0; k < Number(ch); k++) board.push('');
      else board.push(ch);
    }
    return {
      board, turn: turn || 'w',
      castling: !cast || cast === '-' ? '' : cast,
      ep: !ep || ep === '-' ? -1 : sqIndex(ep),
      half: Number(half) || 0, full: Number(full) || 1
    };
  }

  function toFEN(s) {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let row = '', e = 0;
      for (let f = 0; f < 8; f++) {
        const p = s.board[r * 8 + f];
        if (!p) e++;
        else { if (e) { row += e; e = 0; } row += p; }
      }
      if (e) row += e;
      rows.push(row);
    }
    return `${rows.join('/')} ${s.turn} ${s.castling || '-'} ${s.ep < 0 ? '-' : sqName(s.ep)} ${s.half} ${s.full}`;
  }

  const inb = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;

  function attacked(b, sq, by) {
    const r = sq >> 3, f = sq & 7;
    const W = by === 'w';
    const pr = W ? r + 1 : r - 1;
    const pawn = W ? 'P' : 'p';
    for (const df of [-1, 1]) if (inb(pr, f + df) && b[pr * 8 + f + df] === pawn) return true;
    const N = W ? 'N' : 'n', K = W ? 'K' : 'k';
    for (const [dr, df] of KN) if (inb(r + dr, f + df) && b[(r + dr) * 8 + f + df] === N) return true;
    for (const [dr, df] of KG) if (inb(r + dr, f + df) && b[(r + dr) * 8 + f + df] === K) return true;
    const B = W ? 'B' : 'b', R = W ? 'R' : 'r', Q = W ? 'Q' : 'q';
    for (const [dirs, a] of [[DIAG, B], [ORTH, R]]) {
      for (const [dr, df] of dirs) {
        let rr = r + dr, ff = f + df;
        while (inb(rr, ff)) {
          const p = b[rr * 8 + ff];
          if (p) { if (p === a || p === Q) return true; break; }
          rr += dr; ff += df;
        }
      }
    }
    return false;
  }

  const kingSq = (b, c) => b.indexOf(c === 'w' ? 'K' : 'k');
  const inCheck = s => attacked(s.board, kingSq(s.board, s.turn), opp(s.turn));

  function pseudoMoves(s) {
    const b = s.board, c = s.turn, out = [];
    const add = (from, to, extra) => out.push(Object.assign({ from, to, piece: b[from], captured: b[to] || '' }, extra));
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p || colorOf(p) !== c) continue;
      const r = i >> 3, f = i & 7, t = p.toLowerCase();
      if (t === 'p') {
        const dir = c === 'w' ? -1 : 1, startR = c === 'w' ? 6 : 1, promoR = c === 'w' ? 0 : 7;
        const pushPromo = (to, extra) => {
          if ((to >> 3) === promoR) for (const pr of 'qrbn') add(i, to, Object.assign({ promo: pr }, extra));
          else add(i, to, extra);
        };
        const one = (r + dir) * 8 + f;
        if (inb(r + dir, f) && !b[one]) {
          pushPromo(one);
          const two = (r + 2 * dir) * 8 + f;
          if (r === startR && !b[two]) add(i, two, { flag: 'double' });
        }
        for (const df of [-1, 1]) {
          if (!inb(r + dir, f + df)) continue;
          const to = (r + dir) * 8 + f + df;
          if (b[to] && colorOf(b[to]) !== c) pushPromo(to);
          else if (to === s.ep) add(i, to, { flag: 'ep', captured: c === 'w' ? 'p' : 'P' });
        }
      } else if (t === 'n' || t === 'k') {
        for (const [dr, df] of t === 'n' ? KN : KG) {
          if (!inb(r + dr, f + df)) continue;
          const to = (r + dr) * 8 + f + df;
          if (!b[to] || colorOf(b[to]) !== c) add(i, to);
        }
        if (t === 'k') {
          const home = c === 'w' ? 60 : 4, o = opp(c);
          if (i === home && !attacked(b, home, o)) {
            const [kc, qc, rook] = c === 'w' ? ['K', 'Q', 'R'] : ['k', 'q', 'r'];
            if (s.castling.includes(kc) && !b[home + 1] && !b[home + 2] && b[home + 3] === rook &&
              !attacked(b, home + 1, o) && !attacked(b, home + 2, o)) add(i, home + 2, { flag: 'castle' });
            if (s.castling.includes(qc) && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === rook &&
              !attacked(b, home - 1, o) && !attacked(b, home - 2, o)) add(i, home - 2, { flag: 'castle' });
          }
        }
      } else {
        const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : DIAG.concat(ORTH);
        for (const [dr, df] of dirs) {
          let rr = r + dr, ff = f + df;
          while (inb(rr, ff)) {
            const to = rr * 8 + ff;
            if (b[to]) { if (colorOf(b[to]) !== c) add(i, to); break; }
            add(i, to);
            rr += dr; ff += df;
          }
        }
      }
    }
    return out;
  }

  function makeMove(s, m) {
    const b = s.board.slice();
    const c = s.turn;
    let piece = b[m.from];
    b[m.from] = '';
    if (m.flag === 'ep') b[(m.from & ~7) + (m.to & 7)] = '';
    if (m.flag === 'castle') {
      if (m.to > m.from) { b[m.from + 1] = b[m.from + 3]; b[m.from + 3] = ''; }
      else { b[m.from - 1] = b[m.from - 4]; b[m.from - 4] = ''; }
    }
    if (m.promo) piece = c === 'w' ? m.promo.toUpperCase() : m.promo;
    b[m.to] = piece;
    let cast = s.castling;
    if (piece === 'K') cast = cast.replace(/[KQ]/g, '');
    if (piece === 'k') cast = cast.replace(/[kq]/g, '');
    for (const [sq, ch] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.from === sq || m.to === sq) cast = cast.replace(ch, '');
    const isPawn = piece.toLowerCase() === 'p' || m.promo;
    return {
      board: b, turn: opp(c), castling: cast,
      ep: m.flag === 'double' ? (m.from + m.to) / 2 : -1,
      half: isPawn || m.captured ? 0 : s.half + 1,
      full: c === 'b' ? s.full + 1 : s.full
    };
  }

  function legalMoves(s) {
    const out = [];
    for (const m of pseudoMoves(s)) {
      const ns = makeMove(s, m);
      if (!attacked(ns.board, kingSq(ns.board, s.turn), ns.turn)) out.push(m);
    }
    return out;
  }

  const uciOf = m => sqName(m.from) + sqName(m.to) + (m.promo || '');

  function san(s, m, legal) {
    let str;
    if (m.flag === 'castle') str = m.to > m.from ? 'O-O' : 'O-O-O';
    else {
      const t = m.piece.toUpperCase();
      if (t === 'P') {
        str = (m.captured ? FILES[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
      } else {
        const rivals = legal.filter(o => o.piece === m.piece && o.to === m.to && o.from !== m.from);
        let dis = '';
        if (rivals.length) {
          if (!rivals.some(o => (o.from & 7) === (m.from & 7))) dis = FILES[m.from & 7];
          else if (!rivals.some(o => (o.from >> 3) === (m.from >> 3))) dis = String(8 - (m.from >> 3));
          else dis = sqName(m.from);
        }
        str = t + dis + (m.captured ? 'x' : '') + sqName(m.to);
      }
    }
    const ns = makeMove(s, m);
    if (inCheck(ns)) str += legalMoves(ns).length ? '+' : '#';
    return str;
  }

  function insufficient(b) {
    const minors = [];
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p || p.toLowerCase() === 'k') continue;
      const t = p.toLowerCase();
      if (t === 'p' || t === 'r' || t === 'q') return false;
      minors.push({ t, sqColor: ((i >> 3) + (i & 7)) % 2 });
    }
    if (minors.length <= 1) return true;
    return minors.every(m => m.t === 'b') && minors.every(m => m.sqColor === minors[0].sqColor);
  }

  const repKey = s => toFEN(s).split(' ').slice(0, 4).join(' ');

  class Game {
    constructor(fen) {
      this.state = parseFEN(fen || START);
      this.history = []; // {uci, san, from, to, captured, color}
      this.keys = [repKey(this.state)];
      this._legal = null;
    }
    static fromMoves(list) {
      const g = new Game();
      for (const u of list || []) if (!g.play(u)) break;
      return g;
    }
    get turn() { return this.state.turn; }
    fen() { return toFEN(this.state); }
    legal() { return this._legal || (this._legal = legalMoves(this.state)); }
    movesFrom(sq) { return this.legal().filter(m => m.from === sq); }
    play(uci) {
      const m = this.legal().find(x => uciOf(x) === uci);
      if (!m) return null;
      const notation = san(this.state, m, this.legal());
      const color = this.state.turn;
      this.state = makeMove(this.state, m);
      this._legal = null;
      this.keys.push(repKey(this.state));
      const rec = { uci, san: notation, from: m.from, to: m.to, captured: m.captured, color };
      this.history.push(rec);
      return rec;
    }
    inCheck() { return inCheck(this.state); }
    status() {
      const s = this.state;
      if (!this.legal().length) {
        return inCheck(s)
          ? { over: true, winner: opp(s.turn), reason: 'checkmate' }
          : { over: true, winner: null, reason: 'stalemate' };
      }
      if (insufficient(s.board)) return { over: true, winner: null, reason: 'insufficient' };
      if (s.half >= 100) return { over: true, winner: null, reason: 'fifty' };
      const k = this.keys[this.keys.length - 1];
      if (this.keys.filter(x => x === k).length >= 3) return { over: true, winner: null, reason: 'threefold' };
      return { over: false };
    }
    captured() {
      // 잡힌 기물 목록: { w: [백이 잡은 흑 기물], b: [흑이 잡은 백 기물] }
      const res = { w: [], b: [] };
      for (const h of this.history) if (h.captured) res[h.color].push(h.captured);
      return res;
    }
  }

  window.Chess = {
    START, Game, parseFEN, toFEN, legalMoves, makeMove, inCheck, attacked,
    sqName, sqIndex, colorOf, opp, uciOf, insufficient
  };
})();
