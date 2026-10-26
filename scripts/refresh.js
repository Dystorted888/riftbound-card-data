'use strict';
const path = require('node:path');
const { refresh } = require('../lib/gallery');
refresh(path.join(__dirname, '..', 'data', 'cards.json'))
    .then(catalog => console.log(`Saved ${catalog.total} printings across ${catalog.sets.length} sets (${catalog.fetched_at}).`))
    .catch(error => { console.error(`Refresh failed: ${error.message}`); process.exitCode = 1; });
