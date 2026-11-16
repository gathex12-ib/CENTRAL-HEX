// Récupération des médias « vue unique » / sauvegarde.
// WhatsApp ne transmet souvent pas ces médias au bot : on demande alors au téléphone principal de
// renvoyer le message original (requestPlaceholderResend), puis on le télécharge depuis le cache.
const { download, unwrap, sleep } = require('./util');
const cfg = require('../core/config');
const { quotedContent, sendPrivate, notifyPrivate } = require('./helpers');

const isOk = n => !!(n && n.mediaKey && (n.url || n.directPath));
const kindOf = t => t.replace('Message', '');

// Demande le message original au téléphone et attend qu'il arrive dans le cache (10 s max)
async function fetchOriginal(ctx) {
  try {
    const id = ctx.ctxInfo?.stanzaId;
    if (!id || typeof ctx.sock.requestPlaceholderResend !== 'function') return null;
    const have = ctx.s.cache.get(id);
    if (have?.message) return unwrap(have.message); // déjà reçu en entier : pas besoin de redemander
    const key = { remoteJid: ctx.from, id, fromMe: false };
    if (ctx.from.endsWith('@g.us')) key.participant = ctx.ctxInfo.participant;
    await ctx.sock.requestPlaceholderResend(key);
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const c = ctx.s.cache.get(id);
      if (c?.message) return unwrap(c.message);
    }
  } catch (e) {
    console.error(`[${ctx.s?.id}] demande du message original:`, e.message);
  }
  return null;
}

// Trouve le média cité (message cité → cache → demande au téléphone)
async function mediaOf(ctx, types) {
  const inner = quotedContent(ctx);
  const t = inner && types.find(k => inner[k]);
  if (t && isOk(inner[t])) return { type: kindOf(t), content: inner[t], ok: true };

  const wrapped = /viewOnce/i.test(Object.keys(ctx.quotedRaw || {}).join(','));
  if (ctx.ctxInfo?.stanzaId && (t || wrapped)) {
    const orig = await fetchOriginal(ctx);
    const t2 = orig && types.find(k => orig[k]);
    if (t2) return { type: kindOf(t2), content: orig[t2], ok: isOk(orig[t2]) };
  }
  return t ? { type: kindOf(t), content: inner[t], ok: false } : null;
}

const FAIL = "WhatsApp n'a pas transmis ce média au bot, même après avoir demandé au téléphone (vue unique non délivrée). Essaie quand le téléphone est connecté, avant d'ouvrir la vue unique.";

async function viewOnce(ctx, silent) {
  const mm = await mediaOf(ctx, ['imageMessage', 'videoMessage', 'audioMessage']);
  if (!mm) return silent ? null : ctx.reply('👉 *Réponds à un média « vue unique »* avec cette commande.');
  try {
    if (!mm.ok) throw new Error(FAIL);
    const buf = await download(mm.content, mm.type);
    const p = { [mm.type]: buf, caption: `👁️ Vue unique récupérée\n> ${cfg.BOT_NAME}` };
    if (mm.type === 'audio') { p.mimetype = 'audio/mp4'; delete p.caption; }
    await sendPrivate(ctx, p);
    if (!silent) await ctx.reply('📥 Média envoyé dans ta discussion privée.');
  } catch (e) {
    console.error(`[${ctx.s?.id}] ${ctx.cmd || 'vue unique'}:`, e.message);
    if (silent) await notifyPrivate(ctx, `⚠️ ${ctx.cmd || 'humm'} : ${e.message}`);
    else throw e;
  }
}

async function save(ctx) {
  const mm = await mediaOf(ctx, ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage']);
  if (!mm) return ctx.reply('💾 *Réponds à un média* (image, vidéo, audio, statut…) avec *save*.');
  if (!mm.ok) throw new Error(FAIL);
  const buf = await download(mm.content, mm.type);
  const p = { [mm.type]: buf };
  if (mm.type === 'audio') p.mimetype = mm.content.mimetype || 'audio/mp4';
  if (mm.type === 'document') { p.mimetype = mm.content.mimetype; p.fileName = mm.content.fileName; }
  if (mm.content.caption) p.caption = mm.content.caption;
  await sendPrivate(ctx, p);
  if (ctx.isGroup || ctx.from !== ctx.sender) await ctx.reply('💾 Média sauvegardé dans ta discussion privée.');
}

module.exports = { viewOnce, save, mediaOf, fetchOriginal };
