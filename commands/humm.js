const { add } = require('../core/registry');
const { viewOnce } = require('../lib/vo');

add({ name: 'humm', cat: 'editing', desc: 'capturer un média vue unique', silent: true, run: ctx => viewOnce(ctx, true) });
