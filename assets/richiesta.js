(function () {
  var d = document, form = d.getElementById('req'), card = d.getElementById('req-card');
  var tipo = 'persona_fisica';
  var select = MIA.tabs(d.querySelector('.tabs'));
  // only the visible panel's fields are required
  function sync() {
    tipo = d.getElementById('panel-pf').hidden ? 'azienda' : 'persona_fisica';
    form.querySelectorAll('[data-pf]').forEach(function (i) { i.required = tipo === 'persona_fisica'; });
    form.querySelectorAll('[data-az]').forEach(function (i) { i.required = tipo === 'azienda'; });
  }
  d.querySelectorAll('.tab').forEach(function (t) { t.addEventListener('click', sync); });
  if (/azienda/.test(location.hash)) select(d.getElementById('tab-az'));
  sync();

  if (MIA.offline(card)) return;
  var ref = MIA.param('ref').toUpperCase();
  if (ref) MIA.db.rpc('ref_info', { code: ref }).then(function (r) {
    var who = r.data && r.data[0] && r.data[0].nome, box = d.getElementById('invited');
    if (!who) return;
    box.innerHTML = '<span class="invited" style="background:#ffffff24;color:#fff">Il tuo consulente: <strong>' + MIA.esc(who) + '</strong></span>';
    box.hidden = false;
  });

  var MAX = 10 * 1024 * 1024, OK = /\.(pdf|jpe?g|png)$/i;
  function uid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    sync();
    var f = form.elements, err = form.querySelector('.err'), btn = form.querySelector('button[type=submit]');
    if (!form.checkValidity()) { err.textContent = 'Compila i campi obbligatori e dai il consenso privacy.'; form.reportValidity(); return; }
    var panel = d.getElementById(tipo === 'azienda' ? 'panel-az' : 'panel-pf'), files = [];
    panel.querySelectorAll('input[type=file]').forEach(function (i) { [].forEach.call(i.files, function (file) { files.push({ doc: i.dataset.doc, file: file }); }); });
    for (var k = 0; k < files.length; k++) {
      if (!OK.test(files[k].file.name)) { err.textContent = 'Il file "' + files[k].file.name + '" non è PDF, JPG o PNG.'; return; }
      if (files[k].file.size > MAX) { err.textContent = 'Il file "' + files[k].file.name + '" supera i 10 MB.'; return; }
    }
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Invio in corso…';
    var folder = uid();
    Promise.all(files.map(function (x, i) {
      var path = folder + '/' + x.doc + '-' + (i + 1) + '.' + x.file.name.split('.').pop().toLowerCase();
      return MIA.db.storage.from('documenti-clienti').upload(path, x.file, { contentType: x.file.type || undefined, upsert: false })
        .then(function (r) { if (r.error) throw r.error; return path; });
    })).then(function (paths) {
      return MIA.db.rpc('submit_client', { p: {
        t: tipo, ref: ref,
        nome: f.nome.value, cognome: f.cognome.value, codice_fiscale: f.codice_fiscale.value.toUpperCase(),
        ragione_sociale: f.ragione_sociale.value, partita_iva: f.partita_iva.value, forma_giuridica: f.forma_giuridica.value,
        amministratore: f.amministratore.value, telefono: f.telefono.value, email: f.email.value, importo: f.importo.value,
        attivita: tipo === 'azienda' ? f.attivita_az.value : f.attivita_pf.value, documenti: paths,
        consenso_privacy: f.consenso.checked ? 'true' : 'false', consenso_inoltro: f.inoltro.checked, versione_privacy: MIA.privacyVersion
      } });
    }).then(function (r) {
      if (r.error) throw r.error;
      d.querySelector('.tabs').hidden = true;
      card.innerHTML = '<div class="ok-box"><h3>Richiesta inviata</h3><p style="margin:0">Grazie. Il tuo consulente ti ricontatta a breve per spiegarti i prossimi passi. Per qualsiasi dubbio scrivi a info@jobacademyilma.com.</p></div>';
      scrollTo({ top: 0, behavior: 'smooth' });
    }).catch(function (e2) {
      err.textContent = MIA.errMsg(e2); btn.disabled = false; btn.textContent = 'Invia la richiesta';
    });
  });
})();
