// Renders the link-preview images (Open Graph, 1200×630) for the agents site and the client form.
const { chromium } = require('playwright'); const path = require('path');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.goto('file://' + path.join(__dirname, 'og.html'));
  await p.screenshot({ path: path.join(__dirname, '..', 'og.png') });
  await p.evaluate(() => {
    document.body.style.setProperty('--c2', '#0f9d8a');
    document.getElementById('mark').textContent = 'JA';
    document.getElementById('brand').textContent = 'Job Academy · Microcredito';
    document.getElementById('kicker').textContent = 'Valutazione gratuita';
    document.getElementById('title').textContent = 'Microcredito per la tua attività, fino a 100.000 €';
    document.getElementById('pills').innerHTML = '<div class="pill"><b>Gratis</b>la domanda</div><div class="pill"><b>80%</b>garantito dallo Stato</div><div class="pill"><b>10 anni</b>per restituire</div>';
  });
  await p.screenshot({ path: path.join(__dirname, '..', 'og-cliente.png') });
  await b.close(); })();
