const { add } = require('../core/registry');
const { download, textOf } = require('../lib/util');
const { statusMedia, sendPrivate, notifyPrivate } = require('../lib/helpers');

// Télécharger un statut WhatsApp : on répond au statut avec « status ».
// Totalement discret : aucun message, aucune réaction dans la discussion — le statut arrive en privé.
async function run(ctx) {
  const m = statusMedia(ctx);

  if (!m) {
    // Statut texte : on envoie son contenu
    if (ctx.ctxInfo?.remoteJid === 'status@broadcast') {
      const cached = ctx.s?.statusCache?.get(ctx.ctxInfo?.stanzaId)?.message;
      const t = (ctx.quoted ? textOf(ctx.quoted) : cached?.conversation || '').trim();
      if (t) await sendPrivate(ctx, { text: `📝 *Statut*\n\n${t}` }).catch(e => console.error(`[${ctx.s?.id}] status:`, e.message));
    }
    return; // pas de statut cité : on ne fait rien (le mot « status » peut être une simple discussion)
  }

  try {
    if (!m.ok) throw new Error("WhatsApp n'a pas transmis ce statut au bot (ouvre-le puis réessaie)");
    const buf = await download(m.content, m.type);
    const p = { [m.type]: buf };
    if (m.type === 'audio') { p.mimetype = m.content.mimetype || 'audio/mp4'; p.ptt = !!m.content.ptt; }
    if (m.content.caption) p.caption = m.content.caption;
    await sendPrivate(ctx, p);
  } catch (e) {
    console.error(`[${ctx.s?.id}] status:`, e.message);
    await notifyPrivate(ctx, `⚠️ status : ${e.message}`);
  }
}

for (const name of ['status', 'statut']) {
  add({ name, cat: 'editing', desc: 'télécharger un statut WhatsApp', silent: true, run });
}
