# 23 — FX rates: monthly refresh

`ref.fx_rates` is hand-fed. It holds one row per `(month_start, from_currency,
to_currency)` and drives two things:

| Consumer | Pair | What breaks without it |
|---|---|---|
| `stg.stg_shopify_orders` | shop currency → client currency (CAD→USD for the migrated Canadian store) | Those orders get NULL revenue |
| Dashboard currency toggle | USD→CZK, EUR→CZK, CZK→EUR | Toggle renders disabled with a padlock |
| `mart.market_orders` (Markets page, migration 290) | order currency → client currency, or the inverse (CAD→USD, EUR→USD, GBP→USD, GBP→EUR, EUR→CZK, CZK→EUR) | `fx_local_to_base` NULL: no local-currency toggle, no local prices |

One script builds every refresh: `python3 infra/fx_rates_refresh.py --from YYYY-MM` prints the
MERGE for all seven pairs (sources and methods in its docstring). The sections below explain
the sources; the script is the thing to run.

**This table expires.** Both consumers need a row for *every* month they touch, so
a table that stops in July is broken in August. The dashboard treats partial
coverage as no coverage on purpose — a total built from some converted months
and some dropped ones is wrong, not merely smaller — so one missing month
silently disables the whole toggle.

Do this **once a month, after the 1st**, or automate it (see the last section).

---

## Which rows are provisional

ČNB and the Bank of Canada publish a month's average only after that month
closes. The current month therefore carries a **month-to-date mean of the daily
fixings**, tagged in `source`:

| `source` | Meaning |
|---|---|
| `cnb_monthly_avg` | Final. ČNB's published monthly average. |
| `cnb_mtd_avg@YYYY-MM-DD` | Provisional. Mean of daily fixings up to that date. Replace when the month closes. |
| `boc_monthly_avg` / `ecb_monthly_avg` | Final. Mean of the Bank of Canada (CAD→USD) or ECB (EUR→USD, GBP→USD, GBP→EUR) daily rates of a closed month. |
| `boc_mtd_avg@…` / `ecb_mtd_avg@…` | Provisional, same rule as the CNB one. |
| `manual_entry_2026-05-25` | The original CAD→USD seed (Bank of Canada, migration 012). |

```sql
-- What is currently provisional or missing?
SELECT from_currency, to_currency, MAX(month_start) AS last_month,
       COUNTIF(source LIKE '%mtd_avg%')             AS provisional_rows
FROM `oneeighty-warehouse.ref.fx_rates`
GROUP BY from_currency, to_currency;
```

If `last_month` is behind `DATE_TRUNC(CURRENT_DATE(), MONTH)` for **USD→CZK**,
the dashboard toggle is already disabled for anyone looking at this month.

---

## Refresh USD→CZK (ČNB)

ČNB's monthly-average file is the source of truth:

```
https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/prumerne_mena.txt?mena=USD
```

> **Trap.** That file contains **two** tables. The first is per-month averages —
> the one you want. The second, after a blank line, is *cumulative* January-to-N
> averages and looks identical (`rok|množství|leden|leden-únor|…`). Reading the
> second gives plausible numbers that are wrong by up to ~1%. Stop parsing at the
> blank line, and assert the header's third column is exactly `leden`.

The current month has no published average yet, so take the mean of the daily
fixings from the year file (column `1 USD`):

```
https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/rok.txt?rok=YYYY
```

Both files use a comma as the decimal separator and `|` as the delimiter.

This script prints the `STRUCT` rows to paste into a MERGE:

```bash
python3 - <<'PY'
import statistics, re, urllib.request

BASE = "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu"
get = lambda u: urllib.request.urlopen(u, timeout=30).read().decode("utf-8")

# --- closed months: the FIRST table only ---
lines = get(f"{BASE}/prumerne_mena.txt?mena=USD").splitlines()
start = next(i for i, l in enumerate(lines) if l.startswith("rok|"))
end   = next(i for i in range(start + 1, len(lines)) if not lines[i].strip())
table = lines[start:end]
assert table[0].split("|")[2] == "leden", "parsed the cumulative table, not the monthly one"

for line in table[1:]:
    p = line.split("|")
    if not p[0].isdigit() or int(p[0]) < 2026:   # <-- only the months you still need
        continue
    assert p[1] == "1", "rate is not quoted per 1 USD"
    for i, v in enumerate(p[2:14], start=1):
        if v:
            print(f"    STRUCT(DATE '{p[0]}-{i:02d}-01', 'USD', 'CZK', "
                  f"NUMERIC '{v.replace(',', '.')}', 'cnb_monthly_avg'),")

# --- current month: mean of the daily fixings so far ---
import datetime as dt
today = dt.date.today()
daily = get(f"{BASE}/rok.txt?rok={today.year}").splitlines()
usd = daily[0].split("|").index("1 USD")
vals = [float(r.split("|")[usd].replace(",", "."))
        for r in daily[1:]
        if re.match(rf"\d{{2}}\.{today.month:02d}\.{today.year}", r.split("|")[0])]
if vals:
    print(f"    -- provisional: mean of {len(vals)} daily fixings this month")
    print(f"    STRUCT(DATE '{today:%Y-%m}-01', 'USD', 'CZK', "
          f"NUMERIC '{statistics.fmean(vals):.3f}', 'cnb_mtd_avg@{today:%Y-%m-%d}')")
PY
```

Paste the output into the `UNNEST([...])` of the MERGE in
`infra/bigquery/013_seed_fx_usd_czk.sql` and run it. The MERGE keys on
`(month_start, from_currency, to_currency)` and updates on match, so re-running
is safe and a provisional row is overwritten in place rather than duplicated.

### Verify

```sql
-- 0 rows = every month the marts can serve is covered
WITH wanted AS (
  SELECT month_start FROM UNNEST(GENERATE_DATE_ARRAY(
    DATE '2023-07-01', DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 MONTH)) AS month_start
)
SELECT w.month_start
FROM wanted w
LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
  ON fx.month_start = w.month_start
 AND fx.from_currency = 'USD' AND fx.to_currency = 'CZK'
WHERE fx.rate IS NULL
ORDER BY 1;
```

Then load `/snapshot?client=dobias` and confirm the currency toggle's
`USD → CZK` segment is clickable rather than padlocked.

---

## CAD→USD, EUR→USD, GBP→USD, GBP→EUR

CAD→USD was seeded once in migration `012` (Bank of Canada, 2022-06 → 2026-05) and nobody
refreshed it. That went unnoticed because the Canadian store was merged into the US store in
March 2026 and the old note here said no CAD order would need a rate. It was wrong: since the
merge Shopify Markets presents Canadian customers in CAD, so `presentment_currency = 'CAD'`
orders arrive every day (1,902 between 2026-06-01 and 2026-10-15). Their money is booked in
USD, but the Markets page needs CAD→USD to show a local currency and local prices. EUR and GBP
presentment orders (Dobias) and Venev GBP orders need EUR→USD, GBP→USD and GBP→EUR for the same
reason. Migration `302_fx_rates_backfill.sql` fills all of it; this script keeps it filled:

```bash
python3 infra/fx_rates_refresh.py --from 2026-10 --pairs CAD/USD EUR/USD GBP/USD GBP/EUR > /tmp/fx.sql
```

Sources (all public, no key): Bank of Canada Valet `FXCADUSD` (daily, no monthly series, so the
script averages the dailies; mean at 4 dp reproduces the 012 seed), ECB
`eurofxref-hist.zip` (units per EUR, crossed for GBP→USD and GBP→EUR, 6 dp).

Watch for gaps with this check (it is the one that would have caught the CAD hole in June):

```sql
-- Orders whose currency has no rate for their month: NULL local currency / NULL revenue
SELECT client_id, currency_local, DATE_TRUNC(order_date, MONTH) AS m, COUNT(*) AS orders
FROM `oneeighty-warehouse.mart.market_orders` o
WHERE currency_local != currency_base AND fx_local_to_base IS NULL AND net_sales IS NOT NULL
GROUP BY 1, 2, 3 ORDER BY m DESC;
```

And the older stg-level check (shop currency without a rate):

```sql
SELECT DATE_TRUNC(o.order_date, MONTH) AS m, o.currency_original, COUNT(*) AS orders
FROM `oneeighty-warehouse.stg.stg_shopify_orders` o
LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
  ON fx.month_start = DATE_TRUNC(o.order_date, MONTH)
 AND fx.from_currency = o.currency_original AND fx.to_currency = o.currency
WHERE o.currency_original <> o.currency AND fx.rate IS NULL
GROUP BY 1, 2 ORDER BY 1 DESC;
```

Known remaining hole: CAD→USD before 2022-06 (Dobias migrated Canadian history, 34,325 stg
orders 2013-12 → 2022-05 with NULL USD amounts). Left empty on purpose until the owner decides
to restate Dobias history; see docs/sessions/2026-10-15/markets/FX-FIX.md section D.

---

## Automating this

The manual step is the weak part — it depends on someone remembering, and the
failure is quiet (a disabled toggle, not an error). Two options, in order of
effort:

1. **Alert only.** The Data Health page already surfaces per-source freshness;
   add `ref.fx_rates` to it so a stale table is visible on a page people open,
   rather than only discoverable by clicking a padlock. *(Not built yet.)*
2. **An n8n workflow.** ČNB's files are static text over plain HTTP with no key
   and no rate limit, so a monthly cron doing HTTP → Code (the two-table parse
   above) → BigQuery MERGE is roughly 4 nodes. Model it on
   `wf_klaviyo_to_bigquery`'s BigQuery-insert branch. This is the real fix.

`infra/fx_rates_refresh.py` is the Code-node body for option 2: same fetch, same parse, it only
prints the MERGE. Node plan and the grants it needs are in
docs/sessions/2026-10-15/markets/FX-FIX.md section C.

Until one of those exists, put a monthly reminder in the calendar.
