// Emails sent when a client submits richiesta.html: full details to Job Academy, a heads-up to the agent
// who brought the client, and a receipt to the client. Called by the browser right after submit_client.
// Secrets: SMTP_USER, SMTP_PASS (Google Workspace app password). Port 465: Supabase blocks 25 and 587.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.16";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ADMIN = Deno.env.get("ADMIN_EMAIL") ?? "info@jobacademyilma.com";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const eur = (n: number | null) => n == null ? "non indicato" : n.toLocaleString("it-IT") + " €";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const { id } = await req.json();
    if (typeof id !== "string") return json({ error: "id mancante" }, 400);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // claim the notification once, and only for requests created in the last 15 minutes
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: c, error } = await db.from("clients")
      .update({ notificato_at: new Date().toISOString() })
      .eq("id", id).is("notificato_at", null).gt("created_at", since)
      .select("*").maybeSingle();
    if (error) throw error;
    if (!c) return json({ ok: true, skipped: true });
    const { data: a } = c.agent_id
      ? await db.from("agents").select("nome, cognome, email, telefono").eq("id", c.agent_id).maybeSingle()
      : { data: null };

    const chi = c.tipo === "azienda" ? `${c.ragione_sociale} (P.IVA ${c.partita_iva})` : `${c.nome} ${c.cognome} (CF ${c.codice_fiscale})`;
    const righe: [string, unknown][] = [
      ["Tipo", c.tipo === "azienda" ? "Azienda già esistente" : "Persona fisica"],
      ["Cliente", chi],
      ...(c.tipo === "azienda" ? [["Forma giuridica", c.forma_giuridica], ["Amministratore", c.amministratore]] as [string, unknown][] : []),
      ["Telefono", c.telefono], ["Email", c.email], ["Importo di interesse", eur(c.importo_richiesto)],
      ["Costo pratica", eur(c.costo_pratica)], ["Attività / uso", c.attivita || "—"],
      ["Documenti allegati", c.documenti?.length ? `${c.documenti.length} (li apri dall'area Amministrazione)` : "nessuno"],
      ["Consenso inoltro all'ente erogatore", c.consenso_inoltro ? "sì" : "no"],
      ["Agente", a ? `${a.nome} ${a.cognome} · ${a.email} · ${a.telefono}` : "nessuno (richiesta diretta)"],
    ];
    const tabella = `<table cellpadding="6" style="border-collapse:collapse;font:14px system-ui,Arial">${righe.map(([k, v]) => `<tr><td style="color:#5f636b">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join("")}</table>`;

    const smtp = nodemailer.createTransport({
      host: Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com", port: 465, secure: true,
      auth: { user: Deno.env.get("SMTP_USER")!, pass: Deno.env.get("SMTP_PASS")! },
    });
    const from = `"Job Academy" <${Deno.env.get("SMTP_USER")}>`;
    const area = "https://agenti.jobacademysrl.com/area.html";
    const invii = [
      smtp.sendMail({ from, to: ADMIN, replyTo: c.email, subject: `Nuova richiesta microcredito: ${chi}`,
        html: `<p>È arrivata una nuova richiesta dalla piattaforma MIA.</p>${tabella}<p><a href="${area}">Apri l'area Amministrazione</a></p>` }),
      smtp.sendMail({ from, to: c.email, replyTo: ADMIN, subject: "Abbiamo ricevuto la tua richiesta · Job Academy",
        html: `<p>Ciao ${esc(c.nome || c.amministratore || "")},</p><p>abbiamo ricevuto la tua richiesta di valutazione per il microcredito. ${a ? `Ti ricontatterà a breve il tuo consulente, <b>${esc(a.nome)} ${esc(a.cognome)}</b>.` : "Ti ricontatteremo a breve."}</p><p>Ricorda: la domanda di microcredito è gratuita, e lo è la verifica del credito dell'ente erogatore. La decisione sul finanziamento e il tasso spettano all'ente erogatore.</p><p>Per qualsiasi dubbio rispondi a questa email.</p><p>Job Academy srl · Via Stefano Canzio 50r, Genova</p>` }),
    ];
    if (a?.email) invii.push(smtp.sendMail({ from, to: a.email, replyTo: ADMIN, subject: `Nuovo cliente dal tuo link: ${chi}`,
      html: `<p>Ciao ${esc(a.nome)},</p><p>un nuovo cliente ha compilato il modulo dal tuo link.</p>${tabella.replace(/<tr><td[^>]*>Agente<\/td>.*?<\/tr>/, "")}<p>Contattalo per i prossimi passi e ricorda le regole MIA: nessuna promessa sull'esito, nessun pagamento a te. Lo stato della pratica lo trovi nella <a href="${area}">tua area</a>.</p>` }));
    const res = await Promise.allSettled(invii);
    const errori = res.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason));
    if (errori.length) console.error("invio email", errori);
    return json({ ok: errori.length === 0, inviate: res.length - errori.length, errori: errori.length });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
