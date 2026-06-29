/** OC2CO public app ↔ marketing site (www.oc2co.com). */
(function (g) {
  const SITE_HOME = 'https://www.oc2co.com';
  const APP_ROOT = '/';

  g.OC2CO_SITE = Object.freeze({
    SITE_HOME,
    APP_ROOT,
    store: APP_ROOT + 'store',
    arcade: APP_ROOT + 'games.html',
    community: APP_ROOT + 'chat',
    memtool: APP_ROOT,
  });

  /** @deprecated use OC2CO_SITE */
  g.OC2CO_LINKS = g.OC2CO_SITE;
})(typeof window !== 'undefined' ? window : globalThis);
