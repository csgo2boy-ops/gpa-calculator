/* =====================================================================
 * auth.js — Supabase 認證模組（登入 / 註冊 / 登出 / 狀態監聽）
 * 依賴：@supabase/supabase-js（CDN，暴露全域 supabase）與 config.js（APP_CONFIG）。
 * 若 Supabase 未設定或 CDN 未載入，會自動降級為「訪客模式」。
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GpaAuth = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var currentUser = null;
  var client = null;
  var listeners = [];
  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });

  function cfg() {
    var c = (root && root.APP_CONFIG) || (typeof window !== 'undefined' && window.APP_CONFIG) || {};
    return c;
  }

  function isConfigured() {
    var c = cfg();
    return !!c.SUPABASE_URL && c.SUPABASE_URL.indexOf('YOUR-PROJECT') === -1 &&
           !!c.SUPABASE_ANON_KEY && c.SUPABASE_ANON_KEY.indexOf('YOUR-ANON') === -1;
  }

  function init() {
    var sb = (root && root.supabase) || (typeof window !== 'undefined' && window.supabase);
    if (!sb || typeof sb.createClient !== 'function' || !isConfigured()) {
      // Supabase 不可用 → 訪客模式
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

  function isLoggedIn() { return !!currentUser; }
  function getUser() { return currentUser; }
  function getClient() { return client; }
  function isAvailable() { return !!client; }
  function onAuthChange(cb) { listeners.push(cb); }

  function translateError(err) {
    var msg = (err && err.message) || '';
    var lower = msg.toLowerCase();
    if (lower.indexOf('already registered') !== -1 || lower.indexOf('already exists') !== -1 || lower.indexOf('already been registered') !== -1) {
      return '帳號已存在，請直接登入。';
    }
    if (lower.indexOf('invalid login credentials') !== -1) return 'Email 或密碼錯誤，請重新輸入。';
    if (lower.indexOf('password should be at least') !== -1 || lower.indexOf('weak password') !== -1) return '密碼長度不足，至少需要 6 個字元。';
    if (lower.indexOf('email not confirmed') !== -1) return 'Email 尚未驗證，請先到信箱點擊確認連結。';
    if (lower.indexOf('email') !== -1 && lower.indexOf('valid') !== -1) return 'Email 格式不正確。';
    return '操作失敗：' + (msg || '請稍後再試。');
  }

  async function signUp(email, password) {
    if (!isAvailable()) return { ok: false, error: 'Supabase 尚未設定，請先到 config.js 填入專案 URL 與 Anon Key。' };
    var res = await client.auth.signUp({ email: email, password: password });
    if (res.error) return { ok: false, error: translateError(res.error) };
    if (res.data && res.data.user && !res.data.session) {
      return { ok: true, needConfirm: true };
    }
    return { ok: true };
  }

  async function signIn(email, password) {
    if (!isAvailable()) return { ok: false, error: 'Supabase 尚未設定，請先到 config.js 填入專案 URL 與 Anon Key。' };
    var res = await client.auth.signInWithPassword({ email: email, password: password });
    if (res.error) return { ok: false, error: translateError(res.error) };
    return { ok: true };
  }

  async function signInWithGoogle() {
    if (!isAvailable()) return { ok: false, error: 'Supabase 尚未設定，請先到 config.js 填入專案 URL 與 Anon Key。' };
    var redirectTo = (typeof window !== 'undefined' && window.location && window.location.origin)
      ? window.location.origin
      : undefined;
    var res = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo }
    });
    if (res.error) return { ok: false, error: translateError(res.error) };
    // 成功時 SDK 會自動將瀏覽器導向 Google；回跳後由 getSession / onAuthStateChange 捕獲 Session
    return { ok: true };
  }

  async function signOut() {
    if (client) {
      try { await client.auth.signOut(); } catch (e) { /* ignore */ }
    }
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
    signUp: signUp,
    signIn: signIn,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut
  };
});
