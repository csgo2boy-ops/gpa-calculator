/* =====================================================================
 * auth.js — Supabase 認證模組
 * 提供兩種登入方式：
 *   1. 帳號 + 密碼（不綁定 Email：內部以「合成 Email」包裝 Supabase Auth）
 *   2. Google 帳號（OAuth）
 *
 * Supabase Auth 本質上以 Email 作為帳號識別，因此「純帳號密碼」的做法是：
 * 將使用者輸入的帳號轉成固定的合成 Email（例：tom@gpa-tracker.local），
 * 使用者完全不需要知道或輸入 Email。請務必在 Supabase 關閉「Confirm email」。
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GpaAuth = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var USERNAME_DOMAIN = '@gpa-tracker.local';
  var currentUser = null;
  var client = null;
  var listeners = [];
  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });

  function cfg() {
    return (root && root.APP_CONFIG) || (typeof window !== 'undefined' && window.APP_CONFIG) || {};
  }
  function isConfigured() {
    var c = cfg();
    return !!c.SUPABASE_URL && c.SUPABASE_URL.indexOf('YOUR-PROJECT') === -1 &&
           !!c.SUPABASE_ANON_KEY && c.SUPABASE_ANON_KEY.indexOf('YOUR-ANON') === -1;
  }

  function init() {
    var sb = (root && root.supabase) || (typeof window !== 'undefined' && window.supabase);
    if (!sb || typeof sb.createClient !== 'function' || !isConfigured()) {
      readyResolve();
      return;
    }
    try {
      client = sb.createClient(cfg().SUPABASE_URL, cfg().SUPABASE_ANON_KEY);
    } catch (e) {
      client = null;
      readyResolve();
      return;
    }
    client.auth.getSession().then(function (res) {
      currentUser = (res && res.data && res.data.session && res.data.session.user) || null;
      readyResolve();
      listeners.forEach(function (cb) { try { cb(currentUser, 'INITIAL'); } catch (e) {} });
    }).catch(function () {
      currentUser = null;
      readyResolve();
    });
    client.auth.onAuthStateChange(function (event, session) {
      currentUser = (session && session.user) || null;
      listeners.forEach(function (cb) { try { cb(currentUser, event); } catch (e) {} });
    });
  }
  init();

  // ---------- 帳號 → 合成 Email ----------
  function normalizeUsername(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function isValidUsername(v) { return /^[a-z0-9_]{3,20}$/.test(normalizeUsername(v)); }
  function usernameToEmail(v) { return normalizeUsername(v) + USERNAME_DOMAIN; }

  function isLoggedIn() { return !!currentUser; }
  function getUser() { return currentUser; }
  function getClient() { return client; }
  function isAvailable() { return !!client; }
  function onAuthChange(cb) { listeners.push(cb); }

  function getDisplayName() {
    if (!currentUser) return '';
    var meta = currentUser.user_metadata || {};
    if (meta.username) return meta.username;
    var email = currentUser.email || '';
    return email ? email.split('@')[0] : '';
  }

  function translateError(err) {
    var msg = (err && err.message) || '';
    var lower = msg.toLowerCase();
    if (lower.indexOf('already registered') !== -1 || lower.indexOf('already exists') !== -1 || lower.indexOf('already been registered') !== -1) {
      return '此帳號名稱已被使用，請換一個或直接登入。';
    }
    if (lower.indexOf('invalid login credentials') !== -1) return '帳號名稱或密碼錯誤，請重新輸入。';
    if (lower.indexOf('password should be at least') !== -1 || lower.indexOf('weak password') !== -1) return '密碼長度不足，至少需要 6 個字元。';
    if (lower.indexOf('email not confirmed') !== -1) return '此帳號尚未啟用，請聯絡管理員（需在 Supabase 關閉 Email 確認）。';
    return '操作失敗：' + (msg || '請稍後再試。');
  }

  async function signUp(username, password) {
    if (!isAvailable()) return { ok: false, error: 'Supabase 尚未設定，請先到 config.js 填入專案 URL 與 Anon Key。' };
    if (!isValidUsername(username)) return { ok: false, error: '帳號名稱需為 3–20 個英文字母、數字或底線（_）。' };
    var u = normalizeUsername(username);
    var res = await client.auth.signUp({
      email: usernameToEmail(u),
      password: password,
      options: { data: { username: u } }
    });
    if (res.error) return { ok: false, error: translateError(res.error) };
    if (res.data && res.data.user && !res.data.session) return { ok: true, needConfirm: true };
    return { ok: true };
  }

  async function signIn(username, password) {
    if (!isAvailable()) return { ok: false, error: 'Supabase 尚未設定，請先到 config.js 填入專案 URL 與 Anon Key。' };
    if (!isValidUsername(username)) return { ok: false, error: '請輸入有效的帳號名稱（3–20 個英文字母、數字或底線）。' };
    var res = await client.auth.signInWithPassword({ email: usernameToEmail(username), password: password });
    if (res.error) return { ok: false, error: translateError(res.error) };
    return { ok: true };
  }

  async function signInWithGoogle() {
    if (!isAvailable()) return { ok: false, error: 'Supabase 尚未設定，請先到 config.js 填入專案 URL 與 Anon Key。' };
    var redirectTo = (typeof window !== 'undefined' && window.location && window.location.origin)
      ? window.location.origin
      : undefined;
    var res = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo } });
    if (res.error) return { ok: false, error: translateError(res.error) };
    return { ok: true };
  }

  async function signOut() {
    if (client) { try { await client.auth.signOut(); } catch (e) {} }
    currentUser = null;
    listeners.forEach(function (cb) { try { cb(null, 'SIGNED_OUT'); } catch (e) {} });
  }

  return {
    ready: ready,
    isLoggedIn: isLoggedIn,
    getUser: getUser,
    getClient: getClient,
    isAvailable: isAvailable,
    onAuthChange: onAuthChange,
    getDisplayName: getDisplayName,
    isValidUsername: isValidUsername,
    signUp: signUp,
    signIn: signIn,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut
  };
});
