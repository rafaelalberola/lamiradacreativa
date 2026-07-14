/* First-party analytics beacon — La Mirada Creativa.
 * Sends an anonymous pageview (+ UTM) to /.netlify/functions/track.
 * No cookies, no PII. device_id is a random id kept in localStorage so we can
 * count unique visitors and stitch visit -> lead -> purchase ourselves,
 * without depending on Amplitude/Mixpanel. */
(function () {
  try {
    var KEY = 'lmc_device_id';
    var id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
        's' + Date.now().toString(36) + Math.random().toString(36).slice(2);
      localStorage.setItem(KEY, id);
    }

    var qs = new URLSearchParams(location.search);
    // Persist first-touch UTM for later events (lead / checkout).
    var utm = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
      var v = qs.get(k);
      if (v) { utm[k] = v; try { localStorage.setItem('lmc_' + k, v); } catch (e) {} }
      else { try { var s = localStorage.getItem('lmc_' + k); if (s) utm[k] = s; } catch (e) {} }
    });

    window.lmcTrack = function (eventName) {
      var payload = Object.assign({
        event: eventName || 'pageview',
        path: location.pathname,
        device_id: id,
        referrer: document.referrer || ''
      }, utm);
      var body = JSON.stringify(payload);
      var url = '/.netlify/functions/track';
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        } else {
          fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
        }
      } catch (e) {}
    };

    window.lmcTrack('pageview');
  } catch (e) { /* never break the page */ }
})();
