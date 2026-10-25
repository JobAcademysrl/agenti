const { chromium } = require('playwright'); const path = require('path');
(async () => { const b = await chromium.launch();
  for (const n of ['guida-15-minuti', 'regole-mia', 'checklist-documenti']) {
    const p = await b.newPage(); await p.goto('file://' + path.join(__dirname, n + '.html'));
    await p.pdf({ path: path.join(__dirname, '..', 'guide', n + '.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  }
  await b.close(); })();
