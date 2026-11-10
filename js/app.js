/* 체스 아레나 — 로그인, 학생 홈, 대국 화면 */
(function () {
  'use strict';
  const { $, $$, esc, emblem, toast, modal, confirmBox, Board, replay, moveListHTML, tierUp, fmtTime, REASON, pieceHTML } = window.UI;
  const C = window.Chess, R = window.Rating, S = window.Store;

  const App = {
    uid: null, screen: null,
    gameId: null, ai: null, backTo: 'home', flip: false,
    leftGame: null, shownResult: null, seenChallenges: new Set(), board: null,
    aiLevelNames: { 1: '입문', 2: '중급', 3: '상급' }
  };
  window.App = App;

  const me = db => db.users[App.uid];
  const TIER_ORDER = ['placement', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'champion'];

  function show(id) {
    App.screen = id;
    $$('.screen').forEach(s => s.classList.toggle('hidden', s.id !== 'scr-' + id));
    window.scrollTo(0, 0);
  }

  /* ---------- 경기 생성/조회 ---------- */
  function activeGameOf(db, uid) {
    return Object.values(db.games).find(g => g.status === 'playing' && (g.white === uid || g.black === uid)) || null;
  }
  function createGame(db, a, b, type) {
    const t = S.now();
    const [white, black] = S.rand() < 0.5 ? [a, b] : [b, a];
    const id = S.newId('g');
    db.games[id] = {
      id, cls: db.users[a].cls, white, black, matchType: type, rank: true,
      status: 'playing', started: false, ready: {}, moves: [], createdAt: t, turnAt: t, drawOffer: null
    };
    delete db.queue[a]; delete db.queue[b];
    for (const [k, c] of Object.entries(db.challenges)) if ([a, b].includes(c.from) || [a, b].includes(c.to)) delete db.challenges[k];
    return id;
  }
  App.createGame = createGame;
  App.activeGameOf = activeGameOf;

  /* ---------- 로그인/가입 ---------- */
  const LOGIN_ERR = { class: '반 코드를 찾을 수 없어요.', cred: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  const NET_ERR = '서버에 연결할 수 없어요. 인터넷 연결과 설정(js/config.js)을 확인하세요.';
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const cls = $('#login-class').value.trim().toLowerCase();
    const id = $('#login-id').value.trim().toLowerCase();
    const pw = $('#login-pw').value;
    const btn = e.target.querySelector('button[type=submit]'), err = $('#login-err');
    btn.disabled = true; err.textContent = S.mode === 'online' ? '연결하는 중…' : '';
    let r;
    try { r = await S.login(cls, id, pw); } catch (x) { console.warn(x); r = { error: 'net' }; }
    btn.disabled = false;
    if (r.error) { err.textContent = LOGIN_ERR[r.error] || NET_ERR; return; }
    err.textContent = '';
    $('#login-pw').value = '';
    enter();
  });
  $$('[data-fill]').forEach(b => b.addEventListener('click', () => {
    const [c, i] = b.dataset.fill.split('/');
    $('#login-class').value = c; $('#login-id').value = i; $('#login-pw').value = '1234';
  }));
  $('#to-signup').onclick = () => show('signup');
  $('#to-login').onclick = () => show('login');
  $('#demo-reset').onclick = async () => {
    if (!await confirmBox('이 브라우저에 저장된 <b>모든 반·학생·경기 기록</b>을 지우고 처음 데모 상태로 되돌릴까요?', '초기화', true)) return;
    S.reset(); toast('데모 데이터를 초기화했어요.');
  };
  $('#signup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const v = n => f.elements[n].value.trim();
    const code = v('code').toLowerCase(), tid = v('tid').toLowerCase();
    const err = $('#signup-err');
    if (!/^[a-z0-9][a-z0-9-]{1,11}$/.test(code)) { err.textContent = '반 코드는 영문 소문자·숫자·- 2~12자로 정하세요.'; return; }
    if (!/^[a-z0-9_]{2,16}$/.test(tid)) { err.textContent = '아이디는 영문 소문자·숫자·_ 2~16자로 정하세요.'; return; }
    if (f.elements.pw.value.length < 4) { err.textContent = '비밀번호는 4자 이상이어야 해요.'; return; }
    if (f.elements.pw.value !== f.elements.pw2.value) { err.textContent = '비밀번호 확인이 일치하지 않아요.'; return; }
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true; err.textContent = S.mode === 'online' ? '만드는 중…' : '';
    let r;
    try { r = await S.createClass({ code, name: v('cname'), tid, tname: v('tname'), pw: f.elements.pw.value }); } catch (x) { console.warn(x); r = { error: 'net' }; }
    btn.disabled = false;
    if (r.error) { err.textContent = r.error === 'exists' ? '이미 있는 반 코드예요.' : NET_ERR; return; }
    err.textContent = '';
    f.reset();
    toast('반을 만들었어요. 「학생 관리」에서 학생을 등록하세요.');
    enter();
  });
  $$('[data-act=logout]').forEach(b => b.onclick = () => logout());
  function logout() {
    const me = App.uid;
    if (me) S.update(db => { delete db.queue[me]; delete db.presence[me]; });
    S.logout(); App.uid = null; App.ai = null; App.gameId = null;
    show('login');
  }

  function enter() {
    const db = S.get();
    App.uid = S.uid();
    const u = App.uid && db.users[App.uid];
    if (!u) { S.logout(); App.uid = null; show('login'); return; }
    S.heartbeat(App.uid);
    if (u.role === 'teacher') { show('admin'); window.Admin.open(); return; }
    const g = activeGameOf(db, App.uid);
    if (g) openGame(g.id, 'home');
    else { show('home'); renderHome(); }
  }

  /* ---------- 학생 홈 ---------- */
  function statusOf(db, u) {
    if (activeGameOf(db, u.uid)) return { cls: 'busy', text: '경기 중' };
    if (S.online(db, u.uid)) return { cls: 'on', text: '접속 중' };
    return { cls: 'off', text: '오프라인' };
  }

  function rankingRows(db, cls, highlight, limit) {
    const st = db.users;
    const list = Object.values(st).filter(u => u.cls === cls && u.role === 'student');
    const placed = list.filter(u => (u.placed || 0) >= R.PLACEMENT_GAMES).sort((a, b) => b.score - a.score || (b.wins || 0) - (a.wins || 0));
    const rest = list.filter(u => (u.placed || 0) < R.PLACEMENT_GAMES).sort((a, b) => (b.placed || 0) - (a.placed || 0));
    let rows = placed.map((u, i) => ({ u, rank: i + 1 })).concat(rest.map(u => ({ u, rank: '–' })));
    if (limit && rows.length > limit) {
      const mine = rows.findIndex(r => r.u.uid === highlight);
      rows = rows.slice(0, limit).concat(mine >= limit ? [rows[mine]] : []);
    }
    return rows.map(({ u, rank }) => {
      const t = R.displayTier(db, u);
      return `<tr class="${u.uid === highlight ? 'me' : ''}"><td class="rk">${rank}</td>
        <td class="nm">${emblem(t.id, 24)}<span>${esc(u.name)}</span></td>
        <td><span class="tier-text-${t.id}">${esc(t.name)}</span></td>
        <td class="num">${(u.placed || 0) >= R.PLACEMENT_GAMES ? u.score : '?'}</td>
        <td class="num muted">${u.wins || 0}승 ${u.losses || 0}패${u.draws ? ` ${u.draws}무` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">학생이 없어요.</td></tr>';
  }
  App.rankingRows = rankingRows;

  function gameResultFor(g, uid) {
    if (g.voided) return { cls: 'void', text: '무효' };
    const side = g.white === uid ? 'w' : 'b';
    if (g.winner === null || g.winner === undefined) return { cls: 'draw', text: '무' };
    return g.winner === side ? { cls: 'win', text: '승' } : { cls: 'loss', text: '패' };
  }

  function renderHome() {
    const db = S.get();
    const u = me(db);
    if (!u) return logout();
    const st = S.settings(db, u.cls);
    const t = R.displayTier(db, u);
    const cls = db.classes[u.cls] || { name: u.cls };
    $('#home-me').innerHTML = `${emblem(t.id, 26)}<span>${esc(u.name)}</span>`;
    $('#home-class').textContent = cls.name;

    // 배너: 진행 중 경기, 받은 도전
    const g = activeGameOf(db, App.uid);
    const incoming = Object.values(db.challenges).filter(c => c.to === App.uid && S.now() - c.at < 60000);
    let banner = '';
    if (g) banner += `<div class="banner hot"><span>⚔️ 진행 중인 경기가 있어요 — <b>${esc(db.users[g.white === App.uid ? g.black : g.white]?.name)}</b>와(과)</span><button class="btn primary sm" data-go="${g.id}">경기로 가기</button></div>`;
    for (const c of incoming) {
      banner += `<div class="banner"><span>🤝 <b>${esc(db.users[c.from]?.name)}</b>이(가) 1:1 대결을 신청했어요.</span>
        <span class="row"><button class="btn primary sm" data-acc="${c.id}">수락</button><button class="btn sm" data-dec="${c.id}">거절</button></span></div>`;
    }
    $('#home-banner').innerHTML = banner;

    if (g && App.leftGame !== g.id) { openGame(g.id, 'home'); return; }

    // 내 정보
    const day = R.today(u, S.now());
    const placing = (u.placed || 0) < R.PLACEMENT_GAMES;
    const profile = `<section class="card profile">
      <div class="prof-top">${emblem(t.id, 76)}<div><div class="prof-name">${esc(u.name)}</div>
      <div class="prof-tier tier-text-${t.id}">${esc(t.name)}</div>
      <div class="prof-score">${placing ? '점수 비공개' : `<b>${u.score}</b>점`}</div></div></div>
      ${placing ? `<div class="placement"><div class="muted">배치고사 ${u.placed || 0} / ${R.PLACEMENT_GAMES} — 끝나면 티어가 정해져요</div>
        <div class="bar"><i style="width:${(u.placed || 0) / R.PLACEMENT_GAMES * 100}%"></i></div></div>` : ''}
      <div class="stats"><div><b>${u.wins || 0}</b><span>승</span></div><div><b>${u.losses || 0}</b><span>패</span></div><div><b>${u.draws || 0}</b><span>무</span></div>
      <div><b>${st.dailyLimit ? `${day.count}/${st.dailyLimit}` : day.count}</b><span>오늘 랭크전</span></div></div>
    </section>`;

    // 대전하기
    const queued = !!db.queue[App.uid];
    const outgoing = Object.values(db.challenges).find(c => c.from === App.uid && S.now() - c.at < 60000);
    const play = `<section class="card play">
      <h2>대전하기</h2>
      <div class="play-row">
        ${queued
          ? `<button class="btn lg queued" id="q-cancel"><span class="spinner"></span> 상대를 찾는 중… (취소)</button>`
          : `<button class="btn primary lg" id="q-join" ${g ? 'disabled' : ''}>🎲 랜덤 매치 찾기</button>`}
        <p class="muted small">접속 중인 반 친구 중 점수가 비슷한 상대와 랭크전을 해요.</p>
      </div>
      ${outgoing ? `<div class="banner soft"><span><b>${esc(db.users[outgoing.to]?.name)}</b>에게 대결 신청 중…</span><button class="btn sm" id="ch-cancel">취소</button></div>` : ''}
      <h3>AI와 연습 <small class="muted">(점수 변화 없음)</small></h3>
      <div class="seg" id="ai-color"><button data-c="w" class="${App.aiColor === 'w' ? 'on' : ''}">♔ 백</button><button data-c="r" class="${!App.aiColor || App.aiColor === 'r' ? 'on' : ''}">무작위</button><button data-c="b" class="${App.aiColor === 'b' ? 'on' : ''}">♚ 흑</button></div>
      <div class="ai-levels">${[1, 2, 3].map(l => `<button class="btn ai-btn" data-ai="${l}">${emblem('ai', 28)}<span>${App.aiLevelNames[l]}</span></button>`).join('')}</div>
    </section>`;

    // 반 친구
    const mates = Object.values(db.users).filter(x => x.cls === u.cls && x.role === 'student' && x.uid !== App.uid)
      .sort((a, b) => (S.online(db, b.uid) - S.online(db, a.uid)) || a.name.localeCompare(b.name, 'ko'));
    const friends = `<section class="card friends"><h2>반 친구 <small class="muted">1:1 도전 (점수 ×${st.multSelect})</small></h2>
      <ul class="plist">${mates.map(x => {
        const s = statusOf(db, x), xt = R.displayTier(db, x);
        const can = s.cls === 'on' && !g && !outgoing;
        return `<li><span class="dot ${s.cls}" title="${s.text}"></span>${emblem(xt.id, 24)}<span class="nm">${esc(x.name)}</span>
          <span class="muted small tier-text-${xt.id}">${esc(xt.name)}</span>
          <button class="btn sm" data-ch="${x.uid}" ${can ? '' : 'disabled'}>${s.cls === 'busy' ? '경기 중' : '도전'}</button></li>`;
      }).join('') || '<li class="muted">아직 다른 학생이 없어요.</li>'}</ul></section>`;

    // 순위표
    const ranking = `<section class="card ranking"><h2>순위표</h2><table class="rtable">${rankingRows(db, u.cls, App.uid, 10)}</table></section>`;

    // 최근 경기
    const mine = Object.values(db.games).filter(x => x.status === 'over' && (x.white === App.uid || x.black === App.uid))
      .sort((a, b) => b.endedAt - a.endedAt).slice(0, 8);
    const recent = `<section class="card recent"><h2>최근 경기</h2><ul class="glist">${mine.map(x => {
      const r = gameResultFor(x, App.uid), side = x.white === App.uid ? 'w' : 'b';
      const op = db.users[side === 'w' ? x.black : x.white];
      const d = x.deltas && x.deltas[side];
      return `<li><span class="res ${r.cls}">${r.text}</span><span class="nm">vs ${esc(op ? op.name : '(삭제됨)')}</span>
        <span class="muted small">${MATCH_NAME[x.matchType] || ''} · ${REASON[x.reason] || ''}</span>
        <span class="delta ${d && d.delta > 0 ? 'up' : d && d.delta < 0 ? 'down' : ''}">${x.voided ? '' : d ? (d.counted ? (d.delta > 0 ? '+' : '') + d.delta : '연습') : ''}</span>
        <button class="btn sm ghost" data-rp="${x.id}">기보</button></li>`;
    }).join('') || '<li class="muted">아직 경기 기록이 없어요.</li>'}</ul></section>`;

    $('#home-main').innerHTML = profile + play + friends + ranking + recent;

    // 이벤트
    $$('[data-go]').forEach(b => b.onclick = () => openGame(b.dataset.go, 'home'));
    $$('[data-acc]').forEach(b => b.onclick = () => acceptChallenge(b.dataset.acc));
    $$('[data-dec]').forEach(b => b.onclick = () => S.update(d => { delete d.challenges[b.dataset.dec]; }));
    const qj = $('#q-join'); if (qj) qj.onclick = joinQueue;
    const qc = $('#q-cancel'); if (qc) qc.onclick = () => S.update(d => { delete d.queue[App.uid]; });
    const cc = $('#ch-cancel'); if (cc) cc.onclick = () => S.update(d => { for (const [k, c] of Object.entries(d.challenges)) if (c.from === App.uid) delete d.challenges[k]; });
    $$('#ai-color button').forEach(b => b.onclick = () => { App.aiColor = b.dataset.c; renderHome(); });
    $$('[data-ai]').forEach(b => b.onclick = () => startAI(Number(b.dataset.ai)));
    $$('[data-ch]').forEach(b => b.onclick = () => challenge(b.dataset.ch));
    $$('[data-rp]').forEach(b => b.onclick = () => {
      const x = S.get().games[b.dataset.rp];
      replay(x.moves, `${db.users[x.white]?.name || '?'} (백) vs ${db.users[x.black]?.name || '?'} (흑)`, x.black === App.uid);
    });

    // 새 도전 알림
    for (const c of incoming) {
      if (App.seenChallenges.has(c.id)) continue;
      App.seenChallenges.add(c.id);
      toast(`${db.users[c.from]?.name}이(가) 대결을 신청했어요!`, 'hot');
    }
  }
  App.renderHome = renderHome;
  const MATCH_NAME = { random: '랜덤', assigned: '배정', select: '1:1 도전' };
  App.MATCH_NAME = MATCH_NAME;

  function challenge(to) {
    const res = S.update(db => {
      if (activeGameOf(db, to)) return '상대가 이미 경기 중이에요.';
      if (Object.values(db.challenges).some(c => c.from === to && c.to === App.uid)) {
        const c = Object.values(db.challenges).find(x => x.from === to && x.to === App.uid);
        createGame(db, c.from, c.to, 'select'); return 'started';
      }
      const id = S.newId('c');
      db.challenges[id] = { id, from: App.uid, to, cls: db.users[App.uid].cls, at: S.now() };
      return 'sent';
    });
    if (res === 'sent') toast('대결을 신청했어요. 상대가 수락하면 시작해요.');
    else if (res !== 'started') toast(res, 'err');
  }
  function acceptChallenge(cid) {
    const res = S.update(db => {
      const c = db.challenges[cid];
      if (!c) return '신청이 취소되었어요.';
      if (activeGameOf(db, c.from)) { delete db.challenges[cid]; return '상대가 이미 다른 경기 중이에요.'; }
      createGame(db, c.from, c.to, 'select');
      return 'ok';
    });
    if (res !== 'ok') toast(res, 'err');
  }
  function joinQueue() {
    S.update(db => { db.queue[App.uid] = { cls: db.users[App.uid].cls, at: S.now() }; });
    tryMatch();
  }
  function tryMatch() {
    S.update(db => {
      const mine = db.queue[App.uid];
      if (!mine || activeGameOf(db, App.uid)) return;
      const myScore = db.users[App.uid].score;
      let best = null;
      for (const [uid, q] of Object.entries(db.queue)) {
        if (uid === App.uid || q.cls !== mine.cls || !db.users[uid]) continue;
        if (!S.online(db, uid) || activeGameOf(db, uid)) { delete db.queue[uid]; continue; }
        const d = Math.abs(db.users[uid].score - myScore);
        if (!best || d < best.d) best = { uid, d };
      }
      if (best) createGame(db, App.uid, best.uid, 'random');
    });
  }

  /* ---------- 대국 화면 ---------- */
  function markReady(gid) {
    S.update(db => {
      const g = db.games[gid];
      if (!g || g.status !== 'playing' || g.started === undefined || g.started) return;
      if (App.uid !== g.white && App.uid !== g.black) return;
      g.ready = g.ready || {};
      if (g.ready[App.uid]) return;
      g.ready[App.uid] = true;
      if (g.ready[g.white] && g.ready[g.black]) { g.started = true; g.turnAt = S.now(); }
    });
  }

  function openGame(gid, backTo) {
    App.ai = null;
    App.gameId = gid;
    App.backTo = backTo || 'home';
    App.leftGame = null;
    App.flip = false;
    show('game');
    markReady(gid);
    renderGame();
  }
  App.openGame = openGame;

  function startAI(level) {
    const c = !App.aiColor || App.aiColor === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : App.aiColor;
    App.gameId = null;
    App.ai = { level, myColor: c, moves: [], over: null, thinking: false };
    App.backTo = 'home';
    App.flip = false;
    App.shownResult = null;
    show('game');
    renderGame();
    if (c === 'b') aiTurn();
  }

  function aiTurn() {
    const ai = App.ai;
    if (!ai || ai.over) return;
    ai.thinking = true;
    renderGame();
    setTimeout(() => {
      if (App.ai !== ai) return;
      const g = C.Game.fromMoves(ai.moves);
      const mv = window.ChessAI.bestMove(g, ai.level);
      ai.thinking = false;
      if (mv) { ai.moves.push(mv); g.play(mv); }
      const st = g.status();
      if (st.over) ai.over = st;
      renderGame();
    }, 350);
  }

  function capturedHTML(game, color) {
    const caps = game.captured()[color];
    const val = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    const order = 'qrbnp';
    caps.sort((a, b) => order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase()));
    const mine = caps.reduce((s, p) => s + val[p.toLowerCase()], 0);
    const theirs = game.captured()[C.opp(color)].reduce((s, p) => s + val[p.toLowerCase()], 0);
    return `<span class="caps">${caps.map(p => pieceHTML(p)).join('')}${mine > theirs ? `<em>+${mine - theirs}</em>` : ''}</span>`;
  }

  function pcardHTML(db, opts) {
    // opts: {name, tier, scoreText, color, timer, active, game}
    return `<div class="pc-emb">${emblem(opts.tier, 40)}</div>
      <div class="pc-mid"><div class="pc-name"><span class="chip ${opts.color}"></span>${esc(opts.name)}</div>
      <div class="pc-sub">${opts.sub || ''}</div>${capturedHTML(opts.game, opts.color)}</div>
      ${opts.timer !== undefined ? `<div class="pc-timer ${opts.active ? 'on' : ''}" data-timer="${opts.color}">${opts.timer}</div>` : ''}`;
  }

  const fmtSec = s => s === null ? '∞' : `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

  function renderGame() {
    if (App.screen !== 'game') return;
    if (!App.board) {
      App.board = new Board($('#g-board'));
      App.board.onMove = uci => onMove(uci);
    }
    if (App.ai) return renderAIGame();
    const db = S.get();
    const g = db.games[App.gameId];
    if (!g) { toast('경기를 찾을 수 없어요.', 'err'); return leaveGame(true); }
    const game = C.Game.fromMoves(g.moves);
    const myColor = App.uid === g.white ? 'w' : App.uid === g.black ? 'b' : null;
    const playing = g.status === 'playing';
    const waiting = playing && g.started === false;
    const flipped = (myColor === 'b') !== App.flip;
    App.board.set(game, { flipped, interactive: playing && !waiting && !!myColor, myColor });

    const st = S.settings(db, g.cls);
    const remain = playing && !waiting && st.moveTime ? Math.max(0, st.moveTime - (S.now() - g.turnAt) / 1000) : null;
    const card = color => {
      const uid = color === 'w' ? g.white : g.black;
      const u = db.users[uid];
      const t = R.displayTier(db, u);
      const placing = u && (u.placed || 0) < R.PLACEMENT_GAMES;
      return pcardHTML(db, {
        name: u ? u.name : '(삭제됨)', tier: t.id, color, game,
        sub: `<span class="tier-text-${t.id}">${esc(t.name)}</span>${u && !placing ? ` · ${u.score}점` : ''}${S.online(db, uid) ? '' : ' · <span class="warn">오프라인</span>'}`,
        timer: playing ? (game.turn === color && !waiting ? fmtSec(remain) : fmtSec(st.moveTime || null)) : undefined,
        active: playing && !waiting && game.turn === color
      });
    };
    const bottom = flipped ? 'b' : 'w';
    $('#pc-top').innerHTML = card(C.opp(bottom));
    $('#pc-bot').innerHTML = card(bottom);
    $('#pc-top').classList.toggle('turn', playing && game.turn === C.opp(bottom));
    $('#pc-bot').classList.toggle('turn', playing && game.turn === bottom);
    $('#g-title').textContent = `${MATCH_NAME[g.matchType] || ''} 랭크전${myColor ? '' : ' · 관전'}`;

    // 상태
    let status;
    if (waiting) {
      const other = [g.white, g.black].filter(x => !(g.ready || {})[x]).map(x => db.users[x]?.name || '?');
      status = `<b>⏳ 입장 대기 중</b><div class="muted small">${esc(other.join(', '))}이(가) 경기에 들어오면 시작해요. 시작 전에는 시간이 흐르지 않아요.</div>`;
    } else if (playing) {
      const turnName = game.turn === 'w' ? '백' : '흑';
      status = myColor ? (game.turn === myColor ? `<b class="go">내 차례</b> (${turnName})` : `상대 차례 (${turnName})`) : `${turnName} 차례`;
      if (game.inCheck()) status += ' · <b class="warn">체크!</b>';
      if (st.moveTime) status += `<div class="muted small">한 수에 ${st.moveTime}초 — 넘기면 시간패</div>`;
    } else status = resultText(db, g, myColor);
    $('#g-status').innerHTML = status;

    // 컨트롤
    let ctr = '';
    if (playing && myColor) {
      const offer = g.drawOffer;
      if (offer && offer !== App.uid) ctr += `<div class="banner soft"><span>상대가 무승부를 제안했어요.</span><span class="row"><button class="btn primary sm" data-c="draw-yes">수락</button><button class="btn sm" data-c="draw-no">거절</button></span></div>`;
      ctr += `<button class="btn" data-c="draw" ${offer ? 'disabled' : ''}>${offer === App.uid ? '무승부 제안함…' : '½ 무승부 제안'}</button>`;
      ctr += `<button class="btn danger" data-c="resign">🏳 기권</button>`;
    }
    if (!playing) ctr += `<button class="btn primary" data-c="home">${App.backTo === 'admin' ? '관리 화면으로' : '홈으로'}</button><button class="btn" data-c="replay">기보 다시 보기</button>`;
    $('#g-controls').innerHTML = ctr;
    $$('#g-controls [data-c]').forEach(b => b.onclick = () => control(b.dataset.c, g, myColor));
    $('#g-moves').innerHTML = moveListHTML(game.history.map(h => h.san), game.history.length - 1);
    const ml = $('#g-moves'); ml.scrollTop = ml.scrollHeight;

    // 결과 오버레이 + 승급 연출
    const ov = $('#g-overlay');
    if (!playing && App.shownResult !== g.id) {
      App.shownResult = g.id;
      ov.innerHTML = `<div class="ov-card">${resultText(db, g, myColor, true)}<button class="btn sm" data-x>닫기</button></div>`;
      ov.classList.remove('hidden');
      $('[data-x]', ov).onclick = () => ov.classList.add('hidden');
      if (myColor && g.before && g.before[myColor] && !g.voided) {
        const before = g.before[myColor].tier, after = R.displayTier(db, db.users[App.uid]);
        if (after.id !== 'placement' && TIER_ORDER.indexOf(after.id) > TIER_ORDER.indexOf(before)) {
          setTimeout(() => tierUp(before === 'placement' ? 'placement' : before, after.id, after.name,
            before === 'placement' ? '배치고사 완료! 내 티어는…' : after.id === 'champion' ? '반 1위! 챔피언이 되었어요!' : '티어가 올랐어요!'), 700);
        }
      }
    } else if (playing) { ov.classList.add('hidden'); }
  }
  App.renderGame = renderGame;

  function resultText(db, g, myColor, big) {
    if (g.voided) return `<div class="res-big">무효 경기</div><div class="muted">선생님이 이 경기를 무효 처리했어요.</div>`;
    const name = c => db.users[c === 'w' ? g.white : g.black]?.name || '?';
    let head;
    if (g.winner === null || g.winner === undefined) head = '무승부';
    else if (myColor) head = g.winner === myColor ? '승리! 🎉' : '패배';
    else head = `${name(g.winner)} 승리`;
    let html = `<div class="res-big ${myColor ? (g.winner === myColor ? 'win' : g.winner ? 'loss' : '') : ''}">${head}</div><div class="muted">${REASON[g.reason] || ''}</div>`;
    if (g.deltas) {
      const sides = myColor ? [myColor] : ['w', 'b'];
      for (const s of sides) {
        const d = g.deltas[s], b = g.before && g.before[s];
        if (!d) continue;
        const who = myColor ? '' : `${esc(name(s))}: `;
        if (!d.counted) html += `<div class="delta-line">${who}${esc(d.note || '연습 경기')}</div>`;
        else if (d.placement) html += `<div class="delta-line">${who}배치고사 경기 반영${big ? ` (${d.delta > 0 ? '+' : ''}${d.delta})` : ''}</div>`;
        else html += `<div class="delta-line ${d.delta >= 0 ? 'up' : 'down'}">${who}${d.delta >= 0 ? '+' : ''}${d.delta}점 ${b ? `<span class="muted">(${b.score} → ${b.score + d.delta < 0 ? 0 : b.score + d.delta})</span>` : ''}</div>`;
      }
    }
    return html;
  }

  function renderAIGame() {
    const ai = App.ai;
    const game = C.Game.fromMoves(ai.moves);
    const flipped = (ai.myColor === 'b') !== App.flip;
    App.board.set(game, { flipped, interactive: !ai.over && !ai.thinking, myColor: ai.myColor });
    const db = S.get();
    const u = me(db);
    const t = R.displayTier(db, u);
    const card = color => color === ai.myColor
      ? pcardHTML(db, { name: u.name, tier: t.id, color, game, sub: `<span class="tier-text-${t.id}">${esc(t.name)}</span>` })
      : pcardHTML(db, { name: `AI · ${App.aiLevelNames[ai.level]}`, tier: 'ai', color, game, sub: ai.thinking ? '생각하는 중…' : '연습 상대' });
    const bottom = flipped ? 'b' : 'w';
    $('#pc-top').innerHTML = card(C.opp(bottom));
    $('#pc-bot').innerHTML = card(bottom);
    $('#pc-top').classList.toggle('turn', !ai.over && game.turn === C.opp(bottom));
    $('#pc-bot').classList.toggle('turn', !ai.over && game.turn === bottom);
    $('#g-title').textContent = `AI 연습 · ${App.aiLevelNames[ai.level]}`;
    let status;
    if (ai.over) {
      const head = ai.over.winner === null ? '무승부' : ai.over.winner === ai.myColor ? '승리! 🎉' : '패배';
      status = `<div class="res-big ${ai.over.winner === ai.myColor ? 'win' : ai.over.winner ? 'loss' : ''}">${head}</div><div class="muted">${REASON[ai.over.reason] || ''}</div>`;
    } else {
      status = game.turn === ai.myColor ? '<b class="go">내 차례</b>' : 'AI가 생각하는 중…';
      if (game.inCheck()) status += ' · <b class="warn">체크!</b>';
    }
    $('#g-status').innerHTML = status;
    $('#g-controls').innerHTML = ai.over
      ? `<button class="btn primary" data-c="ai-again">한 판 더</button><button class="btn" data-c="home">홈으로</button><button class="btn" data-c="replay">기보 다시 보기</button>`
      : `<button class="btn" data-c="undo" ${ai.thinking || ai.moves.length < 1 ? 'disabled' : ''}>↶ 무르기</button><button class="btn danger" data-c="ai-resign">🏳 기권</button>`;
    $$('#g-controls [data-c]').forEach(b => b.onclick = () => control(b.dataset.c));
    $('#g-moves').innerHTML = moveListHTML(game.history.map(h => h.san), game.history.length - 1);
    const ml = $('#g-moves'); ml.scrollTop = ml.scrollHeight;
    $('#g-overlay').classList.add('hidden');
  }

  function onMove(uci) {
    if (App.ai) {
      const ai = App.ai;
      const g = C.Game.fromMoves(ai.moves);
      if (!g.play(uci)) return;
      ai.moves.push(uci);
      const st = g.status();
      if (st.over) { ai.over = st; renderGame(); return; }
      aiTurn();
      return;
    }
    const gid = App.gameId;
    S.update(db => {
      const g = db.games[gid];
      if (!g || g.status !== 'playing') return;
      const game = C.Game.fromMoves(g.moves);
      const myColor = App.uid === g.white ? 'w' : App.uid === g.black ? 'b' : null;
      if (g.started === false || game.turn !== myColor || !game.play(uci)) return;
      g.moves.push(uci);
      g.turnAt = S.now();
      if (g.drawOffer === App.uid || g.drawOffer) g.drawOffer = null;
      const st = game.status();
      if (st.over) R.finishGame(db, gid, st.winner, st.reason, S.now());
    });
  }

  async function control(c, g, myColor) {
    if (c === 'home') return leaveGame(true);
    if (c === 'replay') {
      if (App.ai) return replay(App.ai.moves, 'AI 연습 기보', App.ai.myColor === 'b');
      const db = S.get();
      return replay(g.moves, `${db.users[g.white]?.name || '?'} (백) vs ${db.users[g.black]?.name || '?'} (흑)`, myColor === 'b');
    }
    if (c === 'ai-again') return startAI(App.ai.level);
    if (c === 'undo') {
      const ai = App.ai;
      const n = C.Game.fromMoves(ai.moves).turn === ai.myColor ? 2 : 1;
      ai.moves.splice(Math.max(0, ai.moves.length - n));
      if (C.Game.fromMoves(ai.moves).turn !== ai.myColor) aiTurn(); else renderGame();
      return;
    }
    if (c === 'ai-resign') {
      if (!await confirmBox('AI와의 연습 경기를 기권할까요?', '기권')) return;
      App.ai.over = { over: true, winner: C.opp(App.ai.myColor), reason: 'resign' };
      return renderGame();
    }
    if (c === 'resign') {
      if (!await confirmBox('정말 기권할까요? 랭크전이면 점수가 내려가요.', '기권', true)) return;
      S.update(db => R.finishGame(db, g.id, C.opp(myColor), 'resign', S.now()));
    }
    if (c === 'draw') S.update(db => { const x = db.games[g.id]; if (x && x.status === 'playing') x.drawOffer = App.uid; });
    if (c === 'draw-no') S.update(db => { const x = db.games[g.id]; if (x) x.drawOffer = null; });
    if (c === 'draw-yes') S.update(db => { const x = db.games[g.id]; if (x && x.drawOffer && x.drawOffer !== App.uid) R.finishGame(db, g.id, null, 'agreed', S.now()); });
  }

  async function leaveGame(force) {
    if (!force && !App.ai) {
      const db = S.get();
      const g = db.games[App.gameId];
      if (g && g.status === 'playing' && (g.white === App.uid || g.black === App.uid)) {
        if (!await confirmBox('나가도 경기는 계속돼요. 내 차례에 시간이 다 지나면 <b>시간패</b>가 돼요. 나갈까요?', '나가기')) return;
        App.leftGame = g.id;
      }
    }
    if (App.ai && !App.ai.over && !force && App.ai.moves.length) {
      if (!await confirmBox('AI 연습 경기를 그만두고 나갈까요?', '나가기')) return;
    }
    App.ai = null;
    const back = App.backTo;
    App.gameId = null;
    $('#g-overlay').classList.add('hidden');
    if (back === 'admin') { show('admin'); window.Admin.open(); }
    else { show('home'); renderHome(); }
  }
  $('#g-back').onclick = () => leaveGame(false);
  $('#g-flip').onclick = () => { App.flip = !App.flip; renderGame(); };

  /* ---------- 주기 작업: 접속 표시, 시간 초과 판정, 타이머 ---------- */
  function checkTimeouts() {
    const db = S.get();
    const u = me(db);
    if (!u) return;
    const due = Object.values(db.games).filter(g => g.status === 'playing' && g.started !== false && g.cls === u.cls &&
      (u.role === 'teacher' || g.white === u.uid || g.black === u.uid || g.id === App.gameId));
    for (const g of due) {
      const st = S.settings(db, g.cls);
      if (!st.moveTime) continue;
      if (S.now() - g.turnAt > st.moveTime * 1000 + 600) {
        S.update(d => {
          const x = d.games[g.id];
          if (!x || x.status !== 'playing' || S.now() - x.turnAt <= st.moveTime * 1000 + 600) return;
          const turn = x.moves.length % 2 === 0 ? 'w' : 'b';
          R.finishGame(d, x.id, C.opp(turn), 'timeout', S.now());
        });
      }
    }
    // 오래된 도전·대기열 정리
    if (Object.values(db.challenges).some(c => S.now() - c.at > 60000)) {
      S.update(d => { for (const [k, c] of Object.entries(d.challenges)) if (S.now() - c.at > 60000) delete d.challenges[k]; });
    }
  }

  function tickTimers() {
    if (App.screen !== 'game' || App.ai || !App.gameId) return;
    const db = S.get();
    const g = db.games[App.gameId];
    if (!g || g.status !== 'playing' || g.started === false) return;
    const st = S.settings(db, g.cls);
    if (!st.moveTime) return;
    const turn = g.moves.length % 2 === 0 ? 'w' : 'b';
    const remain = Math.max(0, st.moveTime - (S.now() - g.turnAt) / 1000);
    const el = $(`[data-timer="${turn}"]`);
    if (el) { el.textContent = fmtSec(remain); el.classList.toggle('low', remain <= 10); }
  }

  window.addEventListener('arena-auth-failed', () => {
    if (!App.uid) return;
    logout(); toast('비밀번호가 바뀌었거나 계정이 삭제되었어요. 다시 로그인하세요.', 'err');
  });

  S.on(() => {
    if (!App.uid) return;
    const db = S.get();
    if (!db.users[App.uid]) { toast('계정이 삭제되었어요.', 'err'); return logout(); }
    if (App.screen === 'home') renderHome();
    else if (App.screen === 'game') {
      if (!App.ai) renderGame();
    } else if (App.screen === 'admin') window.Admin.refresh();
    for (const c of Object.values(db.challenges)) {
      if (c.to !== App.uid || App.seenChallenges.has(c.id) || App.screen === 'home') continue;
      App.seenChallenges.add(c.id);
      toast(`${db.users[c.from]?.name}이(가) 대결을 신청했어요! 홈에서 수락할 수 있어요.`, 'hot');
    }
    // 진행 중 경기가 새로 생기면(배정·수락·랜덤 매칭) 자동 입장
    if (App.screen !== 'game' && db.users[App.uid].role === 'student') {
      const g = activeGameOf(db, App.uid);
      if (g && App.leftGame !== g.id) { toast('경기가 시작됐어요!', 'hot'); openGame(g.id, 'home'); }
    }
  });

  setInterval(() => { if (App.uid) S.heartbeat(App.uid); }, 5000);
  setInterval(() => { if (App.uid) { checkTimeouts(); tickTimers(); if (App.screen === 'home' && S.get().queue[App.uid]) tryMatch(); } }, 1000);

  // 시작
  window.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('mode-' + S.mode);
    show('login');
    S.resume().then(uid => { if (uid && !App.uid) enter(); }, () => { });
  });
})();
