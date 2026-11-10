/* 체스 아레나 — 연습용 AI (알파-베타 탐색 + 기물 위치 점수) */
(function () {
  'use strict';
  const C = window.Chess;
  const VAL = { p: 100, n: 310, b: 330, r: 500, q: 900, k: 0 };
  // 백 기준 위치 보너스 (index 0 = a8). 흑은 상하 반전해서 사용.
  const PST = {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 12, 12, 20, 30, 30, 20, 12, 12, 6, 6, 10, 25, 25, 10, 6, 6,
      0, 0, 0, 22, 22, 0, 0, 0, 5, -4, -8, 2, 2, -8, -4, 5, 5, 10, 10, -18, -18, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    n: [-50, -38, -30, -30, -30, -30, -38, -50, -38, -18, 0, 2, 2, 0, -18, -38, -30, 2, 12, 16, 16, 12, 2, -30, -30, 6, 16, 22, 22, 16, 6, -30,
      -30, 2, 16, 22, 22, 16, 2, -30, -30, 6, 12, 16, 16, 12, 6, -30, -38, -18, 2, 6, 6, 2, -18, -38, -50, -36, -30, -30, -30, -30, -36, -50],
    b: [-18, -10, -10, -10, -10, -10, -10, -18, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 6, 10, 10, 6, 0, -10, -10, 6, 6, 10, 10, 6, 6, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 6, 0, 0, 0, 0, 6, -10, -18, -10, -12, -10, -10, -12, -10, -18],
    r: [0, 0, 0, 0, 0, 0, 0, 0, 6, 12, 12, 12, 12, 12, 12, 6, -6, 0, 0, 0, 0, 0, 0, -6, -6, 0, 0, 0, 0, 0, 0, -6,
      -6, 0, 0, 0, 0, 0, 0, -6, -6, 0, 0, 0, 0, 0, 0, -6, -6, 0, 0, 0, 0, 0, 0, -6, 0, 0, 2, 6, 6, 2, 0, 0],
    q: [-18, -10, -10, -5, -5, -10, -10, -18, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -18, -10, -10, -5, -5, -10, -10, -18],
    k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 18, 18, 0, 0, 0, 0, 18, 18, 18, 28, 12, 0, 0, 12, 28, 18],
    kEnd: [-50, -36, -28, -20, -20, -28, -36, -50, -30, -18, -8, 0, 0, -8, -18, -30, -30, -8, 18, 28, 28, 18, -8, -30, -30, -8, 28, 38, 38, 28, -8, -30,
      -30, -8, 28, 38, 38, 28, -8, -30, -30, -8, 18, 28, 28, 18, -8, -30, -30, -28, 0, 0, 0, 0, -28, -30, -50, -30, -30, -30, -30, -30, -30, -50]
  };

  function evaluate(s) {
    // 차례인 쪽 관점 점수
    const b = s.board;
    let heavy = 0;
    for (const p of b) if (p && 'qQrRbBnN'.includes(p)) heavy += VAL[p.toLowerCase()];
    const endgame = heavy <= 1600;
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p) continue;
      const t = p.toLowerCase();
      const white = p !== t;
      const idx = white ? i : (7 - (i >> 3)) * 8 + (i & 7);
      const table = t === 'k' && endgame ? PST.kEnd : PST[t];
      const v = VAL[t] + table[idx];
      score += white ? v : -v;
    }
    return s.turn === 'w' ? score : -score;
  }

  const MATE = 100000;
  function order(moves) {
    return moves.sort((a, b) =>
      ((b.captured ? VAL[b.captured.toLowerCase()] * 10 - VAL[b.piece.toLowerCase()] : 0) + (b.promo ? 800 : 0)) -
      ((a.captured ? VAL[a.captured.toLowerCase()] * 10 - VAL[a.piece.toLowerCase()] : 0) + (a.promo ? 800 : 0)));
  }

  let nodes = 0, deadline = 0;
  function quiesce(s, alpha, beta, depth) {
    nodes++;
    const stand = evaluate(s);
    if (stand >= beta) return beta;
    if (alpha < stand) alpha = stand;
    if (depth <= 0) return alpha;
    const caps = order(C.legalMoves(s).filter(m => m.captured || m.promo));
    for (const m of caps) {
      const v = -quiesce(C.makeMove(s, m), -beta, -alpha, depth - 1);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  function search(s, depth, alpha, beta, ply, qdepth) {
    nodes++;
    const moves = C.legalMoves(s);
    if (!moves.length) return C.inCheck(s) ? -MATE + ply : 0;
    if (s.half >= 100 || C.insufficient(s.board)) return 0;
    if (depth <= 0) return quiesce(s, alpha, beta, qdepth);
    order(moves);
    for (const m of moves) {
      const v = -search(C.makeMove(s, m), depth - 1, -beta, -alpha, ply + 1, qdepth);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
      if (Date.now() > deadline) break;
    }
    return alpha;
  }

  // level: 1(입문) 2(중급) 3(상급)
  function bestMove(game, level) {
    const s = game.state;
    const moves = order(C.legalMoves(s));
    if (!moves.length) return null;
    const cfg = { 1: { depth: 1, q: 0, noise: 160, blunder: 0.25 }, 2: { depth: 2, q: 2, noise: 30, blunder: 0.05 }, 3: { depth: 3, q: 4, noise: 6, blunder: 0 } }[level] || { depth: 2, q: 2, noise: 30, blunder: 0 };
    if (Math.random() < cfg.blunder) return C.uciOf(moves[Math.floor(Math.random() * moves.length)]);
    nodes = 0; deadline = Date.now() + 2500;
    let best = null, bestV = -Infinity;
    for (const m of moves) {
      const v = -search(C.makeMove(s, m), cfg.depth - 1, -MATE - 1, MATE + 1, 1, cfg.q) + Math.random() * cfg.noise;
      if (v > bestV) { bestV = v; best = m; }
    }
    return C.uciOf(best);
  }

  window.ChessAI = { bestMove, evaluate };
})();
