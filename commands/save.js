const { add } = require('../core/registry');
const { save } = require('../lib/vo');

add({ name: 'save', cat: 'editing', desc: 'sauvegarder un média', run: save });
