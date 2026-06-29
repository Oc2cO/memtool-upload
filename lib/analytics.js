/**
 * MemTool Analytics — standalone event tracking script.
 *
 * Self-initializing on load. Exposes window.trackEvent(type, data).
 * Batches events for 30s then flushes. Also flushes on page hide/unload.
 * Anonymous-safe: no auth required, but picks up JWT from localStorage if present.
 */
(function () {
  'use strict';

  var ENDPOINT = '/api/memtool/events';
  var BATCH_DELAY_MS = 30000; // 30 seconds
  var MAX_BATCH = 50;

  var _queue = [];
  var _flushTimer = null;
  var _sessionId = null;
  var _userId = null; // extracted from JWT on init, attached to all events

  // Extract user_id from JWT once on init so all events are attributed.
  // Both 'memtool_token' (memtool-auth) and 'mt_token' (mt-auth) are checked.
  (function extractUserId() {
    var token = localStorage.getItem('memtool_token') || localStorage.getItem('mt_token') || null;
    if (!token) return;
    try {
      // JWT payload is base64url(JSON).sig — decode without verification (auth is server-side).
      var parts = token.split('.');
      if (parts.length < 2) return;
      var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      // signJwt() uses { sub: userId } — see lib/auth.js signJwt()
      _userId = payload.sub || payload.userId || null;
    } catch (_) {}
  })();

  // --- Session ID --------------------------------------------------------

  function getSessionId() {
    if (_sessionId) return _sessionId;
    try {
      var stored = sessionStorage.getItem('mt_sid');
      if (stored) { _sessionId = stored; return _sessionId; }
      _sessionId = 'sid_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      sessionStorage.setItem('mt_sid', _sessionId);
    } catch (_) {
      _sessionId = 'sid_' + Date.now();
    }
    return _sessionId;
  }

  // --- JWT passthrough (optional) ----------------------------------------
  // If the app stores a JWT in localStorage under 'mt_token', include it so
  // the backend can associate events with a user. Not required for tracking.

  function getAuthHeader() {
    try {
      var token = localStorage.getItem('mt_token') || localStorage.getItem('memtool_token');
      return token ? 'Bearer ' + token : null;
    } catch (_) {
      return null;
    }
  }

  // --- Flush ---------------------------------------------------------------

  function flush() {
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
    if (_queue.length === 0) return;

    var batch = _queue.splice(0, MAX_BATCH);
    var headers = { 'Content-Type': 'application/json' };
    // Prefer the already-decoded _userId over re-parsing the JWT at send-time.
    if (_userId) {
      headers['X-Analytix-User-Id'] = String(_userId);
    } else {
      var auth = getAuthHeader();
      if (auth) headers['Authorization'] = auth;
    }

    var payload = JSON.stringify({ events: batch });

    // Prefer sendBeacon for page-unload flushes (fire-and-forget, survives page close)
    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(ENDPOINT, blob);
    } else {
      fetch(ENDPOINT, { method: 'POST', headers: headers, body: payload, keepalive: true })
        .catch(function () { /* fail silently — analytics must never break the app */ });
    }
  }

  function scheduleFlush() {
    if (_flushTimer) return; // already scheduled
    _flushTimer = setTimeout(flush, BATCH_DELAY_MS);
  }

  // --- Public API ----------------------------------------------------------

  /**
   * Track an analytics event.
   * @param {string} type - Event name, e.g. 'page_view', 'game_started'
   * @param {object} [data] - Optional metadata object
   */
  /**
   * Track an analytics event.
   * @param {string} type - Event name, e.g. 'page_view', 'game_started'
   * @param {object} [data] - Optional metadata object
   * @param {string} [userId] - Explicit user_id override (e.g. passed after login);
   *                            updates the cached _userId so all subsequent
   *                            batched events carry it via X-Analytix-User-Id header.
   */
  function trackEvent(type, data, userId) {
    if (!type || typeof type !== 'string') return;
    if (userId) _userId = userId; // refresh cached id (e.g. after login)
    _queue.push({
      type: type,
      sessionId: getSessionId(),
      data: data || undefined,
    });
    scheduleFlush();
  }

  // --- Auto-tracking -------------------------------------------------------

  function trackPageView() {
    trackEvent('page_view', {
      path: window.location.pathname,
      referrer: document.referrer || undefined,
    });
  }

  // Flush on visibility change (tab switch, app background) and unload
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
  // beforeunload as fallback for browsers that don't fire pagehide reliably
  window.addEventListener('beforeunload', flush);

  // --- Initialize ----------------------------------------------------------

  window.trackEvent = trackEvent;
  // Expose flush so callers (e.g. ftueDone) can force immediate send of
  // time-sensitive events rather than waiting for the 30s batch window.
  window.flushAnalytics = flush;

  // Fire page_view once DOM is ready (or immediately if already loaded)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPageView);
  } else {
    trackPageView();
  }

})();
