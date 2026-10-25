(function () {
  var d = document, $ = function (id) { return d.getElementById(id); };

  // ---------- calculator ----------
  var inp = { imp: $('c-imp'), tan: $('c-tan'), dur: $('c-dur'), pre: $('c-pre'), rc: $('c-rc') };
  function costoPratica(imp) { return imp <= 20000 ? 2000 : imp <= 35000 ? 3500 : 5000; }
  function calc() {
    var P = +inp.imp.value, tan = +inp.tan.value, pre = +inp.pre.value, rc = +inp.rc.value;
    // the whole loan lasts at most 120 months and needs at least 12 repayment months after the pre-amortisation
    if (+inp.dur.value < pre + 12) inp.dur.value = Math.ceil((pre + 12) / 6) * 6;
    var dur = +inp.dur.value, n = dur - pre, r = tan / 100 / 12;
    var rataPre = P * r, rata = P * r / (1 - Math.pow(1 + r, -n));
    var interessi = rataPre * pre + rata * n - P, cons = costoPratica(P);
    $('o-imp').textContent = MIA.eur(P);
    $('o-tan').textContent = tan.toFixed(1).replace('.', ',') + '%';
    $('o-dur').textContent = dur + ' mesi';
    $('o-pre').textContent = pre + ' mesi';
    $('o-rc').textContent = rc + ' rate';
    $('r-rata').textContent = MIA.eur(rata, 2) + ' / mese';
    $('r-pre').textContent = MIA.eur(rataPre, 2) + ' × ' + pre;
    $('r-n').textContent = n;
    $('r-int').textContent = MIA.eur(interessi, 2);
    $('r-cons').textContent = MIA.eur(cons);
    $('r-rcons').textContent = MIA.eur(cons / rc, 2) + ' × ' + rc;
    $('r-tot').textContent = MIA.eur(P + interessi + cons, 2);
  }
  if (inp.imp) { Object.keys(inp).forEach(function (k) { inp[k].addEventListener('input', calc); }); calc(); }

  // ---------- registration ----------
  var form = $('reg');
  if (!form) return;
  if (MIA.offline($('reg-card'))) return;
  var ref = MIA.param('ref').toUpperCase();
  if (ref) MIA.db.rpc('ref_info', { code: ref }).then(function (r) {
    var who = r.data && r.data[0] && r.data[0].nome, box = $('invited');
    if (!who) return;
    box.innerHTML = '<span class="invited">Ti ha invitato <strong>' + MIA.esc(who) + '</strong></span>';
    box.hidden = false;
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = form.elements, err = form.querySelector('.err'), btn = form.querySelector('button[type=submit]');
    if (f.sito.value) return; // honeypot
    if (!form.checkValidity()) { err.textContent = 'Compila tutti i campi e accetta informativa e regole.'; form.reportValidity(); return; }
    var nascita = new Date(f.data_nascita.value), adult = new Date(); adult.setFullYear(adult.getFullYear() - 18);
    if (!(nascita <= adult)) { err.textContent = 'Per iscriverti devi essere maggiorenne.'; return; }
    if (!/^\+?[0-9 ]{6,20}$/.test(f.telefono.value.trim())) { err.textContent = 'Scrivi il telefono solo con numeri (es. +39 333 1234567).'; return; }
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Invio in corso…';
    MIA.db.auth.signInWithOtp({
      email: f.email.value.trim(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: MIA.base + 'area.html',
        data: {
          tipo: 'agente', nome: f.nome.value.trim(), cognome: f.cognome.value.trim(), data_nascita: f.data_nascita.value,
          telefono: f.telefono.value.trim(), iscritto_oam: form.querySelector('input[name=oam]:checked').value,
          consenso_privacy: 'true', versione_privacy: MIA.privacyVersion, ref: ref
        }
      }
    }).then(function (r) {
      if (r.error) throw r.error;
      $('reg-card').innerHTML = '<div class="ok-box"><h3>Controlla la tua email</h3><p style="margin:0">Ti abbiamo mandato un link a <strong>' + MIA.esc(f.email.value) + '</strong>. Aprilo da questo dispositivo per entrare nella tua area MIA. Se non lo trovi, guarda nella posta indesiderata.</p></div>';
    }).catch(function (e2) {
      err.textContent = MIA.errMsg(e2); btn.disabled = false; btn.textContent = 'Iscriviti';
    });
  });
})();
