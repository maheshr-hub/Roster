/* ------------------------------------------------------------------
   Roster data loader
   Replaces the fetch('data.json') call in the PWA.

   Behaviour: stale-while-revalidate.
   1. If a cached payload exists, render it immediately, offline included.
   2. Fetch in the background. If the etag differs, re-render.
   3. If the fetch fails, keep showing the cached copy and flag its age.

   Usage in index.html:

     <script src="roster-api.js"></script>
     <script>
       RosterAPI.load({
         onData: function (data, meta) { render(data); stamp(meta); },
         onError: function (err, meta) { showBanner(err, meta); }
       });
     </script>
   ------------------------------------------------------------------ */

var RosterAPI = (function () {

  var API_URL = 'https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnRd7kLSNGCSXUn2hk7MH9toyYMDCLJEtZmg441_ZNWMo63LwJdbyyGwI29qD1RQL9OK0KKV5KFNTNc3SsG4lpWGQFtWEveBHV7-3ydzWk4mwKgBmLlrB1T_qHNvx4oM2VSWGA6ek_AgNmOnnXlAsbXSj5i9ZnaVvz1x-vejQ_-OEaqkVlSaPVM9Vkuje-q2XioGWWpW9MpFnfIENfokJYxA9p77Gk0PqVMGpFsuxUW8VlAsERrdlFDu2G8Wvme9_c_wKUWsviXY1SW3-VSrt6P5rdaEZ52ke4IJZS8RykRfQovZrU_EFrAxR16Pna57t9VdW19kOeQ-jGc6Jz4&lib=M9hL1uGyuSa2nV10oMYS_fAfEmhg7y3HA';   // ends in /exec

  var LS_DATA  = 'roster.payload.v1';
  var LS_META  = 'roster.meta.v1';
  var LS_TOKEN = 'roster.token.v1';

  /* Token bootstrap.
     Share the app once as  https://…/index.html?t=THETOKEN
     It is stored locally and stripped from the address bar, so the token
     never sits in the published source. */
  function token() {
    try {
      var q = new URLSearchParams(location.search);
      var t = q.get('t');
      if (t) {
        localStorage.setItem(LS_TOKEN, t);
        q.delete('t');
        var clean = location.pathname + (q.toString() ? '?' + q : '') + location.hash;
        history.replaceState(null, '', clean);
        return t;
      }
      return localStorage.getItem(LS_TOKEN) || '';
    } catch (e) {
      return '';
    }
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(LS_DATA);
      if (!raw) { return null; }
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeCache(payload) {
    try {
      localStorage.setItem(LS_DATA, JSON.stringify(payload));
      localStorage.setItem(LS_META, JSON.stringify({
        fetched: new Date().toISOString(),
        etag: payload.meta && payload.meta.etag
      }));
    } catch (e) {
      // Quota exceeded. Not fatal, the app just refetches next launch.
    }
  }

  function cacheMeta() {
    try { return JSON.parse(localStorage.getItem(LS_META) || 'null'); }
    catch (e) { return null; }
  }

  function url(extra) {
    var u = API_URL + '?token=' + encodeURIComponent(token());
    if (extra) { u += extra; }
    return u;
  }

  /* JSONP fallback. Needed when the page is opened from file:// where the
     origin is null and CORS preflight has nothing to allow. */
  function jsonp(timeoutMs) {
    return new Promise(function (resolve, reject) {
      var name = 'rosterCb' + Math.random().toString(36).slice(2, 10);
      var s = document.createElement('script');
      var timer = setTimeout(function () { cleanup(); reject(new Error('timeout')); }, timeoutMs || 15000);

      function cleanup() {
        clearTimeout(timer);
        delete window[name];
        if (s.parentNode) { s.parentNode.removeChild(s); }
      }

      window[name] = function (payload) { cleanup(); resolve(payload); };
      s.onerror = function () { cleanup(); reject(new Error('network')); };
      s.src = url('&callback=' + name);
      document.head.appendChild(s);
    });
  }

  function offline() {
    return (typeof navigator !== 'undefined') && navigator.onLine === false;
  }

  function fetchFresh() {
    if (offline()) { return Promise.reject(new Error('offline')); }
    if (location.protocol === 'file:') { return jsonp(8000); }
    return fetch(url(), { cache: 'no-store', redirect: 'follow' })
      .then(function (r) {
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
        return r.json();
      })
      .catch(function () {
        // Could be a CORS quirk rather than a dead network, so try the
        // script tag before giving up. Skipped if the device says offline.
        if (offline()) { throw new Error('offline'); }
        return jsonp(8000);
      });
  }

  function load(opts) {
    opts = opts || {};
    var onData  = opts.onData  || function () {};
    var onError = opts.onError || function () {};

    if (API_URL.indexOf('PASTE_') === 0) {
      onError(new Error('API_URL not configured'), null);
      return;
    }

    var cached = readCache();
    var cachedEtag = cached && cached.meta && cached.meta.etag;

    if (cached) { onData(cached, { source: 'cache', meta: cacheMeta() }); }

    fetchFresh()
      .then(function (payload) {
        if (!payload || payload.error) {
          throw new Error(payload && payload.error ? payload.error : 'empty response');
        }
        writeCache(payload);
        var fresh = !cachedEtag || payload.meta.etag !== cachedEtag;
        if (fresh || !cached) {
          onData(payload, { source: 'network', changed: fresh, meta: cacheMeta() });
        }
      })
      .catch(function (err) {
        onError(err, { source: cached ? 'cache' : 'none', meta: cacheMeta() });
      });
  }

  function clear() {
    [LS_DATA, LS_META].forEach(function (k) { localStorage.removeItem(k); });
  }

  return { load: load, clear: clear, _url: url };
})();
