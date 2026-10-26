'use strict';
const catalog = require('../data/cards.json');
const query = process.argv.slice(2).join(' ') || 'Iron Revenant';
const found = catalog.cards.filter(card => card.id === query.toLowerCase() ||
    card.public_code?.toLowerCase() === query.toLowerCase() || card.display_name.toLowerCase().includes(query.toLowerCase()));
console.log(JSON.stringify(found.map(card => ({ id: card.id, code: card.public_code,
    name: card.display_name, printing: card.printing, image: card.image.url })), null, 2));
if (!found.length) process.exitCode = 1;
