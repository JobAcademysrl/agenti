# Piattaforma MIA · agenti.jobacademysrl.com

Area riservata ai MIA (Microcredito Info Agents) di Job Academy srl. Sito statico (GitHub Pages) con database, accessi e documenti su Supabase.

## Cosa c'è

| Pagina | A cosa serve |
| --- | --- |
| `index.html` | Metodo dei 15 minuti, Formula VIA, regole (cosa non dire), guadagni e tempi, calcolatore della rata, formazione, guide PDF, iscrizione agente (anche da link `?ref=CODICE`) |
| `accedi.html` | Accesso con link via email, senza password |
| `area.html` | Area personale: link affiliati (agenti e clienti), piramide e albero della rete fino al 4° livello, clienti, provvigioni; per l'amministratore: stati dei clienti, importi, documenti, qualifiche, liquidazione provvigioni |
| `richiesta.html` | Modulo cliente collegato all'agente (`?ref=CODICE`), stesse domande del sito microcredito, documenti facoltativi |
| `privacy.html` | Informativa per agenti e clienti |
| `guide/*.pdf` | Guide da scaricare (sorgenti in `guide-src/`, rigenerabili con `node guide-src/render.js`) |
| `supabase/schema.sql` | Database: tabelle, regole di accesso, rete, provvigioni, stati |

Regole economiche (in `supabase/schema.sql`):

- costo pratica: 2.000 € fino a 20.000 € richiesti, 3.500 € fino a 35.000 €, 5.000 € oltre;
- stati del cliente: In valutazione → Accettato o Respinto → Pagato → Concluso;
- quando l'amministratore segna "Pagato", il database crea le provvigioni: 500 € all'agente che ha portato il cliente, 250 € al suo sponsor, 150 € al 3° livello, 100 € al 4°, con scadenza a 10 giorni lavorativi.

Privacy nella rete: ogni agente vede i propri clienti con nome e contatti, quelli della sua rete solo con le iniziali. Degli agenti sotto di sé vede nome e iniziale del cognome; telefono ed email solo dei suoi diretti. I documenti li vede solo l'amministratore.

## Attivazione (una volta sola)

1. **Supabase**: crea un account su supabase.com e un progetto, regione nell'Unione europea (il progetto attuale è in Irlanda, eu-west-1).
2. **Database**: in Supabase apri *SQL Editor → New query*, incolla tutto `supabase/schema.sql` e premi *Run*.
3. **Accessi**: in *Authentication → URL Configuration* imposta *Site URL* `https://agenti.jobacademysrl.com` e aggiungi `https://agenti.jobacademysrl.com/**` tra i *Redirect URLs*.
4. **Email** (consigliato): in *Authentication → Emails → SMTP Settings* collega la casella di Job Academy; il servizio email di prova di Supabase invia pochi messaggi l'ora.
5. **Chiavi**: in *Project Settings → API* copia *Project URL* e la chiave *anon public* in `config.js`. La chiave anon è pubblica per natura: i dati sono protetti dalle regole del database.
6. **Amministratore**: iscriviti dal sito con `info@jobacademyilma.com`, poi esegui in SQL Editor:
   `update public.agents set is_admin = true, qualifica = 'Director' where email = 'info@jobacademyilma.com';`
7. **Email ai clienti**: la funzione `supabase/functions/notifica-cliente` (già pubblicata) manda a ogni richiesta un'email a Job Academy, all'agente e al cliente. In *Edge Functions → Secrets* servono `SMTP_USER` (info@jobacademyilma.com) e `SMTP_PASS` (password per le app di Google). Usa la porta 465: Supabase blocca la 587.
8. **Dominio**: su IONOS aggiungi il record CNAME `agenti` → `jobacademysrl.github.io`. In GitHub, *Settings → Pages*: sorgente *Deploy from a branch*, branch `main`, cartella `/ (root)`; il file `CNAME` imposta già il dominio. Quando il certificato è pronto, attiva *Enforce HTTPS*.

Finché `config.js` è vuoto il sito è visibile ma i moduli mostrano "Piattaforma in attivazione".

## Note

- `vendor/supabase.js` è la libreria ufficiale `@supabase/supabase-js` 2.118.0 (licenza MIT, `vendor/SUPABASE-LICENSE`), copiata qui per non dipendere da CDN.
- Il sito non è indicizzato (`robots.txt` e meta `noindex`).
- Le festività non sono considerate nel calcolo dei 10 giorni lavorativi.
