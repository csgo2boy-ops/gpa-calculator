/* =====================================================================
 * config.js — Supabase 設定
 *
 * 請填入你的 Supabase 專案資訊（在 Supabase 控制台 → Project Settings → API）。
 *
 * 重要安全提示：
 *   - 這裡只能放「公開的」Anon / Publishable Key，可安全暴露在前端。
 *   - 絕對不要放入 Service Role Key（service_role）——它可繞過 RLS，
 *     一旦外洩會導致所有使用者資料曝險。
 *
 * 未填寫時（保留 YOUR-PROJECT / YOUR-ANON 佔位符），網站會自動以
 * 「訪客模式」運作，資料存於本機 localStorage，不影響單機試算功能。
 * ===================================================================== */
window.APP_CONFIG = {
  // 例如：https://abcdefghijklm.supabase.co
  SUPABASE_URL: 'https://ycydacgtwufagvkpyubm.supabase.co/rest/v1/',

  // 公開金鑰（Anon / Publishable Key），開頭通常為 eyJhbGciOiJIUzI1NiIs...
  SUPABASE_ANON_KEY: 'sb_publishable_fRrfagp8Dsyhqmu4rHDRhg_6kp6XtvN'
};
