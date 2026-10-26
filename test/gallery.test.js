'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeCard, buildCatalog, fetchRows, refresh } = require('../lib/gallery');

const sets = [{ id: 'OGN', name: 'Origins', collectorNumberMax: 298 }];
const fixture = (id = 'ogn-001-298', publicCode = 'OGN-001/298', collectorNumber = 1) => ({
    id, publicCode, collectorNumber, name: 'Example', subtitle: 'Champion',
    set: { value: { id: 'OGN', label: 'Origins' } },
    cardType: { type: [{ label: 'Unit' }], superType: [{ label: 'Champion' }] },
    cardImage: { url: `https://cmsassets.rgpub.io/${id}.png`, dimensions: { width: 744, height: 1039 } },
    text: { richText: { body: '<p>One<br />Two &amp; three</p><p>Four</p>' } },
    energy: { value: { id: 0 } }, power: { value: { id: 2 } }, tags: { tags: ['Example'] }
});
const response = payload => ({ ok: true, json: async () => payload });
const feed = rawCards => async url => {
    const data = url.includes('gallery_sets') ? sets : rawCards;
    const from = Number(new URL(url).searchParams.get('from'));
    return response({ data: data.slice(from, from + 200), metadata: { totalItems: data.length } });
};

test('normalization preserves zero values, subtitles, image mapping and source IDs', () => {
    const raw = fixture();
    raw.unrelated_private_field = 'must not be exported';
    const before = JSON.stringify(raw);
    const card = normalizeCard(raw);
    assert.equal(card.attributes.energy, 0);
    assert.equal(card.attributes.might, null);
    assert.equal(card.display_name, 'Example - Champion');
    assert.equal(card.supertype, 'Champion');
    assert.equal(card.image.url, raw.cardImage.url);
    assert.equal(card.gallery_id, raw.id);
    assert.equal(card.text.plain, 'One\nTwo & three\nFour');
    assert.ok(!JSON.stringify(card).includes('must not be exported'));
    assert.equal(JSON.stringify(raw), before);
});

test('same-name standard, alternate, overnumbered and signature printings keep separate images', () => {
    const raw = [fixture(), fixture('ogn-001a-298', 'OGN-001a/298'),
        fixture('ogn-299-298', 'OGN-299/298', 299), fixture('ogn-299-star-298', 'OGN-299*/298', 299)];
    const result = buildCatalog(raw, sets);
    assert.equal(result.total, 4);
    assert.equal(new Set(result.cards.map(card => card.image.url)).size, 4);
    assert.equal(result.cards.filter(card => card.printing.alternate_art).length, 1);
    const signature = result.cards.find(card => card.printing.signature);
    assert.equal(signature.id, 'ogn-299*-298');
    assert.equal(signature.gallery_id, 'ogn-299-star-298');
    assert.equal(signature.printing.overnumbered, true);
    assert.equal(result.cards.filter(card => card.printing.overnumbered).length, 2);
});

test('tokens, special codes and gallery-only sets survive without filling denominator gaps', () => {
    const token = fixture('unl-t04', 'UNL-T04', null);
    token.set = { value: { id: 'UNL', label: 'Unleashed' } };
    token.cardType = { superType: [{ label: 'Token' }] };
    const result = buildCatalog([token, fixture('ogn-sp1-006', 'OGN-SP1/006', 1)], sets);
    assert.equal(result.total, 2);
    const t = result.cards.find(card => card.id === 'unl-t04');
    assert.equal(t.supertype, 'Token'); assert.equal(t.type, null);
    assert.equal(t.public_code, 'UNL-T04');
    assert.equal(result.sets.find(set => set.id === 'UNL').collector_number_max, null);
});

test('duplicate source rows collapse, conflicting IDs fail, shared codes are not merged', () => {
    const raw = fixture();
    assert.equal(buildCatalog([raw, raw], sets).total, 1);
    assert.throws(() => buildCatalog([raw, { ...raw, name: 'Conflict' }], sets), /Conflicting/);
    assert.equal(buildCatalog([raw, { ...raw, id: 'different-source-record' }], sets).total, 2);
    assert.throws(() => normalizeCard({ ...raw, cardImage: { url: 'javascript:alert(1)' } }), /HTTPS/);
    assert.throws(() => normalizeCard({ ...raw, cardImage: {} }), /Incomplete/);
});

test('short visible pages do not truncate the feed', async () => {
    const offsets = [];
    const rows = await fetchRows('cards', { wait: async () => {}, fetcher: async url => {
        const from = Number(new URL(url).searchParams.get('from')); offsets.push(from);
        return response({ data: Array.from({ length: from === 0 ? 199 : 200 }, (_, i) => ({ id: `${from + i}` })), metadata: { totalItems: 400 } });
    } });
    assert.deepEqual(offsets, [0, 200]); assert.equal(rows.length, 399);
});

test('repeated pages, conflicting rows, early empty pages and changing totals fail', async () => {
    for (const scenario of ['repeat', 'conflict', 'empty', 'changed']) {
        await assert.rejects(fetchRows('cards', { wait: async () => {}, fetcher: async url => {
            const next = Number(new URL(url).searchParams.get('from')) > 0;
            return response({ data: next && scenario === 'empty' ? [] : [{ id: 'same', value: next && scenario === 'conflict' ? 2 : 1 }],
                metadata: { totalItems: next && scenario === 'changed' ? 600 : 400 } });
        } }), /repeated|Conflicting|empty|changed/);
    }
});

test('pagination without a total continues until an empty page', async () => {
    const offsets = [];
    const rows = await fetchRows('cards', { wait: async () => {}, fetcher: async url => {
        const from = Number(new URL(url).searchParams.get('from')); offsets.push(from);
        return response({ data: from ? [] : [{ id: 'one' }] });
    } });
    assert.equal(rows.length, 1); assert.deepEqual(offsets, [0, 200]);
});

test('HTTP failure is retried before a successful response', async () => {
    let attempts = 0;
    const rows = await fetchRows('cards', { fetcher: async () => ++attempts === 1 ?
        { ok: false, status: 503 } : response({ data: [{ id: 'one' }], metadata: { totalItems: 1 } }) });
    assert.equal(attempts, 2); assert.equal(rows.length, 1);
});

test('failed refreshes preserve the previous file; a valid refresh replaces it', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'riftbound-card-data-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const output = path.join(directory, 'cards.json');
    const rawCards = Array.from({ length: 110 }, (_, i) => fixture(`ogn-${i + 1}-298`, `OGN-${i + 1}/298`, i + 1));
    const initial = JSON.stringify(buildCatalog(rawCards, sets));
    await fs.writeFile(output, initial);
    await assert.rejects(refresh(output, { fetcher: feed(rawCards.slice(0, 100)) }), /small/);
    assert.equal(await fs.readFile(output, 'utf8'), initial);
    await assert.rejects(refresh(output, { fetcher: async () => response({ data: null }) }), /Malformed/);
    assert.equal(await fs.readFile(output, 'utf8'), initial);
    const missingSet = JSON.stringify({ ...JSON.parse(initial), sets: [...sets.map(s => ({ id: s.id })), { id: 'PR' }] });
    await fs.writeFile(output, missingSet);
    await assert.rejects(refresh(output, { fetcher: feed(rawCards) }), /Sets disappeared/);
    assert.equal(await fs.readFile(output, 'utf8'), missingSet);
    await fs.writeFile(output, initial);
    rawCards[0].name = 'Updated';
    await refresh(output, { fetcher: feed(rawCards) });
    const saved = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(saved.cards.find(card => card.id === 'ogn-1-298').name, 'Updated');
    assert.deepEqual(await fs.readdir(directory), ['cards.json']);
});

test('bundled snapshot has unique IDs, consistent counts and only expected public card fields', () => {
    const snapshot = require('../data/cards.json');
    assert.equal(snapshot.schema_version, 1);
    assert.equal(snapshot.total, snapshot.cards.length);
    assert.equal(new Set(snapshot.cards.map(card => card.id)).size, snapshot.total);
    assert.equal(snapshot.sets.reduce((sum, set) => sum + set.known_printings, 0), snapshot.total);
    const allowed = Object.keys(normalizeCard(fixture())).sort();
    for (const card of snapshot.cards) {
        assert.deepEqual(Object.keys(card).sort(), allowed);
        assert.equal(new URL(card.image.url).protocol, 'https:');
        assert.ok(snapshot.sets.some(set => set.id === card.set.id));
    }
    const iron = snapshot.cards.filter(card => card.name === 'Iron Revenant');
    assert.ok(iron.some(card => card.public_code === 'RAD-143/167' && !card.printing.overnumbered));
    assert.ok(iron.some(card => card.public_code === 'RAD-170/167' && card.printing.overnumbered));
});
