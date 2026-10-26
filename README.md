# riftbound-card-data

**Every card & Every printing.**

Riftbound card data and image mappings from Riot's public English card gallery:
sets, collector codes, rarities, domains, rules text, stats, artists and printing
variants. Each record points to the image for that specific printing on Riot's CDN.

**Start with [`data/cards.json`](data/cards.json).** It is a ready-to-use snapshot.
No API key, account or npm dependencies are required to refresh it.

## Use the data

Clone or download this repository, then use the JSON directly. With Node.js 22+:

```sh
node examples/find-card.js "Iron Revenant"
node examples/find-card.js "RAD-143/167"
```

Look up an exact printing:

```js
const { cards } = require('./data/cards.json');
const standard = cards.find(card => card.public_code === 'RAD-143/167');
const overnumbered = cards.find(card => card.public_code === 'RAD-170/167');
console.log(standard?.image.url, overnumbered?.image.url);
```

For a browser app, serve a copy of `data/cards.json` alongside your app:

```js
const { cards } = await fetch('/data/cards.json').then(response => response.json());
const card = cards.find(card => card.public_code === 'RAD-143/167');
if (card) {
  const image = document.createElement('img');
  image.src = card.image.url;
  image.alt = card.image.alt;
  image.loading = 'lazy';
  image.width = 240;
  document.body.append(image);
}
```

`image.url` already contains the exact URL supplied by Riot; don't reconstruct it
from a card name. Image availability and use remain subject to Riot's policies.

## Refresh

```sh
npm test
npm run refresh
```

The refresh script paginates Riot's public card and set feeds, normalizes records,
and replaces the snapshot only after validation. It retries failed requests, pauses
between pages and rejects repeated pages, conflicting IDs, unexpectedly empty pages,
large count drops or disappearing sets. Existing data stays in place when a refresh
fails. These checks catch common failures, but cannot guarantee the upstream feed is
complete. Review the diff before committing a refreshed snapshot. If Riot intentionally
removes cards or sets, investigate the change before adjusting the safeguards.

Refresh manually when needed; there is no scheduled job or background polling.
The script fetches JSON only and does not download card images.

## Fields and printing identity

The top-level object has `schema_version`, `locale`, `fetched_at`, `source`, `total`,
`sets` and `cards`. `sets[].known_printings` is the number of records in this snapshot.
`collector_number_max` comes from Riot and is not a complete-printing count.

| Card field | Meaning |
| --- | --- |
| `id` | Gallery ID lowercased, with `-star-` normalized to `*-` |
| `gallery_id` | Original upstream gallery ID, unchanged |
| `public_code` | Printed set/collector code, including suffixes and signature markers; `null` if absent |
| `collector_number` | Upstream collector number; use the full code/ID to distinguish variants |
| `name`, `subtitle`, `display_name` | Name and subtitle from Riot; display name combines them |
| `set` | Set ID and name |
| `type`, `supertype`, `rarity`, `domains` | Card classification; unavailable scalar values are `null` |
| `attributes` | Energy, power and might; zero is preserved and unknown values are `null` |
| `text` | Upstream rich HTML and a basic plain-text conversion |
| `tags` | Upstream card tags |
| `printing` | Independent `alternate_art`, `signature`, `overnumbered` booleans |
| `image` | Exact CDN URL, dimensions, accessible description and artists |
| `orientation` | Upstream orientation, or `null` |

Match printings by `id` or the full set/collector code, **never just by name**.
Standard, alternate-art, overnumbered and signature cards remain separate records.
Flags can overlap: a signature can also be overnumbered. Flags are derived from the
gallery's IDs, codes, collector numbers and explicit flags; they are not a separate
official rarity classification. Special/token codes are preserved without inventing
missing cards. Different gallery IDs sharing a collector code remain separate;
an ambiguous lookup should be reviewed, not resolved by picking an arbitrary card.

Render plain text with `textContent`. `text.rich` is upstream HTML, not sanitized
markup; sanitize it before inserting it into your page. The plain-text conversion
is intentionally basic and retains game-specific icon notation.

## Sources and coverage

- [Riot's public card gallery](https://playriftbound.com/en-us/card-gallery/)
- [Card JSON feed](https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=en_US&from=0&limit=200)
- [Set JSON feed](https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_sets?locale=en_US&from=0&limit=200)
- Images currently reference Riot's `cmsassets.rgpub.io` CDN.

Coverage is **what the English gallery exposes at the snapshot time**, including
previews, tokens or special printings when present. It is not a promise of every
released card, promo, foil finish or language. No marketplace data or old app-only
records are merged in to fill gaps. See `fetched_at` and `sets` in the JSON for the
current snapshot. Riot can change this undocumented feed and its image URLs.

## Contributing

For a missing or mismatched printing, include its set, full collector code, gallery
ID and the relevant public gallery link. Avoid merging records merely because they
share a name. Run `npm test` and review the data diff before proposing changes.

## License and attribution

Original code and original documentation are MIT-licensed; **Riot-derived card
content and linked images are excluded**. See [LICENSE](LICENSE) and
[NOTICE.md](NOTICE.md) for the scope and third-party rights.

riftbound-card-data was created under Riot Games' "Legal Jibber Jabber" policy using
assets owned by Riot Games. Riot Games does not endorse or sponsor this project.
