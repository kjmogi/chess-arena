/* 체스 아레나 — 랭크 점수, 배치고사, 티어 */
(function () {
  'use strict';
  const PLACEMENT_GAMES = 5;
  const START_SCORE = 1000;
  const K = 40;

  const TIERS = [
    { id: 'bronze', name: '브론즈', key: null },
    { id: 'silver', name: '실버', key: 'tierSilver' },
    { id: 'gold', name: '골드', key: 'tierGold' },
    { id: 'platinum', name: '플래티넘', key: 'tierPlatinum' },
    { id: 'diamond', name: '다이아', key: 'tierDiamond' }
  ];
  const TIER_NAMES = { placement: '배치고사', champion: '챔피언', bronze: '브론즈', silver: '실버', gold: '골드', platinum: '플래티넘', diamond: '다이아', none: '' };

  function tierOf(score, st) {
    let t = TIERS[0];
    for (const x of TIERS) if (!x.key || score >= st[x.key]) t = x;
    return t.id;
  }

  const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const today = (u, ts) => (u.day && u.day.key === dayKey(ts) ? u.day : { key: dayKey(ts), count: 0, opp: [] });

  function championOf(db, cls) {
    let best = null;
    for (const u of Object.values(db.users)) {
      if (u.cls !== cls || u.role !== 'student' || (u.placed || 0) < PLACEMENT_GAMES) continue;
      if (!best || u.score > best.score || (u.score === best.score && (u.wins || 0) > (best.wins || 0))) best = u;
    }
    return best ? best.uid : null;
  }

  function displayTier(db, u) {
    if (!u || u.role !== 'student') return { id: 'none', name: '' };
    if ((u.placed || 0) < PLACEMENT_GAMES) return { id: 'placement', name: `배치고사 ${u.placed || 0}/${PLACEMENT_GAMES}` };
    if (championOf(db, u.cls) === u.uid) return { id: 'champion', name: '챔피언' };
    const st = window.Store.settings(db, u.cls);
    const id = tierOf(u.score, st);
    return { id, name: TIER_NAMES[id] };
  }

  const expected = (me, op) => 1 / (1 + Math.pow(10, (op - me) / 400));

  // 경기 결과로 두 학생의 점수 변화 계산. winner: 'w'|'b'|null(무승부)
  function computeDeltas(db, g, winner, ts) {
    const st = window.Store.settings(db, g.cls);
    const ids = { w: g.white, b: g.black };
    const res = {};
    const mult = g.matchType === 'select' ? st.multSelect : g.matchType === 'assigned' ? st.multAssigned : st.multRandom;
    for (const side of ['w', 'b']) {
      const me = db.users[ids[side]], op = db.users[ids[side === 'w' ? 'b' : 'w']];
      if (!me || !op) { res[side] = { delta: 0, counted: false, note: '' }; continue; }
      const placement = (me.placed || 0) < PLACEMENT_GAMES;
      const day = today(me, ts);
      const actual = winner === null ? 0.5 : winner === side ? 1 : 0;
      let delta = Math.round(K * (actual - expected(me.score, op.score)) * mult * (placement ? st.placementMult : 1));
      if (actual === 1) delta = Math.max(delta, 4);
      if (actual === 0) delta = Math.min(delta, -4);
      let note = '', counted = true;
      if (!placement && st.dailyLimit > 0 && day.count >= st.dailyLimit) {
        delta = 0; counted = false; note = `오늘 ${st.dailyLimit}경기 초과 — 연습 경기로 기록`;
      } else if (g.matchType === 'select' && st.sameOppLimit > 0 &&
        day.opp.filter(x => x === op.uid).length + 1 >= st.sameOppLimit) {
        delta = 0; counted = false; note = `오늘 같은 상대와 ${st.sameOppLimit}번째 — 연습 경기로 기록`;
      }
      if (g.reason === 'resign' && (g.moves || []).length < 6) {
        delta = 0; counted = false; note = '너무 이른 기권 — 점수 없음';
      }
      res[side] = { delta, counted, placement, note };
    }
    return res;
  }

  function applyDelta(db, uid, d, winner, side, oppUid, ts) {
    const u = db.users[uid];
    if (!u) return null;
    const before = { score: u.score, tier: displayTier(db, u).id };
    const day = today(u, ts);
    if (d.counted) {
      u.score = Math.max(0, (u.score ?? START_SCORE) + d.delta);
      if (d.placement) u.placed = (u.placed || 0) + 1;
      else day.count += 1;
    }
    day.opp = day.opp.concat(oppUid).slice(-20);
    u.day = day;
    u.rankGames = (u.rankGames || 0) + 1;
    if (winner === null) u.draws = (u.draws || 0) + 1;
    else if (winner === side) u.wins = (u.wins || 0) + 1;
    else u.losses = (u.losses || 0) + 1;
    return before;
  }

  // 경기 종료 처리(한 번만). db를 직접 수정.
  function finishGame(db, gid, winner, reason, ts) {
    const g = db.games[gid];
    if (!g || g.status === 'over') return false;
    g.status = 'over';
    g.winner = winner;
    g.reason = reason;
    g.endedAt = ts;
    g.drawOffer = null;
    if (g.rank) {
      const deltas = computeDeltas(db, g, winner, ts);
      const champBefore = championOf(db, g.cls);
      g.before = {
        w: applyDelta(db, g.white, deltas.w, winner, 'w', g.black, ts),
        b: applyDelta(db, g.black, deltas.b, winner, 'b', g.white, ts)
      };
      g.deltas = deltas;
      g.champBefore = champBefore;
    }
    return true;
  }

  // 끝난 경기를 무효로 돌리기 (점수·전적 되돌림)
  function voidGame(db, gid) {
    const g = db.games[gid];
    if (!g || g.voided) return false;
    if (g.status === 'over' && g.rank && g.deltas) {
      for (const side of ['w', 'b']) {
        const u = db.users[side === 'w' ? g.white : g.black];
        const d = g.deltas[side];
        if (!u || !d) continue;
        if (d.counted) {
          u.score = Math.max(0, u.score - d.delta);
          if (d.placement) u.placed = Math.max(0, (u.placed || 0) - 1);
          else if (u.day && u.day.key === dayKey(g.endedAt)) u.day.count = Math.max(0, u.day.count - 1);
        }
        u.rankGames = Math.max(0, (u.rankGames || 0) - 1);
        if (g.winner === null) u.draws = Math.max(0, (u.draws || 0) - 1);
        else if (g.winner === side) u.wins = Math.max(0, (u.wins || 0) - 1);
        else u.losses = Math.max(0, (u.losses || 0) - 1);
      }
    }
    g.status = 'over';
    g.voided = true;
    g.endedAt = g.endedAt || Date.now();
    return true;
  }

  window.Rating = { PLACEMENT_GAMES, START_SCORE, TIERS, TIER_NAMES, tierOf, displayTier, championOf, computeDeltas, finishGame, voidGame, dayKey, today };
})();
