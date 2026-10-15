---
type: draft
status: AWAITING OWNER CONFIRMATION (nothing stored in BigQuery or ref tables)
created: 2026-10-15
source: Ahrefs Keywords Explorer (12-month average monthly volume, pulled 2026-10-15), repo client folders, stg.stg_shopify_orders (read only, L12M orders by country)
feeds: SPEC.md section 3.9 Scouting, opportunity index (search demand column)
---

# Markets / Scouting: head search terms per client and market (DRAFT)

**What this is.** Category head terms (no brand names) per client, in the local language of each market, meant to carry the same buying intent in every country so search demand is comparable. Core terms (2 to 3 per client) feed the opportunity index; non-core terms are context or were dropped with a reason. The owner confirms or edits this list before anything is written to `ref`.

**Method.**
- Product facts come from the repo only: `_clients/dobias` (product names GutSense, FeelGood Omega, SoulFood, Joint, multivitamin appear across copy), `_clients/rawbark/research/voc-2026-10-04/firstparty-facts.md`, `_clients/manami/brain_manami.md`, `_clients/ethia/research/voc-2026-10-03/00-SYNTHESIS.md`, `_clients/venev/products/_index.md` + `VEN-MASK-SET.md`.
- One Ahrefs `keywords-explorer-overview` call per country with all clients' terms for that country (about 2,300 API units in total, Lite plan has 200k/month).
- Rule for spelling and phrasing variants: each intent uses the **strongest local phrasing checked** in that country (for example `vitamin c serum` without diacritics in CZ and SK, `akné krém` in SK). Variants are listed in the note column, not summed, so countries where more variants were tested are not favoured.
- Ahrefs rounds small volumes into buckets (0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150 ...). `0` = below the threshold, `n/a` = Ahrefs has no record of the term in that country.
- Dobias scouting list was extended with what organic orders show (stg.stg_shopify_orders, last 365 days, shipping country outside US/CA): GB 99, AU 72, SG 38, RS 32, IE 17, CH 14, HK 13, NZ 12, NO 9, FR 8; DE only 3. SG and NZ were added; HK, NO, FR were not checked (owner call).

## Core terms at a glance

| Client | Core intent 1 | Core intent 2 | Core intent 3 |
|---|---|---|---|
| dobias | probiotics for dogs | dog supplements | joint supplements for dogs |
| rawbark | dry dog food (`granule pro psy`) | dog food (`krmivo pro psy`) | none (BARF kept as context only) |
| manami | natural perfume | perfume oil | none (`alcohol-free perfume` dropped, near zero everywhere) |
| ethia | acne cream | acne serum | acne skincare / cosmetics |
| venev | face mask | vitamin C serum | face sunscreen / SPF face cream |

## Core demand per country (sum of core-term volume, monthly)

| Client | Home / sold markets | Candidates |
|---|---|---|
| dobias | US 38,600 · CA 3,200 | GB 14,200 · AU 5,200 · DE 4,900 · NZ 700 · IE 630 · SG 420 · CH 320 · RS 300 (2 of 3 terms, joint term has no data) |
| rawbark | CZ 9,200 · SK 5,900 | PL 42,000 · DE 26,300 · HU 3,650 · AT 2,450 |
| manami | CZ 350 · SK 20 | PL 1,250 · DE 1,250 · HU 500 · AT 190 |
| ethia | CZ 1,250 | PL 3,000 · DE 2,690 · SK 730 · HU 480 · AT 220 |
| venev | SK 950 · CZ 2,250 | DE 39,500 · PL 15,200 · AT 2,700 · HU 2,250 |

## Dobias (Dr. Dobias Natural Pet Health): natural dog supplements, sells US + CA

Terms mirror the supplement lines named in the repo (probiotic, omega, joint, multivitamin). `probiotics for dogs` alone is 73 % of the US core sum, so the index for Dobias is mostly a probiotic-demand index (see doubts).

| Term | Lang | Country | Core | Ahrefs vol/mo | Note |
|---|---|---|---|---|---|
| probiotics for dogs | en | US | yes | 28,000 | sold market (baseline) |
| dog supplements | en | US | yes | 4,100 | sold market (baseline) |
| joint supplements for dogs | en | US | yes | 6,500 | sold market (baseline); singular 'joint supplement for dogs' adds 1,800 |
| omega 3 for dogs | en | US | no | 6,000 | US also: fish oil for dogs 14,000 |
| dog multivitamin | en | US | no | 3,500 |  |
| dog vitamins | en | US | no | 6,900 |  |
| natural dog supplements | en | US | no | 250 | dropped: near zero outside US/GB/AU |
| probiotics for dogs | en | CA | yes | 2,600 | sold market (baseline) |
| dog supplements | en | CA | yes | 350 | sold market (baseline) |
| joint supplements for dogs | en | CA | yes | 250 | sold market (baseline) |
| omega 3 for dogs | en | CA | no | 1,000 |  |
| dog multivitamin | en | CA | no | 150 |  |
| dog vitamins | en | CA | no | 250 |  |
| natural dog supplements | en | CA | no | 10 | dropped: near zero outside US/GB/AU |
| probiotics for dogs | en | GB | yes | 9,800 |  |
| dog supplements | en | GB | yes | 1,700 |  |
| joint supplements for dogs | en | GB | yes | 2,700 |  |
| omega 3 for dogs | en | GB | no | 1,500 |  |
| dog multivitamin | en | GB | no | 300 |  |
| dog vitamins | en | GB | no | 1,000 |  |
| natural dog supplements | en | GB | no | 200 | dropped: near zero outside US/GB/AU |
| probiotics for dogs | en | IE | yes | 450 |  |
| dog supplements | en | IE | yes | 80 |  |
| joint supplements for dogs | en | IE | yes | 100 |  |
| omega 3 for dogs | en | IE | no | 90 |  |
| dog multivitamin | en | IE | no | 20 |  |
| dog vitamins | en | IE | no | 30 |  |
| natural dog supplements | en | IE | no | 0 | dropped: near zero outside US/GB/AU |
| probiotics for dogs | en | AU | yes | 4,000 |  |
| dog supplements | en | AU | yes | 900 |  |
| joint supplements for dogs | en | AU | yes | 300 |  |
| omega 3 for dogs | en | AU | no | 700 |  |
| dog multivitamin | en | AU | no | 250 |  |
| dog vitamins | en | AU | no | 500 |  |
| natural dog supplements | en | AU | no | 100 | dropped: near zero outside US/GB/AU |
| probiotics for dogs | en | NZ | yes | 350 |  |
| dog supplements | en | NZ | yes | 200 |  |
| joint supplements for dogs | en | NZ | yes | 150 |  |
| omega 3 for dogs | en | NZ | no | 150 |  |
| dog multivitamin | en | NZ | no | 30 |  |
| dog vitamins | en | NZ | no | 90 |  |
| natural dog supplements | en | NZ | no | 20 | dropped: near zero outside US/GB/AU |
| probiotics for dogs | en | SG | yes | 250 |  |
| dog supplements | en | SG | yes | 150 |  |
| joint supplements for dogs | en | SG | yes | 20 |  |
| omega 3 for dogs | en | SG | no | 30 |  |
| dog multivitamin | en | SG | no | 20 |  |
| dog vitamins | en | SG | no | 40 |  |
| natural dog supplements | en | SG | no | 0 | dropped: near zero outside US/GB/AU |
| liver detox for dogs | en | US | no | 100 | dropped: 100 even in US; too niche for a head term |
| probiotika hund | de | DE | yes | 3,800 |  |
| nahrungsergänzungsmittel hund | de | DE | yes | 500 | variant 'nahrungsergänzung hund' = 300 |
| gelenktabletten hund | de | DE | yes | 600 |  |
| omega 3 hund | de | DE | no | 500 |  |
| vitamine hund | de | DE | no | 350 |  |
| probiotika hund | de | CH | yes | 200 |  |
| nahrungsergänzungsmittel hund | de | CH | yes | 90 | used 'nahrungsergänzung hund' (90 > 80 for the -mittel form) |
| gelenktabletten hund | de | CH | yes | 30 |  |
| omega 3 hund | de | CH | no | 100 |  |
| vitamine hund | de | CH | no | 50 |  |
| probiotiques chien | fr | CH | no | 20 | French CH check: near zero, German terms carry CH |
| complément alimentaire chien | fr | CH | no | 10 | French CH check: near zero |
| probiotik za pse | sr | RS | yes | 200 |  |
| suplementi za pse | sr | RS | yes | 100 | 'dodaci ishrani za pse' = 0 |
| preparati za zglobove za pse | sr | RS | yes | n/a | no Ahrefs data; replace or drop (owner) |
| vitamini za pse | sr | RS | no | 250 | candidate to replace the joint term in RS |
| omega 3 za pse | sr | RS | no | 20 |  |
| probiotics for dogs | en | RS | no | 0 | English check: 0, Serbian terms needed |

Core sum per country: US 38,600, CA 3,200, GB 14,200, IE 630, AU 5,200, NZ 700, SG 420, DE 4,900, CH 320, RS 300

## RawBark: made-to-measure kibble from fresh meat, sells CZ + SK

Repo correction: the brief said raw food (BARF), but `firstparty-facts.md` quotes the live site as "Granule na míru / z čerstvého masa" (made-to-measure kibble from fresh meat). Core terms are therefore dry dog food + dog food. `barf` volume is shown for context only. Note that `granule pro psy` is the generic dog-food head in Czech, while in PL/DE/HU the generic term (`karma dla psa`, `hundefutter`, `kutyatáp`) is larger than the dry-food term, so the pair (dry + generic) is the comparable unit, not either term alone.

| Term | Lang | Country | Core | Ahrefs vol/mo | Note |
|---|---|---|---|---|---|
| granule pro psy | cs | CZ | yes | 8,100 | sold market (baseline) |
| krmivo pro psy | cs | CZ | yes | 1,100 | sold market (baseline) |
| barf | cs | CZ | no | 1,600 | not core: RawBark sells kibble, not raw (see doubts); keep as context |
| granule na míru | cs | CZ | no | 30 | dropped: 'custom kibble' is near zero in every market |
| hypoalergenní granule pro psy | cs | CZ | no | 1,400 | non-core, strong in CZ; not checked abroad |
| granule pre psov | sk | SK | yes | 4,900 | sold market (baseline) |
| krmivo pre psov | sk | SK | yes | 1,000 | sold market (baseline) |
| barf | sk | SK | no | 900 | not core: RawBark sells kibble, not raw (see doubts); keep as context |
| granuly pre psov | sk | SK | no | 40 | spelling variant, near zero |
| sucha karma dla psa | pl | PL | yes | 6,000 |  |
| karma dla psa | pl | PL | yes | 36,000 |  |
| barf | pl | PL | no | 3,900 | not core: RawBark sells kibble, not raw (see doubts); keep as context |
| karma dla psa na zamówienie | pl | PL | no | 0 | dropped: 'custom kibble' is near zero in every market |
| trockenfutter hund | de | DE | yes | 8,300 |  |
| hundefutter | de | DE | yes | 18,000 |  |
| barf | de | DE | no | 8,100 | not core: RawBark sells kibble, not raw (see doubts); keep as context |
| hundefutter individuell | de | DE | no | 80 | dropped: 'custom kibble' is near zero in every market |
| trockenfutter hund | de | AT | yes | 450 |  |
| hundefutter | de | AT | yes | 2,000 |  |
| barf | de | AT | no | 500 | not core: RawBark sells kibble, not raw (see doubts); keep as context |
| hundefutter individuell | de | AT | no | 10 | dropped: 'custom kibble' is near zero in every market |
| száraz kutyatáp | hu | HU | yes | 450 |  |
| kutyatáp | hu | HU | yes | 3,200 |  |
| barf | hu | HU | no | 2,200 | not core: RawBark sells kibble, not raw (see doubts); keep as context |

Core sum per country: CZ 9,200, SK 5,900, PL 42,000, DE 26,300, AT 2,450, HU 3,650

## Manami: natural, alcohol-free perfumery, sells CZ + SK

Perfumes without alcohol, aromatherapy roll-ons, face oils, hydrosols, bath salts (brain_manami.md). Alcohol-free wording has near-zero search in every market, so it stays a USP, not a demand term.

| Term | Lang | Country | Core | Ahrefs vol/mo | Note |
|---|---|---|---|---|---|
| přírodní parfém | cs | CZ | yes | 200 | also 'přírodní parfémy' 150; sold market |
| olejový parfém | cs | CZ | yes | 150 | also 'parfémový olej' 90; sold market |
| parfém bez alkoholu | cs | CZ | no | 10 | dropped from core: near zero; keep as USP wording |
| aromaterapie | cs | CZ | no | 1,300 | broad, informational; roll-ons only, not core |
| prírodný parfém | sk | SK | yes | 0 | sold market; Ahrefs SK shows no demand (see doubts) |
| olejový parfém | sk | SK | yes | 20 | Czech spelling; Slovak 'olejový parfum' = 0 |
| parfum bez alkoholu | sk | SK | no | n/a | no data; 'parfém bez alkoholu' = 0 |
| naturalne perfumy | pl | PL | yes | 350 | 'perfumy naturalne' 150 |
| perfumy w olejku | pl | PL | yes | 900 | risk: much of this is dupe/inspired-by oils; 'perfumy olejkowe' 30 |
| perfumy bez alkoholu | pl | PL | no | 50 | dropped from core |
| natürliches parfum | de | DE | yes | 250 | 'naturparfum' 100, 'natürliche parfums' 150 |
| parfümöl | de | DE | yes | 1,000 | risk: includes Arabian/dupe oils |
| parfum ohne alkohol | de | DE | no | 100 | dropped from core |
| naturparfum | de | AT | yes | 40 | 'natürliches parfum' 30 |
| parfümöl | de | AT | yes | 150 |  |
| parfum ohne alkohol | de | AT | no | 10 | dropped from core |
| természetes parfüm | hu | HU | yes | 100 |  |
| parfümolaj | hu | HU | yes | 400 |  |
| alkoholmentes parfüm | hu | HU | no | 10 | dropped from core |

Core sum per country: CZ 350, SK 20, PL 1,250, DE 1,250, AT 190, HU 500

## Ethia: acne skincare (not anti-wrinkle), sells CZ

Customer voice is adult and hormonal acne (VoC synthesis, H2); entry product is the niacinamide serum. Core terms are the acne-care category, not ingredients.

| Term | Lang | Country | Core | Ahrefs vol/mo | Note |
|---|---|---|---|---|---|
| krém na akné | cs | CZ | yes | 800 | sold market; 'akné krém' 60 |
| sérum na akné | cs | CZ | yes | 250 |  |
| kosmetika na akné | cs | CZ | yes | 200 |  |
| akné v dospělosti | cs | CZ | no | 150 | persona P1 wording, informational |
| problematická pleť | cs | CZ | no | 100 |  |
| niacinamid sérum | cs | CZ | no | 80 | entry product ingredient, not a category head |
| akné krém | sk | SK | yes | 500 | strongest SK form; 'krém na akné' 250, 'krém na akne' 100 |
| sérum na akné | sk | SK | yes | 30 | near zero but kept for symmetry |
| kozmetika na akné | sk | SK | yes | 200 |  |
| krem na trądzik | pl | PL | yes | 2,300 |  |
| serum na trądzik | pl | PL | yes | 350 |  |
| kosmetyki do cery trądzikowej | pl | PL | yes | 350 |  |
| akne creme | de | DE | yes | 2,400 | 'creme gegen pickel' 1,000; risk: includes OTC medical creams |
| serum gegen pickel | de | DE | yes | 200 |  |
| pflege unreine haut | de | DE | yes | 90 | 'unreine Haut' is the cosmetic framing in German |
| akne creme | de | AT | yes | 200 | 'creme gegen pickel' 150 |
| serum gegen pickel | de | AT | yes | 10 | near zero |
| pflege unreine haut | de | AT | yes | 10 | near zero |
| pattanás elleni krém | hu | HU | yes | 400 |  |
| pattanás elleni szérum | hu | HU | yes | 60 |  |
| aknés bőr ápolása | hu | HU | yes | 20 | near zero |

Core sum per country: CZ 1,250, SK 730, PL 3,000, DE 2,690, AT 220, HU 480

## Venev: skincare (magnetic mask set, Blue Light SPF 50 cream, vitamin C serum), sells SK + CZ

The hero product (magnetic mask set, 68 % of lifetime revenue) has close to zero search in every market, including home markets, and `blue light` cream is 0. Core terms are the three category heads the products sit in. Repo note: `brain_venev.md` says SK is 87 % of revenue and CZ 3.3 %, so SK is the main sold market, not CZ.

| Term | Lang | Country | Core | Ahrefs vol/mo | Note |
|---|---|---|---|---|---|
| pleťová maska | cs | CZ | yes | 400 | sold market; 'pleťové masky' 150 |
| vitamin c serum | cs | CZ | yes | 1,400 | unaccented form; 'vitamin c sérum' only 150 |
| opalovací krém na obličej | cs | CZ | yes | 450 | 'krém s spf' 200 |
| magnetická maska | cs | CZ | no | 10 | hero product, but ~0 search: dropped as head term |
| krém proti modrému světlu | cs | CZ | no | 0 | dropped: 0 |
| pleťová maska | sk | SK | yes | 150 | sold market (87 % of revenue per brain_venev) |
| vitamin c serum | sk | SK | yes | 700 | unaccented; 'vitamín c sérum' 50 |
| opaľovací krém na tvár | sk | SK | yes | 100 | 'krém s spf' 70, 'krém na tvár s spf' 50 |
| magnetická maska | sk | SK | no | 0 | dropped: 0 |
| krém proti modrému svetlu | sk | SK | no | n/a | no data |
| maseczka do twarzy | pl | PL | yes | 1,000 |  |
| serum z witaminą c | pl | PL | yes | 13,000 | 'serum witamina c' 1,900 |
| krem z filtrem do twarzy | pl | PL | yes | 1,200 | 'krem z filtrem spf 50 do twarzy' 350 |
| maska magnetyczna | pl | PL | no | 10 | dropped: ~0 |
| gesichtsmaske | de | DE | yes | 8,500 |  |
| vitamin c serum | de | DE | yes | 18,000 |  |
| sonnencreme gesicht | de | DE | yes | 13,000 | seasonal; 'gesichtscreme mit lsf' 800 |
| magnetmaske | de | DE | no | 10 | dropped: ~0 |
| gesichtsmaske | de | AT | yes | 800 |  |
| vitamin c serum | de | AT | yes | 1,200 |  |
| sonnencreme gesicht | de | AT | yes | 700 | 'gesichtscreme mit lsf' 20 |
| magnetmaske | de | AT | no | 0 | dropped: 0 |
| arcmaszk | hu | HU | yes | 1,300 |  |
| c vitamin szérum | hu | HU | yes | 600 | 'c-vitamin szérum' 60 |
| fényvédő arckrém | hu | HU | yes | 350 | 'arckrém spf' 0 |
| mágneses arcmaszk | hu | HU | no | 0 | dropped: 0 |

Core sum per country: CZ 2,250, SK 950, PL 15,200, DE 39,500, AT 2,700, HU 2,250

## How the index uses this

1. **Demand score per client x country** = sum of monthly Ahrefs volume of the client's **core** terms in that country (strongest local phrasing per intent, one term per intent). Non-core rows are never summed.
2. **Relative to home** (recommended for display): divide by the same sum in the client's main sold market (Dobias US, RawBark CZ, Manami CZ, Ethia CZ, Venev SK). Example: RawBark PL 42,000 / CZ 9,200 = 4.6x home demand. This removes most of the "how broad is the head term" bias between clients.
3. **Per 100k internet users (optional)**: divide the demand score by internet users / 100,000 to compare density rather than size. Needs a population or internet-user source (World Bank / ITU) loaded into `ref`; not filled here, no numbers invented.
4. The search score is one column of the opportunity index next to GA4 sessions + unpaid share, organic orders, Meta audience size and `ref.industry_benchmarks` (SPEC 3.9). It signals "worth a test", never a verdict.
5. Refresh: re-pull volumes quarterly (Ahrefs volume is a 12-month average, so seasonality is smoothed; face sunscreen is strongly seasonal).

## Doubts for the owner to resolve

1. **RawBark is kibble, not BARF.** Confirm core = dry dog food + dog food. If the owner wants a "premium / fresh-meat kibble" niche term instead, every candidate tested (`granule na míru`, `karma dla psa na zamówienie`, `hundefutter individuell`) is near zero.
2. **Venev hero has no search demand.** Index on category heads (face mask, vitamin C serum, face sunscreen), or weight intents by revenue share (mask 68 %)? Vitamin C serum dominates DE and PL sums.
3. **Dobias index is mostly probiotics** (73 % of US core). Accept, cap any single term at 50 %, or swap `dog supplements` for `dog vitamins` (larger in the US, 6,900)?
4. **Dobias RS**: the joint term has no Ahrefs data. Replace with `vitamini za pse` (250) or run RS on two terms? Also check HK, NO, FR (organic orders 13, 9, 8)?
5. **Manami SK and Venev SK search** come out at near zero for niche terms; Slovak shoppers likely search in Czech or buy via .cz. Treat SK search demand as unreliable for niche categories.
6. **Intent contamination**: `parfümöl` / `perfumy w olejku` include dupe perfume oils, `akne creme` includes OTC medical creams, `sonnencreme gesicht` is seasonal. Keep, or replace with narrower terms at lower volume?
7. **Ethia SK/AT serum terms** are 10 to 30. Keep for symmetry (current draft) or run SK/AT on cream + skincare only?
