// Quand un message arrive « sans contenu » (souvent une vue unique), on demande tout de suite au
// téléphone principal de le renvoyer : le contenu arrive alors dans le cache du bot.
const asked = new Set();

function auto(s, msg) {
  try {
    const from = msg.key?.remoteJid;
    if (!from || msg.key.fromMe || msg.messageStubType !== 2) return;
    if (from === 'status@broadcast' || from.endsWith('@newsletter') || from.endsWith('@broadcast')) return;
    if (typeof s.sock?.requestPlaceholderResend !== 'function') return;
    if (asked.has(msg.key.id)) return;
    asked.add(msg.key.id);
    if (asked.size > 300) asked.delete(asked.values().next().value);
    setTimeout(() => {
      s.sock.requestPlaceholderResend(msg.key).catch(e => console.error(`[${s.id}] resend:`, e.message));
    }, 1500);
  } catch (e) {
    console.error(`[${s.id}] resend:`, e.message);
  }
}

module.exports = { auto };
