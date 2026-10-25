(function () {
  var d = document, $ = function (id) { return d.getElementById(id); }, db = MIA.db, esc = MIA.esc, eur = MIA.eur;
  if (!db) { $('loading').textContent = 'Piattaforma in attivazione.'; return; }
  var NEXT = { in_valutazione: ['accettato', 'respinto'], accettato: ['pagato', 'respinto'], pagato: ['concluso'] };
  var QUAL = ['Junior', 'Senior', 'Manager', 'Director'];
  var COLORS = ['#191c1f', '#2f6fe8', '#6b55e6', '#0f9d8a', '#ff7a3d'];
  function date(s) { return s ? new Date(s).toLocaleDateString('it-IT') : '—'; }
  function fail(e) { $('loading').hidden = false; $('loading').textContent = MIA.errMsg(e); }
  function rpc(name, args) { return db.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }

  $('logout').addEventListener('click', function () { db.auth.signOut().then(function () { location.href = 'accedi.html'; }); });
  d.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      navigator.clipboard.writeText($(b.dataset.copy).textContent).then(function () { b.textContent = 'Copiato'; setTimeout(function () { b.textContent = 'Copia'; }, 1500); });
    });
  });

  db.auth.getSession().then(function (r) {
    if (!r.data.session) { location.replace('accedi.html'); return; }
    return Promise.all([rpc('my_profile'), rpc('my_network'), rpc('my_clients'),
      db.from('commissions').select('livello, importo, stato, scadenza, created_at').order('created_at', { ascending: false })])
      .then(function (res) { render(res[0], res[1] || [], res[2] || [], (res[3] && res[3].data) || []); });
  }).catch(fail);

  function render(me, net, clients, prov) {
    if (!me) { fail({ message: 'Profilo agente non trovato. Se ti sei appena iscritto, riapri il link ricevuto via email.' }); return; }
    $('loading').hidden = true; $('head').hidden = false; $('dash').hidden = false;
    $('h-q').textContent = me.qualifica + (me.is_admin ? ' · Amministratore' : '');
    $('h-name').textContent = 'Ciao ' + me.nome;
    $('h-sub').textContent = 'Codice MIA ' + me.ref_code + (me.sponsor ? ' · Sponsor: ' + me.sponsor : '') + ' · Iscritto dal ' + date(me.iscritto_il);
    var own = clients.filter(function (c) { return c.livello === 1; });
    var potenziale = clients.filter(function (c) { return c.stato === 'in_valutazione' || c.stato === 'accettato'; })
      .reduce(function (s, c) { return s + Number(c.provvigione); }, 0);
    $('s-clienti').textContent = own.length;
    $('s-rete').textContent = net.length;
    $('s-maturate').textContent = eur(me.maturate);
    $('s-potenziale').textContent = eur(potenziale);

    // links
    var la = MIA.base + '?ref=' + me.ref_code + '#iscriviti', lc = MIA.base + 'richiesta.html?ref=' + me.ref_code;
    $('link-agente').textContent = la; $('link-cliente').textContent = lc;
    $('wa-agente').href = 'https://wa.me/?text=' + encodeURIComponent('Entra nella rete MIA di Job Academy, l\'iscrizione è gratuita: ' + la);
    $('wa-cliente').href = 'https://wa.me/?text=' + encodeURIComponent('Ecco il link per iniziare la valutazione del microcredito con Job Academy: ' + lc);

    // clients by status (whole network)
    $('by-status').innerHTML = ['in_valutazione', 'accettato', 'pagato', 'concluso'].map(function (s) {
      var n = clients.filter(function (c) { return c.stato === s; }).length;
      return '<div class="card"><span class="muted small">' + MIA.stati[s] + '</span><b style="display:block;font-size:32px;font-weight:600">' + n + '</b><span class="small muted">clienti nella tua rete</span></div>';
    }).join('');

    renderNetwork(me, net);

    $('tb-clienti').innerHTML = clients.length ? clients.map(function (c) {
      var p = c.stato === 'pagato' || c.stato === 'concluso' ? eur(c.provvigione) : c.stato === 'respinto' ? '—' : '<span class="muted">' + eur(c.provvigione) + ' potenziali</span>';
      return '<tr><td>' + date(c.creato_il) + '</td><td>' + c.livello + '°</td><td>' + esc(c.agente) + '</td><td><b>' + esc(c.cliente) + '</b></td><td>' +
        (c.telefono ? esc(c.telefono) + '<br><span class="muted">' + esc(c.email) + '</span>' : '<span class="muted">riservati</span>') + '</td><td>' +
        (c.importo ? eur(c.importo) : '—') + '</td><td>' + (c.costo_pratica ? eur(c.costo_pratica) : '—') + '</td><td>' + MIA.chip(c.stato) + '</td><td>' + amici(c) + '</td><td>' +
        (c.sconto ? '<b>−' + eur(c.sconto) + '</b>' : '—') + '</td><td>' + p + '</td></tr>';
    }).join('') : '<tr><td colspan="11"><div class="empty">Nessun cliente ancora. Condividi il tuo link per i clienti.</div></td></tr>';

    $('prov-sum').innerHTML = [['Maturate', me.maturate], ['Da liquidare', me.da_liquidare], ['Liquidate', me.liquidate], ['Potenziali', potenziale]].map(function (x) {
      return '<div class="card"><span class="muted small">' + x[0] + '</span><b style="display:block;font-size:30px;font-weight:600">' + eur(x[1]) + '</b></div>';
    }).join('');
    $('tb-prov').innerHTML = prov.length ? prov.map(function (p) {
      return '<tr><td>' + date(p.created_at) + '</td><td>' + p.livello + '°</td><td><b>' + eur(p.importo) + '</b></td><td>' + date(p.scadenza) + '</td><td>' + MIA.chip(p.stato) + '</td></tr>';
    }).join('') : '<tr><td colspan="5"><div class="empty">Le provvigioni compaiono qui quando un cliente della tua rete paga.</div></td></tr>';

    MIA.tabs(d.querySelector('.dash > .tabs'));
    if (me.is_admin) { $('t-admin').hidden = false; MIA.tabs($('admin-tabs')); }
  }

  // friends brought by a client: accepted / announced, plus who presented this client
  function amici(c) {
    var x = (c.amici_accettati || 0) + ' accettati' + (c.amici_previsti ? ' su ' + c.amici_previsti + ' previsti' : '');
    return x + (c.presentato_da ? '<br><span class="muted small">presentato da ' + esc(c.presentato_da) + '</span>' : '');
  }

  function renderNetwork(me, net) {
    var counts = [1, 0, 0, 0, 0];
    net.forEach(function (a) { counts[a.livello]++; });
    var max = Math.max.apply(null, counts.slice(1).concat([1]));
    var labels = ['Tu', '1° livello', '2° livello', '3° livello', '4° livello'];
    $('pyramid').innerHTML = counts.map(function (n, i) {
      var w = i === 0 ? 28 : 34 + 66 * (n / max) * (0.55 + i * 0.12);
      return '<div class="pyr l' + i + '" style="width:' + Math.min(100, w).toFixed(0) + '%"><span>' + labels[i] + '</span><b>' + (i === 0 ? esc(me.nome) : n) + '</b></div>';
    }).join('');
    var kids = {};
    net.forEach(function (a) { (kids[a.sponsor_id] = kids[a.sponsor_id] || []).push(a); });
    function branch(id) {
      var k = kids[id];
      if (!k) return '';
      return '<ul>' + k.map(function (a) {
        return '<li><div class="node n' + a.livello + '"><span class="q" style="color:' + COLORS[a.livello] + '">' + a.qualifica + '</span><b>' + esc(a.nome) + '</b>' +
          a.clienti + ' clienti · ' + a.clienti_pagati + ' pagati</div>' + branch(a.id) + '</li>';
      }).join('') + '</ul>';
    }
    $('tree').innerHTML = net.length ? '<ul><li><div class="node me"><span class="q">' + esc(me.qualifica) + '</span><b>' + esc(me.nome) + ' (tu)</b>' + net.length + ' agenti in rete</div>' + branch(me.id) + '</li></ul>'
      : '<div class="empty">La tua rete è vuota. Condividi il link per invitare un agente.</div>';
    var direct = net.filter(function (a) { return a.livello === 1; });
    $('direct').innerHTML = direct.length ? '<h3 style="margin-top:24px">I tuoi diretti</h3><div class="tbl-wrap"><table class="data"><thead><tr><th>Agente</th><th>Qualifica</th><th>Telefono</th><th>Email</th><th>Iscritto</th><th>Clienti</th></tr></thead><tbody>' +
      direct.map(function (a) { return '<tr><td><b>' + esc(a.nome) + '</b></td><td>' + a.qualifica + '</td><td>' + esc(a.telefono) + '</td><td>' + esc(a.email) + '</td><td>' + date(a.iscritto_il) + '</td><td>' + a.clienti + '</td></tr>'; }).join('') + '</tbody></table></div>' : '';
  }

  // horizontal connector between first and last child of each group; measured when the tab is visible
  MIA.drawTree = function () {
    $('tree').querySelectorAll('ul ul').forEach(function (ul) {
      var lis = ul.children; if (lis.length < 2) { ul.style.setProperty('--l', '50%'); ul.style.setProperty('--r', '50%'); return; }
      var a = lis[0], b = lis[lis.length - 1];
      ul.style.setProperty('--l', (a.offsetLeft + a.offsetWidth / 2) + 'px');
      ul.style.setProperty('--r', (ul.offsetWidth - b.offsetLeft - b.offsetWidth / 2) + 'px');
    });
  };
  addEventListener('resize', function () { if (!$('p-rete').hidden) MIA.drawTree(); });

  // ---------- administration ----------
  var adminLoaded = false;
  MIA.loadAdmin = function () { if (!adminLoaded) { adminLoaded = true; loadAdmin(); } };
  function adminErr(e) { $('admin-err').textContent = e ? MIA.errMsg(e) : ''; }
  function loadAdmin() {
    adminErr();
    return Promise.all([rpc('admin_clients'), rpc('admin_agents'), rpc('admin_commissions')]).then(function (r) {
      renderAdminClients(r[0] || []); renderAdminAgents(r[1] || []); renderAdminProv(r[2] || []); renderAdminSum(r[0] || [], r[2] || []);
    }).catch(adminErr);
  }
  function renderAdminClients(rows) {
    $('ta-clienti').innerHTML = rows.length ? rows.map(function (c) {
      var next = NEXT[c.stato] || [];
      var editable = c.stato === 'in_valutazione' || c.stato === 'accettato';
      return '<tr data-id="' + c.id + '"><td>' + date(c.creato_il) + '</td><td><b>' + esc(c.cliente) + '</b><br><span class="muted">' + esc(c.codice) + (c.tipo === 'azienda' ? ' · azienda' : '') + '</span>' +
        (c.attivita ? '<br><span class="muted small">' + esc(c.attivita) + '</span>' : '') + '</td><td>' + esc(c.telefono) + '<br><span class="muted">' + esc(c.email) + '</span></td><td>' +
        (c.agente ? esc(c.agente) : '<span class="muted">diretto</span>') + '</td><td>' +
        (editable ? '<input type="number" min="1000" max="100000" step="500" value="' + (c.importo || '') + '" data-imp style="width:110px"> <button class="btn btn-xs" data-act="imp" type="button">Salva</button>' : (c.importo ? eur(c.importo) : '—')) +
        '</td><td>' + (c.costo_pratica ? eur(c.costo_pratica) : '—') + (c.sconto ? '<br><span class="small">sconto −' + eur(c.sconto) + '<br><b>da pagare ' + eur(Math.max(0, c.costo_pratica - c.sconto)) + '</b></span>' : '') +
        '</td><td>' + amici(c) + (c.codice_amico ? '<br><span class="muted small">codice amico ' + esc(c.codice_amico) + '</span>' : '') + '</td><td>' +
        (c.presentato_da ? esc(c.presentato_da) : c.presentato_da_testo ? '<span class="muted">scritto dal cliente:</span> ' + esc(c.presentato_da_testo) : '<span class="muted">—</span>') +
        '<br><input type="text" placeholder="codice amico" data-cod style="width:110px;margin-top:6px"> <button class="btn btn-xs" data-act="pres" type="button">Collega</button></td><td>' + MIA.chip(c.stato) + '</td><td>' +
        (next.length ? '<select data-stato>' + next.map(function (s) { return '<option value="' + s + '">' + MIA.stati[s] + '</option>'; }).join('') + '</select> <button class="btn btn-xs" data-act="stato" type="button">Applica</button>' : '<span class="muted">—</span>') +
        '</td><td>' + (c.documenti && c.documenti.length ? c.documenti.map(function (p, i) { return '<a href="#" data-doc="' + esc(p) + '">Doc ' + (i + 1) + '</a>'; }).join(' · ') : '<span class="muted">nessuno</span>') +
        '</td><td><button class="btn btn-xs btn-danger" data-act="del" type="button">Elimina</button></td></tr>';
    }).join('') : '<tr><td colspan="12"><div class="empty">Nessun cliente.</div></td></tr>';
  }
  $('ta-clienti') && $('ta-clienti').addEventListener('click', function (e) {
    var t = e.target, tr = t.closest('tr'); if (!tr) return;
    if (t.dataset.doc) {
      e.preventDefault();
      db.storage.from('documenti-clienti').createSignedUrl(t.dataset.doc, 120).then(function (r) { if (r.error) throw r.error; window.open(r.data.signedUrl, '_blank', 'noopener'); }).catch(adminErr);
      return;
    }
    if (t.dataset.act === 'stato') {
      var s = tr.querySelector('[data-stato]').value;
      if (s === 'pagato' && !confirm('Confermi che il cliente ha pagato? Verranno generate le provvigioni per i 4 livelli.')) return;
      t.disabled = true;
      rpc('admin_set_status', { p_id: tr.dataset.id, p_stato: s, p_note: null }).then(loadAdmin).catch(function (e2) { t.disabled = false; adminErr(e2); });
    }
    if (t.dataset.act === 'pres') {
      t.disabled = true;
      rpc('admin_set_presentatore', { p_id: tr.dataset.id, p_codice: tr.querySelector('[data-cod]').value }).then(loadAdmin).catch(function (e2) { t.disabled = false; adminErr(e2); });
    }
    if (t.dataset.act === 'del') {
      var nome = tr.querySelector('b').textContent;
      if (!confirm('Eliminare definitivamente ' + nome + '? Si cancellano anche i suoi documenti e le provvigioni collegate, comprese quelle già liquidate.')) return;
      t.disabled = true;
      rpc('admin_delete_client', { p_id: tr.dataset.id }).then(function (docs) {
        return docs && docs.length ? db.storage.from('documenti-clienti').remove(docs) : null;
      }).then(loadAdmin).catch(function (e2) { t.disabled = false; adminErr(e2); });
    }
    if (t.dataset.act === 'imp') {
      t.disabled = true;
      rpc('admin_set_importo', { p_id: tr.dataset.id, p_importo: Number(tr.querySelector('[data-imp]').value) || null }).then(loadAdmin).catch(function (e2) { t.disabled = false; adminErr(e2); });
    }
  });
  function renderAdminAgents(rows) {
    $('ta-agenti').innerHTML = rows.map(function (a) {
      return '<tr data-id="' + a.id + '"><td>' + date(a.iscritto_il) + '</td><td><b>' + esc(a.nome + ' ' + a.cognome) + '</b><br><span class="muted">' + a.ref_code + '</span></td><td>' + esc(a.telefono) + '<br><span class="muted">' + esc(a.email) + '</span></td><td>' +
        date(a.data_nascita) + '</td><td>' + (a.iscritto_oam ? 'Sì' : 'No') + '</td><td>' + esc(a.sponsor || '—') + '</td><td>' + a.diretti + '</td><td>' + a.clienti + '</td><td>' + provv(a) + '</td><td><select data-q>' +
        QUAL.map(function (q) { return '<option' + (q === a.qualifica ? ' selected' : '') + '>' + q + '</option>'; }).join('') + '</select></td><td><input type="checkbox" data-att' + (a.attivo ? ' checked' : '') + '></td><td><button class="btn btn-xs" data-act="ag" type="button">Salva</button> <button class="btn btn-xs btn-danger" data-act="delag" type="button">Elimina</button></td></tr>';
    }).join('');
  }
  function provv(a) {
    return '<span class="small">da liquidare <b>' + eur(a.prov_da_liquidare || 0) + '</b><br>liquidate <b>' + eur(a.prov_liquidate || 0) + '</b></span>';
  }
  $('ta-agenti') && $('ta-agenti').addEventListener('click', function (e) {
    var t = e.target, tr = t.closest('tr');
    if (t.dataset.act === 'delag') {
      var nome = tr.querySelector('b').textContent;
      if (!confirm('Eliminare definitivamente l\'agente ' + nome + '? Non potrà più accedere; la sua rete passa al suo sponsor e i suoi clienti restano senza agente.')) return;
      t.disabled = true;
      rpc('admin_delete_agent', { p_id: tr.dataset.id }).then(loadAdmin).catch(function (e2) { t.disabled = false; adminErr(e2); });
      return;
    }
    if (t.dataset.act !== 'ag') return;
    t.disabled = true;
    rpc('admin_set_agent', { p_id: tr.dataset.id, p_qualifica: tr.querySelector('[data-q]').value, p_attivo: tr.querySelector('[data-att]').checked })
      .then(loadAdmin).catch(function (e2) { t.disabled = false; adminErr(e2); });
  });
  // totals always visible on top of the administration panel
  function renderAdminSum(clients, prov) {
    function tot(st) { var r = prov.filter(function (m) { return m.stato === st; }); return [r.length, r.reduce(function (s, m) { return s + Number(m.importo); }, 0)]; }
    var da = tot('da_liquidare'), li = tot('liquidata');
    var inCorso = clients.filter(function (c) { return c.stato === 'in_valutazione' || c.stato === 'accettato'; }).length;
    $('admin-sum').innerHTML = [
      ['Provvigioni da liquidare', eur(da[1]), da[0] + ' provvigioni'],
      ['Provvigioni liquidate', eur(li[1]), li[0] + ' provvigioni'],
      ['Pratiche in corso', inCorso, 'in valutazione o accettate'],
      ['Clienti totali', clients.length, clients.filter(function (c) { return c.stato === 'pagato' || c.stato === 'concluso'; }).length + ' hanno pagato']
    ].map(function (x) { return '<div class="card"><span class="muted small">' + x[0] + '</span><b>' + x[1] + '</b><span class="muted small">' + x[2] + '</span></div>'; }).join('');
  }
  function renderAdminProv(rows) {
    $('ta-prov').innerHTML = rows.length ? rows.map(function (m) {
      return '<tr data-id="' + m.id + '"><td><b>' + esc(m.agente || '—') + '</b><br><span class="muted">' + esc(m.agente_email || '') + '</span></td><td>' + esc(m.cliente) + '</td><td>' + m.livello + '°</td><td><b>' + eur(m.importo) + '</b></td><td>' +
        date(m.scadenza) + '</td><td>' + MIA.chip(m.stato) + '</td><td>' + (m.stato === 'da_liquidare' ? '<button class="btn btn-xs" data-act="pay" type="button">Segna liquidata</button>' : date(m.liquidata_at)) + '</td></tr>';
    }).join('') : '<tr><td colspan="7"><div class="empty">Nessuna provvigione.</div></td></tr>';
  }
  $('ta-prov') && $('ta-prov').addEventListener('click', function (e) {
    var t = e.target, tr = t.closest('tr'); if (t.dataset.act !== 'pay') return;
    t.disabled = true;
    rpc('admin_pay_commission', { p_id: tr.dataset.id }).then(loadAdmin).catch(function (e2) { t.disabled = false; adminErr(e2); });
  });
})();
