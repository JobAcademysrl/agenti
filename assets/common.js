(function () {
  var d = document;
  d.documentElement.classList.add('js');
  var cfg = window.MIA_CONFIG || {};
  var MIA = window.MIA = {};

  // Supabase client, or null while the platform is not configured yet
  MIA.db = (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase)
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } })
    : null;
  MIA.privacyVersion = cfg.privacyVersion || '';
  MIA.base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  MIA.param = function (k) { return new URLSearchParams(location.search).get(k) || ''; };
  MIA.eur = function (n, dec) {
    return (Number(n) || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always', minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  };
  MIA.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  MIA.stati = { in_valutazione: 'In valutazione', accettato: 'Accettato', respinto: 'Respinto', pagato: 'Pagato', concluso: 'Concluso', da_liquidare: 'Da liquidare', liquidata: 'Liquidata' };
  MIA.chip = function (s) { return '<span class="st st-' + s + '">' + (MIA.stati[s] || s) + '</span>'; };
  // Database errors arrive in Italian from the SQL functions; anything else gets a generic message
  MIA.errMsg = function (e) {
    var m = (e && (e.message || e.error_description)) || '';
    if (/rate limit|security purposes/i.test(m)) return 'Troppi tentativi ravvicinati: riprova tra un minuto.';
    if (/database error saving new user/i.test(m)) return 'Iscrizione non riuscita: controlla che tutti i campi siano corretti e che tu sia maggiorenne.';
    if (/fetch|network/i.test(m)) return 'Connessione non riuscita. Controlla la rete e riprova.';
    return m || 'Qualcosa non ha funzionato. Riprova.';
  };
  MIA.offline = function (el) {
    if (MIA.db || !el) return false;
    el.insertAdjacentHTML('afterbegin', '<p class="offline"><strong>Piattaforma in attivazione.</strong> Le iscrizioni si apriranno a breve: per informazioni scrivi a info@jobacademyilma.com.</p>');
    el.querySelectorAll('button[type=submit]').forEach(function (b) { b.disabled = true; });
    return true;
  };

  // tabs
  MIA.tabs = function (root) {
    var tabs = [].slice.call(root.querySelectorAll('.tab'));
    function select(t) {
      tabs.forEach(function (x) {
        var on = x === t;
        x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1;
        d.getElementById(x.getAttribute('aria-controls')).hidden = !on;
      });
      if (t.dataset.onshow && MIA[t.dataset.onshow]) MIA[t.dataset.onshow]();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; select(n); n.focus(); }
      });
    });
    return select;
  };

  // reveal on scroll, staggered among siblings
  var els = d.querySelectorAll('.reveal, .tstep');
  els.forEach(function (el) {
    var sibs = [].filter.call(el.parentNode.children, function (c) { return c.classList.contains('reveal'); });
    if (sibs.indexOf(el) >= 0) el.style.setProperty('--d', Math.min(sibs.indexOf(el), 6) * 80 + 'ms');
  });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });
  } else els.forEach(function (el) { el.classList.add('in'); });

  var nav = d.querySelector('.nav');
  if (nav) addEventListener('scroll', function () { nav.classList.toggle('scrolled', scrollY > 8); }, { passive: true });
})();
