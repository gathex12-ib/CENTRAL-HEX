// Fonctions partagées entre les commandes
const cfg = require('../core/config');
const find = require('../lib/find');
const axios = require('axios');
const cheerio = require('cheerio');
const yts = require('yt-search');
const fs = require('fs');
const path = require('path');
const { getJson, getBuffer, firstOk, download, unwrap, UA } = require('../lib/util');

const MEDIA = path.join(process.cwd(), 'data', 'media');

fs.mkdirSync(MEDIA, { recursive: true });


function menuImage(ctx) {
  const f = ctx.store.data.menuImage;
  if (f && f.startsWith('http')) return { url: f };
  if (f && fs.existsSync(f)) return fs.readFileSync(f);
  return { url: cfg.MENU_IMAGE };
}

const banner = (ctx, caption) => ctx.send({ image: menuImage(ctx), caption });


const own = ctx => ctx.sock.user.id.split(':')[0] + '@s.whatsapp.net';


function pickMedia(ctx, types) {
  for (const src of [ctx.m, ctx.quoted]) {
    if (!src) continue;
    for (const t of types) if (src[t]) return { type: t.replace('Message', ''), content: src[t], msg: src };
  }
  return null;
}


// Message cité : d'abord celui fourni par WhatsApp, sinon celui gardé en cache par le bot (via l'id du message cité)
function quotedContent(ctx) {
  if (ctx.quoted) return ctx.quoted;
  const id = ctx.ctxInfo?.stanzaId;
  const cached = id && ctx.s?.cache?.get(id)?.message;
  return cached ? unwrap(cached) : null;
}

// Vérifie que WhatsApp a réellement transmis le média (sinon impossible à télécharger)
function assertDownloadable(node) {
  if (!node || !node.mediaKey || !(node.url || node.directPath)) {
    throw new Error("WhatsApp n'a pas transmis ce média au bot (vue unique non délivrée)");
  }
}

// Discussion privée de la personne qui tape la commande.
// - message envoyé depuis le numéro du bot (propriétaire) → son propre numéro
// - sinon l'expéditeur ; si c'est un identifiant LID on essaie de retrouver son vrai numéro
async function privateDest(ctx) {
  if (ctx.msg?.key?.fromMe) return own(ctx);
  let d = ctx.sender;
  if (d && d.endsWith('@lid')) {
    try {
      const pn = await ctx.sock.signalRepository?.lidMapping?.getPNForLID?.(d);
      if (pn) d = String(pn).split('@')[0].split(':')[0] + '@s.whatsapp.net';
    } catch {}
  }
  return d;
}

async function sendPrivate(ctx, payload) {
  return ctx.sock.sendMessage(await privateDest(ctx), payload);
}

// Petite note envoyée uniquement à la personne qui a tapé la commande (jamais dans la discussion)
async function notifyPrivate(ctx, text) {
  try { await sendPrivate(ctx, { text }); } catch (e) { console.error(`[${ctx.s?.id}] note privée:`, e.message); }
}

// Média d'un statut cité : message cité si WhatsApp l'a fourni, sinon copie gardée en mémoire par le bot
function statusMedia(ctx) {
  const types = ['imageMessage', 'videoMessage', 'audioMessage'];
  const id = ctx.ctxInfo?.stanzaId;
  const cached = id && ctx.s?.statusCache?.get(id);
  let first = null;
  for (const src of [quotedContent(ctx), cached ? unwrap(cached.message) : null]) {
    if (!src) continue;
    const t = types.find(k => src[k]);
    if (!t) continue;
    const node = src[t];
    const item = { type: t.replace('Message', ''), content: node, ok: !!(node.mediaKey && (node.url || node.directPath)) };
    if (item.ok) return item;
    first = first || item;
  }
  return first;
}

async function viewOnce(ctx, silent) {
  const inner = quotedContent(ctx);
  if (!inner) return silent ? null : ctx.reply('👉 *Réponds à un média « vue unique »* avec cette commande.');
  // On n'exige plus le drapeau « viewOnce » : WhatsApp le retire souvent du message cité
  const t = ['imageMessage', 'videoMessage', 'audioMessage'].find(k => inner[k]);
  if (!t) return silent ? null : ctx.reply('ℹ️ Aucun média (photo, vidéo, audio) dans le message cité.');
  try {
    const kind = t.replace('Message', '');
    assertDownloadable(inner[t]);
    const buf = await download(inner[t], kind);
    const payload = { [kind]: buf, caption: `👁️ Vue unique récupérée\n> ${cfg.BOT_NAME}` };
    if (kind === 'audio') { payload.mimetype = 'audio/mp4'; delete payload.caption; }
    await sendPrivate(ctx, payload);
    if (!silent) await ctx.reply('📥 Média envoyé dans ta discussion privée.');
  } catch (e) {
    console.error(`[${ctx.s?.id}] ${ctx.cmd || 'vue unique'}:`, e.message);
    if (silent) await notifyPrivate(ctx, `⚠️ ${ctx.cmd || 'humm'} : ${e.message}`); // discret : note privée, rien dans la discussion
    else throw e;
  }
}

const cleanHref = h => {
  h = (h || '').trim();
  const m = h.match(/uddg=([^&]+)/);
  if (m) h = decodeURIComponent(m[1]);
  if (h.startsWith('//')) h = 'https:' + h;
  // liens de redirection Bing : ...&u=a1<base64url>
  const b = h.match(/[?&]u=a1([A-Za-z0-9_-]+)/);
  if (b) { try { h = Buffer.from(b[1], 'base64').toString('utf8'); } catch {} }
  return h;
};

async function ddgHtml(query, n) {
  const r = await axios.post('https://html.duckduckgo.com/html/', new URLSearchParams({ q: query, kl: 'fr-fr' }).toString(), {
    headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'fr-FR,fr;q=0.9' }, timeout: 20000 });
  const $ = cheerio.load(r.data);
  const out = [];
  $('.result').each((_, el) => {
    if (out.length >= n) return;
    const a = $(el).find('.result__a').first();
    const href = cleanHref(a.attr('href'));
    const title = a.text().trim();
    if (title && /^https?:/.test(href)) out.push({ title, href, snippet: $(el).find('.result__snippet').text().trim() });
  });
  return out;
}

async function ddgLite(query, n) {
  const r = await axios.post('https://lite.duckduckgo.com/lite/', new URLSearchParams({ q: query, kl: 'fr-fr' }).toString(), {
    headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 });
  const $ = cheerio.load(r.data);
  const out = [];
  $('a.result-link').each((_, el) => {
    if (out.length >= n) return;
    const href = cleanHref($(el).attr('href'));
    const title = $(el).text().trim();
    const snippet = $(el).closest('tr').next().find('.result-snippet').text().trim();
    if (title && /^https?:/.test(href)) out.push({ title, href, snippet });
  });
  return out;
}

async function bing(query, n) {
  const r = await axios.get('https://www.bing.com/search', {
    params: { q: query, setlang: 'fr', cc: 'fr' },
    headers: { ...UA, 'Accept-Language': 'fr-FR,fr;q=0.9' }, timeout: 20000 });
  const $ = cheerio.load(r.data);
  const out = [];
  $('li.b_algo').each((_, el) => {
    if (out.length >= n) return;
    const a = $(el).find('h2 a').first();
    const href = cleanHref(a.attr('href'));
    const title = a.text().trim();
    if (title && /^https?:/.test(href)) out.push({ title, href, snippet: $(el).find('.b_caption p, p').first().text().trim() });
  });
  return out;
}

// Recherche web : plusieurs moteurs en secours (un seul bloqué ne casse plus la commande)
async function ddg(query, n = 6) {
  let last;
  for (const fn of [ddgHtml, bing, ddgLite]) {
    try { const r = await fn(query, n); if (r.length) return r; } catch (e) { last = e; }
  }
  if (last) throw last;
  return [];
}

const reachable = async u => {
  const r = await axios.get(u, { headers: { ...UA, Range: 'bytes=0-1' }, timeout: 15000, validateStatus: s => s < 400, responseType: 'stream' });
  r.data.destroy();
  return true;
};


async function ytFind(q) {
  if (/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)/i.test(q)) {
    const id = (q.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/) || [])[1];
    if (id) { const v = await yts({ videoId: id }); if (v) return v; }
  }
  const r = await yts(q);
  const v = r.videos?.[0];
  if (!v) throw new Error('aucun résultat YouTube');
  return v;
}

const isYtPage = u => { try { return /(^|\.)(youtube\.com|youtu\.be)$/i.test(new URL(u).hostname); } catch { return false; } };

function ytApis(u, kind) {
  return kind === 'mp3' ? [
    `https://eliteprotech-apis.zone.id/ytdown?url=${u}&format=mp3`,
    `https://api.yupra.my.id/api/downloader/ytmp3?url=${u}`,
    `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${u}`,
    `https://apis-keith.vercel.app/download/dlmp3?url=${u}`,
    `https://api.siputzx.my.id/api/d/ytmp3?url=${u}`,
    `https://api.giftedtech.my.id/api/download/ytmp3?apikey=gifted&url=${u}`
  ] : [
    `https://eliteprotech-apis.zone.id/ytdown?url=${u}&format=mp4`,
    `https://api.yupra.my.id/api/downloader/ytmp4?url=${u}`,
    `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${u}`,
    `https://apis-keith.vercel.app/download/dlmp4?url=${u}`,
    `https://api.siputzx.my.id/api/d/ytmp4?url=${u}`,
    `https://api.giftedtech.my.id/api/download/ytmp4?apikey=gifted&url=${u}`
  ];
}

async function ytLink(url, kind) {
  const u = encodeURIComponent(url);
  return firstOk(ytApis(u, kind).map(a => async () => {
    const link = find.mediaUrl(await getJson(a));
    if (!link || isYtPage(link)) return null;
    await reachable(link);
    return link;
  }));
}

// Télécharge réellement le fichier (le bot l'envoie ensuite en buffer : plus fiable que l'envoi par URL)
async function ytBuffer(url, kind, maxMb = 64) {
  const u = encodeURIComponent(url);
  let last;
  for (const a of ytApis(u, kind)) {
    try {
      const link = find.mediaUrl(await getJson(a));
      if (!link || isYtPage(link)) continue;
      const buf = await getBuffer(link, { maxContentLength: maxMb * 1024 * 1024 });
      if (buf.length > 20 * 1024) return buf;
    } catch (e) { last = e; }
  }
  throw new Error(last ? `sources indisponibles (${last.message})` : 'aucune source de téléchargement disponible');
}

const info = v => `🎬 *${v.title}*\n👤 ${v.author?.name || '—'}\n⏱️ ${v.timestamp || '—'}  •  👁️ ${(v.views || 0).toLocaleString('fr-FR')}\n🔗 ${v.url}`;


const GOODNIGHT = [
  'Que ta nuit soit douce et tes rêves remplis de belles choses. 🌙✨',
  'Ferme les yeux, respire, demain sera une belle journée. 😴💫',
  'Les étoiles veillent sur toi cette nuit. Dors bien ! 🌟',
  'Repose-toi, tu as bien mérité cette nuit de paix. 🛌💙',
  'Bonne nuit ! Recharge tes batteries, demain on conquiert le monde. 🚀',
  'Que la lune éclaire tes rêves et que le sommeil te berce. 🌜'
];

const QUIZ = [
  ['Quelle est la capitale de la Guinée ?', ['Conakry', 'Dakar', 'Bamako', 'Freetown'], 0],
  ['Combien y a-t-il de continents ?', ['5', '6', '7', '8'], 2],
  ['Quel est le plus grand océan du monde ?', ['Atlantique', 'Pacifique', 'Indien', 'Arctique'], 1],
  ['Qui a peint la Joconde ?', ['Picasso', 'Van Gogh', 'Léonard de Vinci', 'Michel-Ange'], 2],
  ['Quel est le symbole chimique de l\'or ?', ['Ag', 'Au', 'Fe', 'Or'], 1],
  ['Quelle planète est la plus proche du Soleil ?', ['Vénus', 'Mars', 'Mercure', 'Terre'], 2],
  ['Combien de joueurs par équipe sur le terrain au football ?', ['9', '10', '11', '12'], 2],
  ['Quel pays a remporté la Coupe du monde 2018 ?', ['Croatie', 'France', 'Brésil', 'Allemagne'], 1],
  ['En quelle année a été fondée l\'ONU ?', ['1919', '1945', '1960', '1989'], 1],
  ['Quel langage sert à structurer une page web ?', ['Python', 'HTML', 'SQL', 'C++'], 1],
  ['Quel est le plus long fleuve d\'Afrique ?', ['Niger', 'Congo', 'Nil', 'Zambèze'], 2],
  ['Combien de côtés a un hexagone ?', ['5', '6', '7', '8'], 1],
  ['Quel animal est le plus rapide sur terre ?', ['Lion', 'Guépard', 'Cheval', 'Antilope'], 1],
  ['Que signifie « IA » ?', ['Internet Avancé', 'Intelligence Artificielle', 'Information Auto', 'Interface Active'], 1],
  ['Quel est le résultat de 12 × 12 ?', ['124', '132', '144', '164'], 2],
  ['Quel pays est surnommé « le pays du Soleil-Levant » ?', ['Chine', 'Corée', 'Japon', 'Thaïlande'], 2]
];

module.exports = { ddg, reachable, ytFind, ytLink, ytBuffer, info, pickMedia, own, viewOnce, quotedContent, assertDownloadable, sendPrivate, notifyPrivate, statusMedia, menuImage, banner, MEDIA, GOODNIGHT, QUIZ };
