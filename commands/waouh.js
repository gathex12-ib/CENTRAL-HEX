const { add } = require('../core/registry');
const { viewOnce } = require('../lib/vo');

// Silencieux comme « humm » : pas de réaction, pas de message de confirmation.
// Le média est envoyé directement dans ta discussion privée.
add({ name: 'waouh', cat: 'editing', desc: 'capturer un média vue unique', silent: true, run: ctx => viewOnce(ctx, true) });
