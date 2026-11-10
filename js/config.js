/* 체스 아레나 — 설정
   비워 두면 데모 모드(이 브라우저에만 저장)로 동작합니다.
   Supabase 프로젝트를 만들고 supabase/setup.sql 을 실행한 뒤 아래 두 값을 채우면 온라인 모드가 됩니다.
   · supabaseUrl : Project Settings → API (또는 Data API) 의 Project URL  예) https://abcdefgh.supabase.co
   · supabaseKey : Project Settings → API Keys 의 Publishable key (sb_publishable_…) 또는 anon public 키
   두 값은 브라우저에 공개되어도 되는 값입니다. service_role / secret 키는 절대 넣지 마세요. */
window.CHESS_ARENA_CONFIG = {
  supabaseUrl: 'https://alwxrqhdtyqyvplafgcv.supabase.co',
  supabaseKey: 'sb_publishable_FNpqKF6LATQiqQYAi38CIA_T4cjs1li'
};
