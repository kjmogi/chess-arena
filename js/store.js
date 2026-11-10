/* 체스 아레나 — 저장소
   · 데모 모드: js/config.js 에 Supabase 정보가 없을 때. 이 브라우저의 localStorage에 저장하고 탭끼리 동기화.
   · 온라인 모드: Supabase 정보가 있을 때. 반(room)별 데이터를 서버에 두고 실시간 구독·접속 표시.
   두 모드 모두 Store.get()/Store.update(fn) 를 똑같이 쓴다. 온라인 모드의 update 는 화면에 바로 반영하고
   서버에는 뒤에서 보낸다. 다른 사람이 같은 항목을 먼저 바꿨으면 최신 내용으로 fn 을 다시 실행한다. */
(function () {
  'use strict';
  const CFG = window.CHESS_ARENA_CONFIG || {};
  const REMOTE = !!(CFG.supabaseUrl && CFG.supabaseKey);
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
  const KEY = 'chessArena_db_v1';
  const SS_UID = 'chessArena_uid', SS_PW = 'chessArena_pw', SS_CLS = 'chessArena_cls';
  const COLS = ['users', 'games', 'challenges', 'queue'];
  const listeners = new Set();

  let offset = 0; // 서버 시각 - 이 기기 시각
  const now = () => Math.round(Date.now() + offset);

  // 온라인 모드에서 fn 을 다시 실행해도 같은 id·난수가 나오도록 작업별로 기록해 둔다
  let ctx = null;
  function replayable(list, make) {
    if (!ctx) return make();
    const arr = ctx.job[list], i = ctx[list]++;
    if (i < arr.length) return arr[i];
    const v = make(); arr.push(v); return v;
  }
  let seq = 0;
  const genId = p => (p || '') + Date.now().toString(36) + (seq++ % 1296).toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6);
  const newId = p => replayable('ids', () => genId(p));
  const rand = () => replayable('rands', Math.random);

  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { /* 무시 */ } }
  };
  const clone = o => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const emptyDb = () => ({ v: 1, classes: {}, users: {}, games: {}, challenges: {}, queue: {}, presence: {} });

  const DEFAULT_SETTINGS = {
    moveTime: 60,          // 한 수 제한 시간(초), 0 = 무제한
    dailyLimit: 4,         // 하루 점수 반영 랭크전 수, 0 = 무제한
    multRandom: 1,         // 랜덤 매치 배율
    multAssigned: 1,       // 선생님 배정 매치 배율
    multSelect: 0.7,       // 1:1 도전 매치 배율
    placementMult: 1.5,    // 배치고사 배율
    sameOppLimit: 3,       // 1:1 도전: 하루 같은 상대 n판째부터 연습 경기
    tierSilver: 900, tierGold: 1000, tierPlatinum: 1100, tierDiamond: 1200
  };

  // 리스너 안에서 다시 update 가 불려도 무한히 파고들지 않도록, 알림 중에 생긴 알림은 뒤로 미룬다
  let emitting = false;
  function emit() {
    if (emitting) { emitSoon(); return; }
    emitting = true;
    try {
      const db = Store.get();
      for (const fn of listeners) { try { fn(db); } catch (e) { console.error(e); } }
    } finally { emitting = false; }
  }
  let emitTimer = null;
  function emitSoon() { if (!emitTimer) emitTimer = setTimeout(() => { emitTimer = null; emit(); }, 15); }
  function notifyError(msg) {
    if (window.UI && window.UI.toast) window.UI.toast(msg, 'err'); else console.warn(msg);
  }

  /* =====================================================================
     데모 모드 (localStorage)
     ===================================================================== */
  const Local = (function () {
    let cache = null, cacheRaw = null;
    function seed() {
      const t = Date.now();
      const cls = 'demo';
      const users = {};
      users.teacher_demo = { uid: 'teacher_demo', cls, id: 'teacher', name: '선생님', pw: '1234', role: 'teacher' };
      const names = [
        ['kim01', '김민준', 1135, 5, 9, 3], ['lee02', '이서연', 1062, 5, 7, 4], ['park03', '박지호', 1008, 5, 6, 6],
        ['choi04', '최하은', 958, 5, 4, 6], ['jung05', '정도윤', 884, 5, 3, 8], ['kang06', '강지우', 1000, 2, 1, 1],
        ['yoon07', '윤서준', 1000, 0, 0, 0], ['han08', '한예린', 1000, 0, 0, 0]
      ];
      for (const [id, name, score, placed, wins, losses] of names) {
        const uid = 'u_' + id;
        users[uid] = { uid, cls, id, name, pw: '1234', role: 'student', score, placed, wins, losses, draws: 0, rankGames: wins + losses, createdAt: t };
      }
      const db = emptyDb();
      db.classes[cls] = { code: cls, name: '데모 반', createdAt: t, settings: Object.assign({}, DEFAULT_SETTINGS) };
      db.users = users;
      return db;
    }
    function read() {
      let raw = null;
      try { raw = localStorage.getItem(KEY); } catch (e) { /* 저장소 사용 불가 */ }
      if (raw && raw === cacheRaw && cache) return cache;
      let db = null;
      try { db = raw ? JSON.parse(raw) : null; } catch (e) { db = null; }
      if (!db || db.v !== 1) { db = seed(); write(db); return db; }
      cache = db; cacheRaw = raw;
      return db;
    }
    function write(db) {
      const raw = JSON.stringify(db);
      cache = db; cacheRaw = raw;
      try { localStorage.setItem(KEY, raw); } catch (e) { /* 무시 */ }
    }
    window.addEventListener('storage', e => {
      if (e.key === KEY) { cache = null; cacheRaw = null; read(); emit(); }
    });
    return {
      get: read,
      update(fn) {
        cache = null; cacheRaw = null; // 다른 탭의 최신 내용을 다시 읽기
        const db = read();
        const res = fn(db);
        write(db);
        emit();
        return res;
      },
      reset() { write(seed()); emit(); },
      async open() { },
      async login(cls, id, pw) {
        const db = read();
        if (!db.classes[cls]) return { error: 'class' };
        const u = Object.values(db.users).find(x => x.cls === cls && x.id === id);
        if (!u || u.pw !== pw) return { error: 'cred' };
        ss.set(SS_UID, u.uid); ss.set(SS_CLS, cls);
        return { uid: u.uid };
      },
      async createClass({ code, name, tid, tname, pw }) {
        const uid = 't_' + code;
        const ok = Local.update(db => {
          if (db.classes[code]) return false;
          db.classes[code] = { code, name, createdAt: now(), settings: Object.assign({}, DEFAULT_SETTINGS) };
          db.users[uid] = { uid, cls: code, id: tid, name: tname, pw, role: 'teacher' };
          return true;
        });
        if (!ok) return { error: 'exists' };
        ss.set(SS_UID, uid); ss.set(SS_CLS, code);
        return { uid };
      },
      async resume() {
        const uid = ss.get(SS_UID);
        return uid && read().users[uid] ? uid : null;
      },
      logout() { ss.set(SS_UID, null); ss.set(SS_CLS, null); },
      heartbeat(uid) { Local.update(db => { db.presence[uid] = now(); }); }
    };
  })();

  /* =====================================================================
     온라인 모드 (Supabase)
     ===================================================================== */
  const Remote = (function () {
    const S = {
      room: null, gen: 0, base: emptyDb(), vers: {}, pending: [], cache: null,
      busy: false, reloading: false, needReload: false, touched: null,
      chan: null, live: false, wantUid: null, trackedUid: null, tabKey: genId('tab')
    };
    let clientP = null;

    function client() {
      if (!clientP) clientP = new Promise((resolve, reject) => {
        const make = () => window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        if (window.supabase && window.supabase.createClient) return resolve(make());
        const s = document.createElement('script');
        s.src = SDK_URL; s.async = true;
        s.onload = () => (window.supabase ? resolve(make()) : reject(new Error('Supabase 라이브러리를 불러오지 못했어요.')));
        s.onerror = () => { clientP = null; reject(new Error('Supabase 라이브러리를 불러오지 못했어요.')); };
        document.head.appendChild(s);
      });
      return clientP;
    }
    async function rpc(name, args) {
      const c = await client();
      const { data, error } = await c.rpc(name, args);
      if (error) throw new Error(error.message || String(error));
      return data;
    }
    // 서버에 보낼 때 쓰는 로그인 정보. 로그아웃 직후 남은 변경을 보낼 수 있도록 메모리에 따로 둔다.
    let cred = { uid: ss.get(SS_UID), pw: ss.get(SS_PW) };
    const auth = () => cred;

    // 'info' → classes[room], 'games/x' → games.x
    function put(db, k, val) {
      if (k === 'info') { if (val) db.classes[S.room] = val; else delete db.classes[S.room]; return; }
      const i = k.indexOf('/');
      const col = db[k.slice(0, i)];
      if (!col) return;
      if (val == null) delete col[k.slice(i + 1)]; else col[k.slice(i + 1)] = val;
    }
    function get(db, k) {
      if (k === 'info') return db.classes[S.room];
      const i = k.indexOf('/');
      return (db[k.slice(0, i)] || {})[k.slice(i + 1)];
    }
    const json = v => (v === undefined ? 'null' : JSON.stringify(v));

    // 바뀐 항목만 골라 서버에 보낼 목록으로. 비밀번호(users.*.pw)는 따로 떼어 보낸다.
    function diff(a, b) {
      const ops = [], pws = {};
      const push = (k, bv) => { if (json(get(a, k)) !== json(bv)) ops.push({ k, ver: S.vers[k] || 0, val: bv === undefined ? null : bv }); };
      push('info', b.classes[S.room]);
      for (const col of COLS) {
        const A = a[col] || {}, B = b[col] || {};
        for (const id of new Set(Object.keys(A).concat(Object.keys(B)))) {
          let bv = B[id];
          if (col === 'users' && bv && 'pw' in bv) {
            const { pw, ...rest } = bv;
            if (pw) pws[id] = String(pw);
            bv = rest;
          }
          push(col + '/' + id, bv);
        }
      }
      return { ops, pws };
    }

    function runJob(job, db) {
      const prev = ctx;
      ctx = { job, ids: 0, rands: 0 };
      try { return job.fn(db); } finally { ctx = prev; }
    }
    // 화면용 = 서버 확정본 + 아직 안 보낸 변경
    function rebuild() {
      if (!S.pending.length) S.cache = null;
      else {
        const c = clone(S.base);
        for (const j of S.pending) { try { runJob(j, c); } catch (e) { console.error(e); } }
        S.cache = c;
      }
      emitSoon();
    }

    async function pump() {
      if (S.busy || !S.pending.length || !S.room) return;
      S.busy = true;
      const job = S.pending[0], room = S.room, gen = S.gen;
      try {
        const work = clone(S.base);
        try { runJob(job, work); } catch (e) { console.error(e); S.pending.shift(); return; }
        const { ops, pws } = diff(S.base, work);
        if (!ops.length && !Object.keys(pws).length) { S.pending.shift(); return; }
        const a = auth();
        const res = await rpc('arena_apply', { p_room: room, p_uid: a.uid, p_pw: a.pw, p_ops: ops, p_pws: pws });
        if (gen !== S.gen) return;
        if (res.ok) {
          for (const op of ops) {
            put(S.base, op.k, op.val);
            S.vers[op.k] = res.vers[op.k];
            if (S.touched) S.touched.add(op.k);
          }
          if (pws[a.uid]) { cred = { uid: a.uid, pw: pws[a.uid] }; if (ss.get(SS_UID) === a.uid) ss.set(SS_PW, cred.pw); }
          S.pending.shift();
        } else if (res.error === 'conflict') {
          for (const r of res.conflicts) { put(S.base, r.k, r.val); S.vers[r.k] = r.ver; if (S.touched) S.touched.add(r.k); }
          if (++job.tries > 8) { S.pending.shift(); notifyError('다른 사람과 동시에 바꾸느라 저장하지 못했어요. 다시 해 주세요.'); }
        } else {
          S.pending.shift();
          if (res.error === 'auth') { S.pending.length = 0; window.dispatchEvent(new CustomEvent('arena-auth-failed')); }
          else notifyError('저장하지 못했어요 (' + res.error + ')');
        }
      } catch (e) {
        if (gen !== S.gen) return;
        job.net = (job.net || 0) + 1;
        console.warn('arena_apply 실패', e);
        if (job.net > 5) { S.pending.shift(); notifyError('서버에 연결할 수 없어 저장하지 못했어요. 인터넷 연결을 확인하세요.'); }
        else await sleep(700 * job.net);
      } finally {
        if (gen === S.gen) {
          S.busy = false;
          rebuild();
          if (S.needReload) { S.needReload = false; reload(); }
          if (S.pending.length) pump();
        }
      }
    }

    function onRow(row) {
      if (!row || row.room !== S.room || !row.k) return;
      if ((S.vers[row.k] || 0) >= row.ver) return;
      put(S.base, row.k, row.val);
      S.vers[row.k] = row.ver;
      if (S.touched) S.touched.add(row.k);
      rebuild();
    }
    function onPresence() {
      if (!S.chan) return;
      const p = {};
      for (const metas of Object.values(S.chan.presenceState())) for (const m of metas) if (m.uid) p[m.uid] = 8.64e15;
      S.base.presence = p;
      rebuild();
    }
    function syncTrack() {
      if (!S.chan || !S.live || S.trackedUid === S.wantUid) return;
      S.trackedUid = S.wantUid;
      if (S.wantUid) S.chan.track({ uid: S.wantUid }).catch(() => { S.trackedUid = null; });
      else S.chan.untrack().catch(() => { });
    }

    // 반 전체를 다시 불러오기 (처음 입장, 연결이 끊겼다 다시 붙었을 때)
    async function reload() {
      if (!S.room) return;
      if (S.busy || S.reloading) { S.needReload = true; return; }
      S.reloading = true; S.touched = new Set();
      const room = S.room, gen = S.gen, t0 = Date.now();
      try {
        const data = await rpc('arena_load', { p_room: room });
        if (gen !== S.gen) return;
        offset = data.now - (t0 + Date.now()) / 2;
        const prev = S.base, prevVers = S.vers;
        const db = emptyDb(); db.presence = prev.presence;
        const vers = {};
        S.base = db; S.vers = vers;
        for (const r of data.rows) { put(db, r.k, r.val); vers[r.k] = r.ver; }
        for (const k of S.touched) {  // 불러오는 동안 들어온 더 새로운 변경은 유지
          if ((prevVers[k] || 0) > (vers[k] || 0)) { put(db, k, get(prev, k)); vers[k] = prevVers[k]; }
        }
        rebuild();
      } finally {
        if (gen === S.gen) {
          S.reloading = false; S.touched = null;
          if (S.needReload && !S.busy) { S.needReload = false; reload(); }
        }
      }
    }

    async function close() {
      S.gen++;
      const ch = S.chan;
      Object.assign(S, { room: null, base: emptyDb(), vers: {}, pending: [], cache: null, busy: false, reloading: false, needReload: false, touched: null, chan: null, live: false, trackedUid: null });
      if (ch) { try { (await client()).removeChannel(ch); } catch (e) { /* 무시 */ } }
    }

    async function open(room) {
      if (S.room === room) return;
      await close();
      S.room = room;
      const gen = S.gen;
      const c = await client();
      if (gen !== S.gen) return;
      const ch = c.channel('arena:' + room, { config: { presence: { key: S.tabKey } } });
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'arena_kv', filter: 'room=eq.' + room }, p => onRow(p.new));
      ch.on('presence', { event: 'sync' }, onPresence);
      S.chan = ch;
      let first = true;
      await new Promise(resolve => {
        const done = () => { if (first) { first = false; resolve(); } };
        setTimeout(done, 6000);
        ch.subscribe(status => {
          if (gen !== S.gen) return;
          if (status === 'SUBSCRIBED') {
            S.live = true; S.trackedUid = null; syncTrack();
            if (first) done(); else reload();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            S.live = false; done();
          }
        });
      });
      if (gen !== S.gen) return;
      await reload();
    }

    // 실시간 연결이 안 될 때(학교 방화벽 등)를 대비해 몇 초마다 다시 불러오기
    setInterval(() => { if (S.room && !S.live && !document.hidden) reload().catch(() => { }); }, 4000);
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (S.room && Date.now() - hiddenAt > 20000) reload().catch(() => { });
    });
    window.addEventListener('online', () => { if (S.room) reload().catch(() => { }); });

    function setAuth(cls, uid, pw) { ss.set(SS_CLS, cls); ss.set(SS_UID, uid); ss.set(SS_PW, pw); cred = { uid, pw }; }
    function clearAuth() { ss.set(SS_CLS, null); ss.set(SS_UID, null); ss.set(SS_PW, null); }

    return {
      get() { return S.cache || S.base; },
      update(fn) {
        if (!S.room) return fn(emptyDb());
        const job = { fn, tries: 0, ids: [], rands: [] };
        if (!S.cache) S.cache = clone(S.base);
        const res = runJob(job, S.cache);
        S.pending.push(job);
        emit();
        pump();
        return res;
      },
      reset() { notifyError('온라인 모드에서는 초기화할 수 없어요.'); },
      open,
      async login(cls, id, pw) {
        await open(cls);
        const db = S.base;
        if (!db.classes[cls]) { await close(); return { error: 'class' }; }
        const u = Object.values(db.users).find(x => x.id === id);
        if (!u || !(await rpc('arena_login', { p_room: cls, p_uid: u.uid, p_pw: pw }))) return { error: 'cred' };
        setAuth(cls, u.uid, pw);
        return { uid: u.uid };
      },
      async createClass({ code, name, tid, tname, pw }) {
        const uid = 't_' + code;
        const t0 = Date.now();
        const res = await rpc('arena_create_room', {
          p_room: code,
          p_info: { code, name, createdAt: now(), settings: Object.assign({}, DEFAULT_SETTINGS) },
          p_teacher: { uid, cls: code, id: tid, name: tname, role: 'teacher' },
          p_pw: pw
        });
        if (!res.ok) return { error: res.error };
        offset = res.now - (t0 + Date.now()) / 2;
        setAuth(code, uid, pw);
        await open(code);
        return { uid };
      },
      async resume() {
        const cls = ss.get(SS_CLS), { uid, pw } = auth();
        if (!cls || !uid || !pw) return null;
        try {
          await open(cls);
          if (!S.base.users[uid] || !(await rpc('arena_login', { p_room: cls, p_uid: uid, p_pw: pw }))) { clearAuth(); return null; }
          return uid;
        } catch (e) { console.warn(e); return null; }
      },
      logout() {
        S.wantUid = null; syncTrack();
        const gen = S.gen;
        // 보내지 못한 변경(대기열 나가기 등)을 잠깐 기다렸다가 연결을 닫는다
        (async () => {
          for (let i = 0; i < 30 && S.pending.length && gen === S.gen; i++) await sleep(100);
          if (gen === S.gen && !ss.get(SS_UID)) { cred = { uid: null, pw: null }; close(); }
        })();
        clearAuth();
      },
      heartbeat(uid) { S.wantUid = uid; syncTrack(); }
    };
  })();

  const B = REMOTE ? Remote : Local;

  const Store = {
    mode: REMOTE ? 'online' : 'demo',
    DEFAULT_SETTINGS,
    now, newId, rand,
    get() { return B.get(); },
    // fn(db) 안에서 db를 직접 수정. 반환값 그대로 돌려줌. (온라인 모드에서는 fn 이 여러 번 실행될 수 있음)
    update(fn) { return B.update(fn); },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reset() { B.reset(); },
    settings(db, cls) { return Object.assign({}, DEFAULT_SETTINGS, (db.classes[cls] || {}).settings || {}); },
    // 로그인 (Promise): { uid } 또는 { error: 'class' | 'cred' | ... }
    login(cls, id, pw) { return B.login(cls, id, pw); },
    createClass(o) { return B.createClass(o); },
    resume() { return B.resume(); },
    logout() { B.logout(); },
    uid() { return ss.get(SS_UID); },
    // 접속 상태
    online(db, uid) { return (db.presence[uid] || 0) > now() - 15000; },
    heartbeat(uid) { if (uid) B.heartbeat(uid); }
  };

  window.Store = Store;
})();
