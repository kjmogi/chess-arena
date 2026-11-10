/* 체스 아레나 — 선생님 관리 화면 */
(function () {
  'use strict';
  const { $, $$, esc, emblem, toast, modal, confirmBox, Board, replay, fmtTime, REASON } = window.UI;
  const C = window.Chess, R = window.Rating, S = window.Store;

  const Admin = { tab: 'live', sel: new Set(), pairs: null };
  window.Admin = Admin;

  const teacher = db => db.users[window.App.uid];
  const students = (db, cls) => Object.values(db.users).filter(u => u.cls === cls && u.role === 'student')
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const nameOf = (db, uid) => (db.users[uid] ? db.users[uid].name : '(삭제됨)');

  Admin.open = function () {
    const db = S.get();
    const t = teacher(db);
    if (!t) return;
    const cls = db.classes[t.cls];
    $('#admin-class').innerHTML = `<b>${esc(cls ? cls.name : t.cls)}</b> <span class="muted small">반 코드 ${esc(t.cls)}</span>`;
    $('#admin-who').textContent = t.name;
    $$('#admin-tabs button').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === Admin.tab);
      b.onclick = () => { Admin.tab = b.dataset.tab; Admin.pairs = null; Admin.open(); };
    });
    render();
  };
  Admin.refresh = function () {
    // 입력 폼이 있는 탭은 자동 새로고침하지 않음(입력 중 내용 보호)
    if (['live', 'match', 'ranking', 'log'].includes(Admin.tab)) render();
  };

  function render() {
    const db = S.get();
    const t = teacher(db);
    if (!t) return;
    const main = $('#admin-main');
    const fn = { live: liveTab, match: matchTab, students: studentsTab, ranking: rankingTab, log: logTab, settings: settingsTab }[Admin.tab];
    fn(db, t.cls, main);
  }

  /* ----- 실시간 경기 ----- */
  function liveTab(db, cls, main) {
    const st = S.settings(db, cls);
    const games = Object.values(db.games).filter(g => g.cls === cls && g.status === 'playing').sort((a, b) => a.createdAt - b.createdAt);
    const list = students(db, cls);
    const online = list.filter(u => S.online(db, u.uid)).length;
    const queued = Object.keys(db.queue).filter(uid => db.users[uid] && db.users[uid].cls === cls).length;
    main.innerHTML = `<div class="admin-stats">
        <div class="stat"><b>${games.length}</b><span>진행 중 경기</span></div>
        <div class="stat"><b>${online}</b><span>접속 중 / ${list.length}명</span></div>
        <div class="stat"><b>${queued}</b><span>랜덤 매치 대기</span></div></div>
      <div class="live-grid">${games.map(g => {
        const turn = g.moves.length % 2 === 0 ? 'w' : 'b';
        const remain = g.started !== false && st.moveTime ? Math.max(0, Math.ceil(st.moveTime - (S.now() - g.turnAt) / 1000)) : null;
        return `<div class="card live-card"><div class="mini" data-mini="${g.id}"></div>
          <div class="live-info"><div><span class="chip w"></span>${esc(nameOf(db, g.white))} ${turn === 'w' ? '◀' : ''}</div>
          <div><span class="chip b"></span>${esc(nameOf(db, g.black))} ${turn === 'b' ? '◀' : ''}</div>
          <div class="muted small">${window.App.MATCH_NAME[g.matchType]} · ${g.moves.length}수${g.started === false ? ' · <span class="warn">⏳ 입장 대기</span>' : remain !== null ? ` · 남은 시간 ${remain}초` : ''}</div>
          <div class="row"><button class="btn sm" data-watch="${g.id}">관전</button><button class="btn sm danger" data-void="${g.id}">무효</button></div></div></div>`;
      }).join('') || '<div class="empty card">진행 중인 경기가 없어요. 「매치 배정」에서 경기를 만들거나, 학생들이 랜덤 매치·1:1 도전으로 시작할 수 있어요.</div>'}</div>`;
    for (const g of games) {
      const b = new Board($(`[data-mini="${g.id}"]`, main));
      b.set(C.Game.fromMoves(g.moves), { interactive: false });
    }
    $$('[data-watch]', main).forEach(b => b.onclick = () => window.App.openGame(b.dataset.watch, 'admin'));
    $$('[data-void]', main).forEach(b => b.onclick = () => voidGame(b.dataset.void));
  }

  async function voidGame(gid) {
    const db = S.get();
    const g = db.games[gid];
    if (!g) return;
    const msg = g.status === 'playing'
      ? `<b>${esc(nameOf(db, g.white))}</b> vs <b>${esc(nameOf(db, g.black))}</b> 경기를 중단하고 무효 처리할까요? 점수 변화는 없어요.`
      : `<b>${esc(nameOf(db, g.white))}</b> vs <b>${esc(nameOf(db, g.black))}</b> 경기를 무효 처리할까요? 이 경기로 바뀐 <b>점수와 전적이 되돌아가요</b>.`;
    if (!await confirmBox(msg, '무효 처리', true)) return;
    S.update(d => R.voidGame(d, gid));
    toast('무효 처리했어요.');
  }

  /* ----- 매치 배정 ----- */
  function matchTab(db, cls, main) {
    const list = students(db, cls);
    const st = S.settings(db, cls);
    for (const uid of Array.from(Admin.sel)) if (!db.users[uid]) Admin.sel.delete(uid);
    const row = u => {
      const busy = !!window.App.activeGameOf(db, u.uid), on = S.online(db, u.uid);
      const t = R.displayTier(db, u), day = R.today(u, S.now());
      return `<label class="mrow ${busy ? 'busy' : ''}"><input type="checkbox" data-sel="${u.uid}" ${Admin.sel.has(u.uid) ? 'checked' : ''} ${busy ? 'disabled' : ''}>
        <span class="dot ${busy ? 'busy' : on ? 'on' : 'off'}"></span>${emblem(t.id, 22)}<span class="nm">${esc(u.name)}</span>
        <span class="muted small tier-text-${t.id}">${esc(t.name)}</span><span class="num small">${(u.placed || 0) >= R.PLACEMENT_GAMES ? u.score : '?'}</span>
        <span class="muted small">오늘 ${day.count}${st.dailyLimit ? '/' + st.dailyLimit : ''}</span>${busy ? '<span class="pill">경기 중</span>' : ''}</label>`;
    };
    main.innerHTML = `<div class="match-layout"><section class="card"><h2>학생 선택 <small class="muted">${Admin.sel.size}명 선택</small></h2>
      <div class="row wrap"><button class="btn sm" data-m="online">접속 중 전체</button><button class="btn sm" data-m="all">전체</button><button class="btn sm" data-m="none">선택 해제</button></div>
      <div class="mlist">${list.map(row).join('') || '<p class="muted">등록된 학생이 없어요.</p>'}</div></section>
      <section class="card"><h2>배정하기</h2>
      <p class="muted small">선택한 학생들을 점수가 비슷한 사람끼리 짝지어요. 홀수면 한 명은 빠져요. 배정 경기는 랭크전(점수 ×${st.multAssigned})이고, 학생 화면에서 바로 시작돼요.</p>
      <div class="row wrap"><button class="btn primary" data-m="pair" ${Admin.sel.size >= 2 ? '' : 'disabled'}>🎲 짝 만들기</button>
      <button class="btn" data-m="two" ${Admin.sel.size === 2 ? '' : 'disabled'}>선택한 2명 바로 대결</button></div>
      <div id="pairs">${Admin.pairs ? `<ol class="pairs">${Admin.pairs.map(([a, b]) => `<li><span class="chip w"></span>${esc(nameOf(db, a))} <span class="muted">vs</span> <span class="chip b"></span>${esc(nameOf(db, b))}</li>`).join('')}</ol>
        ${Admin.left ? `<p class="muted small">짝이 없어 빠진 학생: ${esc(nameOf(db, Admin.left))}</p>` : ''}
        <div class="row"><button class="btn" data-m="pair">다시 섞기</button><button class="btn primary" data-m="confirm">${Admin.pairs.length}경기 배정</button></div>`
        : '<p class="muted small">「짝 만들기」를 누르면 여기에 대진이 표시돼요.</p>'}</div></section></div>`;
    $$('[data-sel]', main).forEach(cb => cb.onchange = () => { cb.checked ? Admin.sel.add(cb.dataset.sel) : Admin.sel.delete(cb.dataset.sel); Admin.pairs = null; render(); });
    $$('[data-m]', main).forEach(b => b.onclick = () => matchAction(b.dataset.m, db, list));
  }

  function matchAction(m, db, list) {
    const free = list.filter(u => !window.App.activeGameOf(db, u.uid));
    if (m === 'online') { Admin.sel = new Set(free.filter(u => S.online(db, u.uid)).map(u => u.uid)); Admin.pairs = null; }
    if (m === 'all') { Admin.sel = new Set(free.map(u => u.uid)); Admin.pairs = null; }
    if (m === 'none') { Admin.sel.clear(); Admin.pairs = null; }
    if (m === 'pair') {
      const arr = Array.from(Admin.sel).map(uid => db.users[uid]).filter(Boolean)
        .map(u => ({ uid: u.uid, k: u.score + (Math.random() - 0.5) * 120 })).sort((a, b) => a.k - b.k);
      Admin.left = null;
      if (arr.length % 2) Admin.left = arr.splice(Math.floor(Math.random() * arr.length), 1)[0].uid;
      Admin.pairs = [];
      for (let i = 0; i < arr.length; i += 2) Admin.pairs.push([arr[i].uid, arr[i + 1].uid]);
    }
    if (m === 'two') { Admin.pairs = [Array.from(Admin.sel)]; Admin.left = null; return assign(); }
    if (m === 'confirm') return assign();
    render();
  }

  function assign() {
    const pairs = Admin.pairs || [];
    const skipped = [];
    const made = S.update(db => {
      let n = 0;
      for (const [a, b] of pairs) {
        if (!db.users[a] || !db.users[b] || window.App.activeGameOf(db, a) || window.App.activeGameOf(db, b)) { skipped.push(`${nameOf(db, a)}·${nameOf(db, b)}`); continue; }
        window.App.createGame(db, a, b, 'assigned');
        n++;
      }
      return n;
    });
    toast(`${made}경기를 배정했어요.${skipped.length ? ` (이미 경기 중이라 건너뜀: ${skipped.join(', ')})` : ''}`);
    Admin.pairs = null; Admin.sel.clear();
    Admin.tab = 'live'; Admin.open();
  }

  /* ----- 학생 관리 ----- */
  function studentsTab(db, cls, main) {
    const list = students(db, cls);
    main.innerHTML = `<div class="students-layout"><section class="card"><h2>학생 등록</h2>
      <p class="muted small">한 줄에 한 명씩 <b>아이디,이름,비밀번호</b>를 적으세요. 비밀번호를 비우면 <b>1234</b>가 돼요.</p>
      <textarea id="bulk" rows="7" spellcheck="false" placeholder="kim01,김민준,123456&#10;lee02,이서연&#10;park03,박지호"></textarea>
      <button class="btn primary" id="bulk-add">등록하기</button><div id="bulk-res" class="small"></div></section>
      <section class="card"><h2>학생 목록 <small class="muted">${list.length}명</small></h2>
      <div class="table-wrap"><table class="table"><thead><tr><th>이름</th><th>아이디</th><th>티어</th><th>점수</th><th>전적</th><th></th></tr></thead><tbody>
      ${list.map(u => {
        const t = R.displayTier(db, u);
        return `<tr><td class="nm"><span class="dot ${S.online(db, u.uid) ? 'on' : 'off'}"></span>${esc(u.name)}</td><td class="muted">${esc(u.id)}</td>
          <td>${emblem(t.id, 20)} <span class="tier-text-${t.id}">${esc(t.name)}</span></td><td class="num">${u.score}</td>
          <td class="muted small">${u.wins || 0}승 ${u.losses || 0}패 ${u.draws || 0}무</td>
          <td class="row end"><button class="btn sm" data-edit="${u.uid}">수정</button><button class="btn sm danger" data-del="${u.uid}">삭제</button></td></tr>`;
      }).join('') || '<tr><td colspan="6" class="muted">등록된 학생이 없어요.</td></tr>'}</tbody></table></div></section></div>`;
    $('#bulk-add').onclick = () => bulkAdd(cls);
    $$('[data-edit]', main).forEach(b => b.onclick = () => editStudent(b.dataset.edit));
    $$('[data-del]', main).forEach(b => b.onclick = () => delStudent(b.dataset.del));
  }

  function bulkAdd(cls) {
    const lines = $('#bulk').value.split(/\n/).map(l => l.trim()).filter(Boolean);
    const fails = [];
    const added = S.update(db => {
      let n = 0;
      for (const line of lines) {
        const [rawId, rawName, rawPw] = line.split(/[,\t]/).map(x => (x || '').trim());
        const id = (rawId || '').toLowerCase();
        if (!/^[a-z0-9_]{2,16}$/.test(id)) { fails.push(`${line} — 아이디는 영문 소문자·숫자·_ 2~16자`); continue; }
        if (!rawName) { fails.push(`${line} — 이름이 없어요`); continue; }
        if (Object.values(db.users).some(u => u.cls === cls && u.id === id)) { fails.push(`${line} — 이미 있는 아이디`); continue; }
        const uid = 'u_' + cls + '_' + id;
        db.users[uid] = { uid, cls, id, name: rawName, pw: rawPw || '1234', role: 'student', score: R.START_SCORE, placed: 0, wins: 0, losses: 0, draws: 0, rankGames: 0, createdAt: S.now() };
        n++;
      }
      return n;
    });
    render();
    $('#bulk-res').innerHTML = `<p class="ok">${added}명 등록 완료</p>${fails.length ? `<p class="err">등록하지 못한 줄:<br>${fails.map(esc).join('<br>')}</p>` : ''}`;
    if (!fails.length) $('#bulk').value = '';
  }

  function editStudent(uid) {
    const db = S.get();
    const u = db.users[uid];
    if (!u) return;
    const m = modal(`<form class="form" id="ed">
      <label><span>이름</span><input name="name" value="${esc(u.name)}" required></label>
      <label><span>새 비밀번호 <small class="muted">(비우면 그대로)</small></span><input name="pw" type="text" autocomplete="off"></label>
      <label><span>점수</span><input name="score" type="number" min="0" max="5000" value="${u.score}"></label>
      <label class="check"><input type="checkbox" name="replace"> 배치고사 다시 하기 (점수 ${R.START_SCORE}점으로)</label>
      <div class="row end"><button class="btn" type="button" data-a="no">취소</button><button class="btn primary">저장</button></div></form>`, { title: `${u.name} 정보 수정` });
    $('[data-a=no]', m).onclick = () => m.close();
    $('#ed', m).onsubmit = e => {
      e.preventDefault();
      const f = e.target;
      S.update(d => {
        const x = d.users[uid];
        if (!x) return;
        x.name = f.elements.name.value.trim() || x.name;
        if (f.elements.pw.value) x.pw = f.elements.pw.value;
        const sc = Number(f.elements.score.value);
        if (isFinite(sc) && sc >= 0) x.score = Math.round(sc);
        if (f.elements.replace.checked) { x.placed = 0; x.score = R.START_SCORE; }
      });
      m.close(); render(); toast('저장했어요.');
    };
  }

  async function delStudent(uid) {
    const db = S.get();
    const u = db.users[uid];
    if (!u) return;
    if (!await confirmBox(`<b>${esc(u.name)}</b>(${esc(u.id)}) 학생을 삭제할까요? 점수와 계정이 사라지고 되돌릴 수 없어요.`, '삭제', true)) return;
    S.update(d => {
      for (const g of Object.values(d.games)) if (g.status === 'playing' && (g.white === uid || g.black === uid)) R.voidGame(d, g.id);
      delete d.users[uid]; delete d.queue[uid]; delete d.presence[uid];
      for (const [k, c] of Object.entries(d.challenges)) if (c.from === uid || c.to === uid) delete d.challenges[k];
    });
    render(); toast('삭제했어요.');
  }

  /* ----- 순위표 ----- */
  function rankingTab(db, cls, main) {
    const st = S.settings(db, cls);
    const legend = [['bronze', `~ ${st.tierSilver - 1}`], ['silver', `${st.tierSilver} ~`], ['gold', `${st.tierGold} ~`], ['platinum', `${st.tierPlatinum} ~`], ['diamond', `${st.tierDiamond} ~`], ['champion', '반 1위']];
    main.innerHTML = `<section class="card"><h2>순위표</h2>
      <div class="legend">${legend.map(([id, txt]) => `<span>${emblem(id, 22)} <b class="tier-text-${id}">${R.TIER_NAMES[id]}</b> <span class="muted small">${txt}</span></span>`).join('')}</div>
      <table class="rtable big">${window.App.rankingRows(db, cls, null)}</table>
      <p class="muted small">배치고사 ${R.PLACEMENT_GAMES}경기를 마친 학생만 순위에 들어가요.</p></section>`;
  }

  /* ----- 경기 기록 ----- */
  function logTab(db, cls, main) {
    const games = Object.values(db.games).filter(g => g.cls === cls && g.status === 'over').sort((a, b) => b.endedAt - a.endedAt).slice(0, 150);
    const res = g => g.voided ? '<span class="pill">무효</span>' : g.winner === null ? '무승부' : `${esc(nameOf(db, g.winner === 'w' ? g.white : g.black))} 승`;
    const dl = (g, s) => { const d = g.deltas && g.deltas[s]; if (!d || g.voided) return ''; return d.counted ? `<span class="delta ${d.delta >= 0 ? 'up' : 'down'}">${d.delta >= 0 ? '+' : ''}${d.delta}</span>` : '<span class="muted small">연습</span>'; };
    main.innerHTML = `<section class="card"><h2>경기 기록 <small class="muted">${games.length}건</small></h2><div class="table-wrap"><table class="table">
      <thead><tr><th>시간</th><th>백</th><th>흑</th><th>결과</th><th>종류</th><th></th></tr></thead><tbody>
      ${games.map(g => `<tr class="${g.voided ? 'voided' : ''}"><td class="muted small">${fmtTime(g.endedAt)}</td>
        <td>${esc(nameOf(db, g.white))} ${dl(g, 'w')}</td><td>${esc(nameOf(db, g.black))} ${dl(g, 'b')}</td>
        <td>${res(g)} <span class="muted small">${REASON[g.reason] || ''} · ${g.moves.length}수</span></td>
        <td class="small">${window.App.MATCH_NAME[g.matchType]}</td>
        <td class="row end"><button class="btn sm" data-rp="${g.id}">기보</button>${g.voided ? '' : `<button class="btn sm danger" data-void="${g.id}">무효</button>`}</td></tr>`).join('')
      || '<tr><td colspan="6" class="muted">기록이 없어요.</td></tr>'}</tbody></table></div></section>`;
    $$('[data-rp]', main).forEach(b => b.onclick = () => { const g = db.games[b.dataset.rp]; replay(g.moves, `${nameOf(db, g.white)} (백) vs ${nameOf(db, g.black)} (흑)`); });
    $$('[data-void]', main).forEach(b => b.onclick = () => voidGame(b.dataset.void));
  }

  /* ----- 설정 ----- */
  const FIELDS = [
    ['경기 규칙', [
      ['moveTime', '한 수 제한 시간 (초)', '0이면 무제한. 시간을 넘기면 시간패', 0, 600, 1],
      ['dailyLimit', '하루 점수 반영 랭크전 수', '0이면 무제한. 넘긴 경기는 연습 경기로 기록 (배치고사 제외)', 0, 50, 1],
      ['sameOppLimit', '1:1 도전: 같은 상대 제한', '하루에 같은 상대와 n번째 경기부터 연습 경기', 0, 20, 1]]],
    ['점수 배율', [
      ['multRandom', '랜덤 매치 배율', '', 0, 3, 0.1],
      ['multAssigned', '선생님 배정 매치 배율', '', 0, 3, 0.1],
      ['multSelect', '1:1 도전 매치 배율', '친구끼리 점수 주고받기 방지용으로 작게', 0, 3, 0.1],
      ['placementMult', '배치고사 배율', '배치고사 동안 점수가 크게 움직여 빠르게 제자리를 찾아요', 0, 5, 0.1]]],
    ['티어 시작 점수', [
      ['tierSilver', '실버', '', 0, 5000, 1], ['tierGold', '골드', '', 0, 5000, 1],
      ['tierPlatinum', '플래티넘', '', 0, 5000, 1], ['tierDiamond', '다이아', '', 0, 5000, 1]]]
  ];

  function settingsTab(db, cls, main) {
    const st = S.settings(db, cls);
    const c = db.classes[cls];
    main.innerHTML = `<div class="settings-layout"><form class="card form" id="st-form"><h2>경기·점수 규칙</h2>
      ${FIELDS.map(([title, fields]) => `<h3>${title}</h3><div class="fgrid">${fields.map(([k, label, hint, min, max, step]) =>
        `<label><span>${label}</span><input type="number" name="${k}" value="${st[k]}" min="${min}" max="${max}" step="${step}">${hint ? `<small class="muted">${hint}</small>` : ''}</label>`).join('')}</div>`).join('')}
      <p class="muted small">점수는 승패와 두 사람의 점수 차이로 계산해요(강한 상대를 이기면 더 많이 올라요). 시작 점수 ${R.START_SCORE}점, 배치고사 ${R.PLACEMENT_GAMES}경기.</p>
      <div class="row"><button class="btn primary">저장</button><button class="btn" type="button" id="st-default">기본값으로</button></div><p class="err" id="st-err"></p></form>
      <div><form class="card form" id="cls-form"><h2>반 정보</h2>
        <label><span>반 이름</span><input name="cname" value="${esc(c.name)}" required></label>
        <label><span>선생님 표시 이름</span><input name="tname" value="${esc(teacher(db).name)}" required></label>
        <label><span>새 관리자 비밀번호 <small class="muted">(비우면 그대로)</small></span><input name="pw" type="password" autocomplete="new-password"></label>
        <button class="btn primary">저장</button></form>
      ${S.mode === 'online'
        ? `<section class="card"><h2>저장 위치</h2><p class="muted small">온라인 모드 — 데이터는 Supabase 서버에 저장돼요. 학생들은 각자 기기에서 반 코드 <b>${esc(cls)}</b>로 로그인하면 돼요.</p></section>`
        : `<section class="card"><h2>데모 데이터</h2><p class="muted small">모든 데이터는 이 브라우저(localStorage)에만 저장돼요. 같은 브라우저의 다른 탭에서 다른 학생으로 로그인하면 실시간 대전을 해 볼 수 있어요.</p>
        <button class="btn danger" id="demo-reset2">데모 데이터 초기화</button></section>`}</div></div>`;
    $('#st-form').onsubmit = e => {
      e.preventDefault();
      const f = e.target, next = {};
      for (const [, fields] of FIELDS) for (const [k, , , min, max] of fields) {
        const v = Number(f.elements[k].value);
        if (!isFinite(v) || v < min || v > max) { $('#st-err').textContent = `값을 확인하세요: ${k}`; return; }
        next[k] = v;
      }
      if (!(next.tierSilver < next.tierGold && next.tierGold < next.tierPlatinum && next.tierPlatinum < next.tierDiamond)) {
        $('#st-err').textContent = '티어 시작 점수는 실버 < 골드 < 플래티넘 < 다이아 순으로 커야 해요.'; return;
      }
      $('#st-err').textContent = '';
      S.update(d => { d.classes[cls].settings = Object.assign({}, S.DEFAULT_SETTINGS, d.classes[cls].settings, next); });
      toast('설정을 저장했어요.');
    };
    $('#st-default').onclick = async () => {
      if (!await confirmBox('경기·점수 규칙을 기본값으로 되돌릴까요?', '되돌리기')) return;
      S.update(d => { d.classes[cls].settings = Object.assign({}, S.DEFAULT_SETTINGS); });
      render(); toast('기본값으로 되돌렸어요.');
    };
    $('#cls-form').onsubmit = e => {
      e.preventDefault();
      const f = e.target;
      if (f.elements.pw.value && f.elements.pw.value.length < 4) { toast('비밀번호는 4자 이상이어야 해요.', 'err'); return; }
      S.update(d => {
        d.classes[cls].name = f.elements.cname.value.trim() || d.classes[cls].name;
        const t = d.users[window.App.uid];
        t.name = f.elements.tname.value.trim() || t.name;
        if (f.elements.pw.value) t.pw = f.elements.pw.value;
      });
      f.elements.pw.value = '';
      Admin.open(); toast('저장했어요.');
    };
    const rs = $('#demo-reset2');
    if (rs) rs.onclick = async () => {
      if (!await confirmBox('이 브라우저에 저장된 <b>모든 반·학생·경기 기록</b>을 지우고 처음 데모 상태로 되돌릴까요? 로그아웃돼요.', '초기화', true)) return;
      S.reset(); S.logout(); location.reload();
    };
  }
})();
