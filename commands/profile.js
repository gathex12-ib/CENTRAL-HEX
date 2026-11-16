const { add } = require('../core/registry');
const cfg = require('../core/config');
const protection = require('../core/protection');
const { num } = require('../lib/util');

// Retire « 🤖 INCONNU XD V2 » (et variantes) d'un texte et le remplace par CENTRAL-HEX-IB
const brand = x => String(x || '').replace(/(?:🤖\uFE0F?\s*)?INCONNU[\s_-]*XD(?:[\s_-]*V?[\s_-]*\d+)?/gi, 'CENTRAL-HEX-IB').trim();

add({ name: 'profile', cat: 'search', desc: 'profil', async run(ctx) {
  const t = ctx.target() || ctx.sender;
  let about = '—', url;
  try { const st = await ctx.sock.fetchStatus(t); about = brand((Array.isArray(st) ? st[0]?.status?.status : st?.status?.status || st?.status) || '—') || '—'; } catch {}
  try { url = await ctx.sock.profilePictureUrl(t, 'image'); } catch {}
  let role = '—', count = '—';
  if (ctx.isGroup) {
    const p = (ctx.meta?.participants || []).find(x => [x.id, x.lid, x.phoneNumber].filter(Boolean).map(num).includes(num(t)));
    role = p?.admin ? '👑 Admin' : '👤 Membre';
    count = (protection.groupCfg(ctx.store, ctx.from).counts || {})[num(t)] || 0;
  }
  const caption = `👤 *PROFIL*\n\n📛 Nom : ${t === ctx.sender ? brand(ctx.pushName) : '@' + num(t)}\n📞 Numéro : +${num(t)}\n💬 Statut : ${about}\n${ctx.isGroup ? `🎖️ Rôle : ${role}\n📊 Messages : ${count}\n` : ''}\n> ${cfg.BOT_NAME}`;
  await ctx.send(url ? { image: { url }, caption, mentions: [t] } : { text: caption, mentions: [t] });
} });
