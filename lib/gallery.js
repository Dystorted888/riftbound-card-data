'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const GALLERY = 'https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/';
const LOCALE = 'en_US';
const PAGE_SIZE = 200;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(url, fetcher = fetch) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetcher(url, {
                signal: AbortSignal.timeout(20000),
                headers: { Accept: 'application/json', 'User-Agent': 'riftbound-card-data/1.0' }
            });
            if (!response.ok) throw new Error(`Gallery returned HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            if (attempt === 2) throw error;
            await pause(500 * (attempt + 1));
        }
    }
}

async function fetchRows(kind, { fetcher = fetch, wait = pause } = {}) {
    const rows = new Map();
    let expectedTotal;
    for (let from = 0; from < 20000; from += PAGE_SIZE) {
        const payload = await getJson(`${GALLERY}${kind}?locale=${LOCALE}&from=${from}&limit=${PAGE_SIZE}`, fetcher);
        if (!Array.isArray(payload.data)) throw new Error('Malformed gallery page');
        const total = payload.metadata?.totalItems;
        if (Number.isInteger(total) && total >= 0) {
            if (expectedTotal !== undefined && expectedTotal !== total) throw new Error('Gallery changed during pagination; retry later');
            expectedTotal = total;
        }
        if (!payload.data.length) {
            if (expectedTotal !== undefined && from < expectedTotal) throw new Error('Unexpected empty gallery page');
            return [...rows.values()];
        }
        let added = 0;
        for (const row of payload.data) {
            if (typeof row.id !== 'string' || !row.id) throw new Error('Gallery record has no ID');
            if (rows.has(row.id) && JSON.stringify(rows.get(row.id)) !== JSON.stringify(row)) throw new Error(`Conflicting gallery records for ${row.id}`);
            if (!rows.has(row.id)) added++;
            rows.set(row.id, row);
        }
        if (!added) throw new Error('Gallery pagination repeated a page');
        // A CMS window can contain fewer visible rows than its advertised size.
        // A short page is NOT an end-of-feed signal.
        if (expectedTotal !== undefined && from + PAGE_SIZE >= expectedTotal) return [...rows.values()];
        await wait(250);
    }
    throw new Error('Gallery exceeded the pagination safety limit');
}

function plainText(html) {
    return String(html || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n')
        .replace(/<[^>]*>/g, '').replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, entity => ({
            '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'"
        })[entity]);
}

function normalizeCard(raw) {
    if (!raw.id || !raw.name || !raw.set?.value?.id || !raw.cardImage?.url) throw new Error(`Incomplete gallery card: ${raw.id || '(unknown)'}`);
    const image = new URL(raw.cardImage.url);
    if (image.protocol !== 'https:') throw new Error(`Non-HTTPS image URL: ${raw.id}`);
    const id = raw.id.toLowerCase().replace(/-star-/g, '*-');
    const publicCode = raw.publicCode || null;
    const code = String(publicCode || id).toUpperCase();
    const flags = (raw.flags || []).map(flag => String(flag.id).toLowerCase());
    const alternate = /\d+A(?:\/|-|$)/.test(code) || /\d+a(?:-|$)/.test(id) || flags.some(flag => /alternate/.test(flag));
    const signature = id.includes('*') || code.includes('*') || flags.includes('signature');
    const denominator = publicCode ? Number(publicCode.split('/')[1]) : NaN;
    const overnumbered = (Number.isFinite(denominator) && Number(raw.collectorNumber) > denominator) || flags.includes('overnumbered');
    const subtitle = typeof raw.subtitle === 'string' ? raw.subtitle : raw.subtitle?.value?.label || raw.subtitle?.label || null;
    const rich = raw.text?.richText?.body || raw.effect?.richText?.body || '';
    const stat = key => {
        const value = raw[key]?.value?.id;
        return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
    };
    return {
        id, gallery_id: raw.id, public_code: publicCode, collector_number: raw.collectorNumber ?? null,
        name: raw.name, subtitle, display_name: `${raw.name}${subtitle ? ` - ${subtitle}` : ''}`,
        set: { id: raw.set.value.id.toUpperCase(), name: raw.set.value.label || raw.set.value.id },
        type: raw.cardType?.type?.[0]?.label || null, supertype: raw.cardType?.superType?.[0]?.label || null,
        rarity: raw.rarity?.value?.label || null, domains: (raw.domain?.values || []).map(domain => domain.label),
        attributes: { energy: stat('energy'), power: stat('power'), might: stat('might') },
        text: { plain: plainText(rich), rich }, tags: raw.tags?.tags || [],
        printing: { alternate_art: alternate, signature, overnumbered },
        image: { url: image.href, width: raw.cardImage.dimensions?.width ?? null,
            height: raw.cardImage.dimensions?.height ?? null, alt: raw.cardImage.accessibilityText || raw.name,
            artists: (raw.illustrator?.values || []).map(artist => artist.label) },
        orientation: raw.orientation || null
    };
}

function buildCatalog(rawCards, rawSets, fetchedAt = new Date().toISOString()) {
    if (!rawCards.length || !rawSets.length) throw new Error('Empty gallery snapshot');
    const cards = new Map();
    for (const raw of rawCards) {
        const card = normalizeCard(raw);
        if (cards.has(card.id) && JSON.stringify(cards.get(card.id)) !== JSON.stringify(card)) throw new Error(`Conflicting printing ID: ${card.id}`);
        cards.set(card.id, card);
    }
    const sets = new Map(rawSets.map(set => {
        if (!set.id || !set.name) throw new Error('Incomplete gallery set');
        return [set.id.toUpperCase(), { id: set.id.toUpperCase(), name: set.name, collector_number_max: set.collectorNumberMax ?? null }];
    }));
    for (const card of cards.values()) {
        if (!sets.has(card.set.id)) sets.set(card.set.id, { ...card.set, collector_number_max: null });
    }
    const items = [...cards.values()].sort((a, b) => a.set.id.localeCompare(b.set.id) ||
        String(a.public_code || a.id).localeCompare(String(b.public_code || b.id), 'en', { numeric: true }) || a.id.localeCompare(b.id));
    return {
        schema_version: 1, locale: LOCALE, fetched_at: fetchedAt,
        source: { name: 'Riot public card gallery', page: 'https://playriftbound.com/en-us/card-gallery/',
            cards: `${GALLERY}riftbound_gallery_cards`, sets: `${GALLERY}riftbound_gallery_sets` },
        total: items.length,
        sets: [...sets.values()].sort((a, b) => a.id.localeCompare(b.id)).map(set => ({ ...set, known_printings: items.filter(card => card.set.id === set.id).length })),
        cards: items
    };
}

async function refresh(output, options = {}) {
    let previous;
    try { previous = JSON.parse(await fs.readFile(output, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const rawCards = await fetchRows('riftbound_gallery_cards', options);
    const rawSets = await fetchRows('riftbound_gallery_sets', options);
    const catalog = buildCatalog(rawCards, rawSets);
    if (catalog.total < Math.max(100, (previous?.total || 0) * 0.95)) throw new Error('Snapshot is unexpectedly small; existing data was not replaced');
    const missingSets = (previous?.sets || []).filter(old => !catalog.sets.some(set => set.id === old.id));
    if (missingSets.length) throw new Error(`Sets disappeared (${missingSets.map(set => set.id).join(', ')}); existing data was not replaced`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    const temp = `${output}.${process.pid}.tmp`;
    try {
        await fs.writeFile(temp, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
        await fs.rename(temp, output);
    } finally { await fs.rm(temp, { force: true }); }
    return catalog;
}

module.exports = { GALLERY, fetchRows, normalizeCard, buildCatalog, refresh };
