const { add } = require('../core/registry');
const { download } = require('../lib/util');
const { pickMedia, quotedContent, assertDownloadable, sendPrivate } = require('../lib/helpers');

add({ name: 'save', cat: 'editing', desc: 'sauvegarder un média', async run(ctx) {
  const mm = pickMedia({ m: {}, quoted: quotedContent(ctx) }, ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage']);
  if (!mm) return ctx.reply('💾 *Réponds à un média* (image, vidéo, audio, statut…) avec *save*.');
  assertDownloadable(mm.content);
  const buf = await download(mm.content, mm.type);
  const p = { [mm.type]: buf };
  if (mm.type === 'audio') p.mimetype = mm.content.mimetype || 'audio/mp4';
  if (mm.type === 'document') { p.mimetype = mm.content.mimetype; p.fileName = mm.content.fileName; }
  if (mm.content.caption) p.caption = mm.content.caption;
  await sendPrivate(ctx, p);
  if (ctx.isGroup || ctx.from !== ctx.sender) await ctx.reply('💾 Média sauvegardé dans ta discussion privée.');
} });
