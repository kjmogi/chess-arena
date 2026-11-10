-- 체스 아레나 — Supabase 설정 스크립트
-- Supabase 대시보드 → SQL Editor → New query 에 이 파일 전체를 붙여 넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다(기존 데이터는 지워지지 않음).
--
-- 저장 구조
--   arena_kv    : 반(room)별 데이터. k = 'info' | 'users/<uid>' | 'games/<id>' | 'challenges/<id>' | 'queue/<uid>'
--                 누구나 읽을 수 있고(실시간 구독), 쓰기는 arena_apply 함수로만 가능.
--   arena_pw    : 비밀번호 해시. 브라우저에서 읽을 수 없음.
--   arena_rooms : 반을 만든 선생님. 비밀번호 변경·반 정보 수정 권한 확인용. 읽을 수 없음.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.arena_kv (
  room       text        not null,
  k          text        not null,
  val        jsonb,                       -- null = 삭제됨
  ver        integer     not null default 1,
  updated_at timestamptz not null default now(),
  primary key (room, k)
);
create table if not exists public.arena_rooms (
  room       text primary key,
  teacher    text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.arena_pw (
  room text not null,
  uid  text not null,
  hash text not null,
  primary key (room, uid)
);

alter table public.arena_kv    enable row level security;
alter table public.arena_rooms enable row level security;
alter table public.arena_pw    enable row level security;

drop policy if exists arena_kv_read on public.arena_kv;
create policy arena_kv_read on public.arena_kv for select to anon, authenticated using (true);

grant select on public.arena_kv to anon, authenticated;
revoke insert, update, delete, truncate on public.arena_kv from anon, authenticated;
revoke all on public.arena_rooms, public.arena_pw from anon, authenticated;

-- 실시간(Realtime) 변경 알림 켜기
do $$ begin
  alter publication supabase_realtime add table public.arena_kv;
exception when duplicate_object then null;
end $$;

-- 서버 시각(ms) — 기기마다 시계가 달라도 제한 시간이 같게 흐르도록
create or replace function public.arena_now() returns bigint
language sql volatile as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
$$;

create or replace function public.arena_login(p_room text, p_uid text, p_pw text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.arena_pw
    where room = p_room and uid = p_uid and hash = extensions.crypt(coalesce(p_pw, ''), hash)
  )
$$;

-- 반 전체 불러오기
create or replace function public.arena_load(p_room text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'now', public.arena_now(),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('k', k, 'val', val, 'ver', ver))
      from public.arena_kv where room = p_room and val is not null
    ), '[]'::jsonb)
  )
$$;

-- 새 반 만들기 (선생님 계정 포함)
create or replace function public.arena_create_room(p_room text, p_info jsonb, p_teacher jsonb, p_pw text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_uid text := p_teacher->>'uid';
begin
  if p_room is null or p_room !~ '^[a-z0-9][a-z0-9-]{1,11}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_room');
  end if;
  if v_uid is null or v_uid !~ '^[A-Za-z0-9_-]{1,64}$' or coalesce(length(p_pw), 0) < 4 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  perform pg_advisory_xact_lock(hashtext('arena:' || p_room));
  if exists (select 1 from public.arena_rooms where room = p_room) then
    return jsonb_build_object('ok', false, 'error', 'exists');
  end if;
  insert into public.arena_rooms (room, teacher) values (p_room, v_uid);
  insert into public.arena_pw (room, uid, hash) values (p_room, v_uid, extensions.crypt(p_pw, extensions.gen_salt('bf')));
  insert into public.arena_kv (room, k, val) values
    (p_room, 'info', p_info),
    (p_room, 'users/' || v_uid, p_teacher - 'pw')
  on conflict (room, k) do update set val = excluded.val, ver = public.arena_kv.ver + 1, updated_at = now();
  return jsonb_build_object('ok', true, 'now', public.arena_now());
end $$;

-- 변경 적용: 로그인한 사용자만, 버전이 맞을 때만(동시에 바꾸면 한쪽은 다시 시도)
-- p_ops = [{ "k": "games/abc", "ver": 3, "val": {...} | null }, ...]
-- p_pws = { "<uid>": "<새 비밀번호>" }  (선생님만)
create or replace function public.arena_apply(p_room text, p_uid text, p_pw text, p_ops jsonb, p_pws jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  op jsonb;
  v_k text;
  v_val jsonb;
  cur integer;
  nv integer;
  is_teacher boolean;
  conflicts jsonb := '[]'::jsonb;
  vers jsonb := '{}'::jsonb;
  pw_uid text;
  pw_val text;
begin
  if not public.arena_login(p_room, p_uid, p_pw) then
    return jsonb_build_object('ok', false, 'error', 'auth');
  end if;
  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) > 300 then
    return jsonb_build_object('ok', false, 'error', 'bad_ops');
  end if;

  perform pg_advisory_xact_lock(hashtext('arena:' || p_room));
  select (teacher = p_uid) into is_teacher from public.arena_rooms where room = p_room;
  is_teacher := coalesce(is_teacher, false);

  for op in select value from jsonb_array_elements(p_ops) loop
    v_k := op->>'k';
    if v_k is null or v_k !~ '^(info|(users|games|challenges|queue)/[A-Za-z0-9_-]{1,64})$' then
      return jsonb_build_object('ok', false, 'error', 'bad_key', 'k', v_k);
    end if;
    if v_k = 'info' and not is_teacher then
      return jsonb_build_object('ok', false, 'error', 'forbidden', 'k', v_k);
    end if;
    select ver into cur from public.arena_kv where room = p_room and k = v_k;
    if coalesce(cur, 0) <> coalesce((op->>'ver')::integer, 0) then
      conflicts := conflicts || jsonb_build_array(coalesce(
        (select jsonb_build_object('k', k, 'val', val, 'ver', ver) from public.arena_kv where room = p_room and k = v_k),
        jsonb_build_object('k', v_k, 'val', null, 'ver', 0)));
    end if;
  end loop;
  if jsonb_array_length(conflicts) > 0 then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'conflicts', conflicts, 'now', public.arena_now());
  end if;

  if p_pws is not null and p_pws <> '{}'::jsonb then
    if not is_teacher then
      return jsonb_build_object('ok', false, 'error', 'forbidden', 'k', 'pw');
    end if;
    for pw_uid, pw_val in select key, value from jsonb_each_text(p_pws) loop
      if pw_uid !~ '^[A-Za-z0-9_-]{1,64}$' or coalesce(length(pw_val), 0) < 1 then
        return jsonb_build_object('ok', false, 'error', 'bad_pw');
      end if;
      insert into public.arena_pw (room, uid, hash)
      values (p_room, pw_uid, extensions.crypt(pw_val, extensions.gen_salt('bf')))
      on conflict (room, uid) do update set hash = excluded.hash;
    end loop;
  end if;

  for op in select value from jsonb_array_elements(p_ops) loop
    v_k := op->>'k';
    v_val := nullif(op->'val', 'null'::jsonb);
    insert into public.arena_kv (room, k, val, ver, updated_at) values (p_room, v_k, v_val, 1, now())
    on conflict (room, k) do update set val = excluded.val, ver = public.arena_kv.ver + 1, updated_at = now()
    returning ver into nv;
    vers := vers || jsonb_build_object(v_k, nv);
    if v_val is null and v_k like 'users/%' then
      delete from public.arena_pw where room = p_room and uid = substr(v_k, 7);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'vers', vers, 'now', public.arena_now());
end $$;

revoke execute on function public.arena_apply(text, text, text, jsonb, jsonb) from public;
revoke execute on function public.arena_create_room(text, jsonb, jsonb, text) from public;
revoke execute on function public.arena_login(text, text, text) from public;
revoke execute on function public.arena_load(text) from public;
grant execute on function public.arena_now() to anon, authenticated;
grant execute on function public.arena_login(text, text, text) to anon, authenticated;
grant execute on function public.arena_load(text) to anon, authenticated;
grant execute on function public.arena_create_room(text, jsonb, jsonb, text) to anon, authenticated;
grant execute on function public.arena_apply(text, text, text, jsonb, jsonb) to anon, authenticated;
