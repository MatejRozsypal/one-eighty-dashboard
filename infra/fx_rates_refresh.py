#!/usr/bin/env python3
"""Generate the MERGE that refreshes ref.fx_rates from public sources.

Prints SQL to stdout; it never talks to BigQuery. Review the output, then run it
(or paste it into a migration file). Standard library only, no API keys.

    python3 infra/fx_rates_refresh.py --from 2026-06 > /tmp/fx.sql
    python3 infra/fx_rates_refresh.py --from 2022-06 --pairs EUR/USD GBP/USD GBP/EUR
    python3 infra/fx_rates_refresh.py --from 2026-10 --pairs CAD/USD@2026-06 EUR/USD   # per-pair start

Feeds (one source per pair, never mixed inside a series):

  pair      source                                   rate meaning
  USD/CZK   CNB monthly averages (prumerne_mena)     CZK per 1 USD
  EUR/CZK   CNB monthly averages                     CZK per 1 EUR
  CZK/EUR   derived 1 / EUR/CZK at 9 dp              (CNB does not publish it)
  CAD/USD   Bank of Canada Valet, series FXCADUSD    USD per 1 CAD, mean of dailies, 4 dp
  EUR/USD   ECB euro foreign exchange reference      USD per 1 EUR, mean of dailies, 6 dp
  GBP/USD   ECB reference, cross via EUR             mean of daily (USD/GBP per EUR), 6 dp
  GBP/EUR   ECB reference                            mean of daily (1 / GBP per EUR), 6 dp

Why Bank of Canada for CAD/USD: migration 012 seeded that series from the Bank of
Canada, and mean-of-dailies at 4 dp reproduces all 48 seeded months exactly. ECB
crosses sit within 0.1 % of it, but switching source mid-series would put a step in
the CAD history.

Closed months are tagged `<src>_monthly_avg`. The current month is the mean of the
fixings so far, tagged `<src>_mtd_avg@YYYY-MM-DD` (run date), and is overwritten by
the next run. The MERGE only ever updates rows whose source is provisional
(`%mtd_avg%`), so a final row already in the table is never changed by a re-run.
"""
import argparse, csv, collections, datetime as dt, io, json, re, statistics
import urllib.request, zipfile

CNB = "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu"
BOC = "https://www.bankofcanada.ca/valet/observations/FXCADUSD/json"
ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip"
ALL_PAIRS = ["USD/CZK", "EUR/CZK", "CZK/EUR", "CAD/USD", "EUR/USD", "GBP/USD", "GBP/EUR"]


def get(url, binary=False):
    raw = urllib.request.urlopen(url, timeout=60).read()
    return raw if binary else raw.decode("utf-8")


def month_of(iso):
    return iso[:7]


def mean_by_month(daily):
    by = collections.defaultdict(list)
    for d, v in daily.items():
        by[month_of(d)].append(v)
    return by


def cnb_final(cur):
    """First table of prumerne_mena.txt only (the second is cumulative)."""
    lines = get(f"{CNB}/prumerne_mena.txt?mena={cur}").splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith("rok|"))
    end = next(i for i in range(start + 1, len(lines)) if not lines[i].strip())
    table = lines[start:end]
    assert table[0].split("|")[2] == "leden", "parsed the cumulative table"
    out = {}
    for line in table[1:]:
        p = line.split("|")
        assert p[1] == "1", "rate is not quoted per 1 unit"
        for i, v in enumerate(p[2:14], start=1):
            if v:
                out[f"{p[0]}-{i:02d}"] = float(v.replace(",", "."))
    return out


def cnb_daily(cur, year):
    rows = get(f"{CNB}/rok.txt?rok={year}").splitlines()
    col = rows[0].split("|").index(f"1 {cur}")
    out = {}
    for r in rows[1:]:
        p = r.split("|")
        m = re.match(r"(\d{2})\.(\d{2})\.(\d{4})$", p[0])
        if m and p[col]:
            out[f"{m[3]}-{m[2]}-{m[1]}"] = float(p[col].replace(",", "."))
    return out


def boc_daily(first):
    d = json.loads(get(f"{BOC}?start_date={first}-01&end_date=2099-12-31"))
    return {o["d"]: float(o["FXCADUSD"]["v"]) for o in d["observations"] if o.get("FXCADUSD", {}).get("v")}


def ecb_daily(num, den):
    """Daily cross: units of `num` per 1 `den`. ECB quotes units per 1 EUR."""
    z = zipfile.ZipFile(io.BytesIO(get(ECB, binary=True)))
    rows = csv.DictReader(io.StringIO(z.read("eurofxref-hist.csv").decode("utf-8")))
    out = {}
    for r in rows:
        try:
            n = 1.0 if num == "EUR" else float(r[num])
            d = 1.0 if den == "EUR" else float(r[den])
        except (ValueError, KeyError):
            continue
        out[r["Date"]] = n / d
    return out


def series(pair, first, today):
    """Return [(month 'YYYY-MM', rate, source)] for months >= first."""
    cur_m = today.strftime("%Y-%m")
    tag = f"@{today:%Y-%m-%d}"
    out = []
    frm, to = pair.split("/")
    if pair in ("USD/CZK", "EUR/CZK", "CZK/EUR"):
        base = "EUR" if pair != "USD/CZK" else "USD"
        final = cnb_final(base)
        mtd = mean_by_month(cnb_daily(base, today.year)).get(cur_m)
        rows = {m: (v, "cnb_monthly_avg") for m, v in final.items() if m < cur_m}
        if mtd:
            rows[cur_m] = (statistics.fmean(mtd), "cnb_mtd_avg" + tag)
        for m, (v, s) in sorted(rows.items()):
            if m >= first:
                if pair == "CZK/EUR":
                    out.append((m, round(1 / round(v, 3), 9), s + "_inverse"))
                else:
                    out.append((m, round(v, 3), s))
        return out
    if pair == "CAD/USD":
        by, dp, src = mean_by_month(boc_daily(first)), 4, "boc"
    else:
        num = {"EUR/USD": "USD", "GBP/USD": "USD", "GBP/EUR": "EUR"}[pair]
        den = {"EUR/USD": "EUR", "GBP/USD": "GBP", "GBP/EUR": "GBP"}[pair]
        by, dp, src = mean_by_month(ecb_daily(num, den)), 6, "ecb"
    for m in sorted(by):
        if m >= first:
            fin = m < cur_m
            out.append((m, round(statistics.fmean(by[m]), dp),
                        f"{src}_monthly_avg" if fin else f"{src}_mtd_avg{tag}"))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="first", required=True, help="first month, YYYY-MM")
    ap.add_argument("--pairs", nargs="*", default=ALL_PAIRS,
                    help="PAIR or PAIR@YYYY-MM (own start month); default all pairs")
    ap.add_argument("--today", default=dt.date.today().isoformat())
    a = ap.parse_args()
    today = dt.date.fromisoformat(a.today)
    rows = []
    for spec in a.pairs:
        p, _, own_first = spec.partition("@")
        if p not in ALL_PAIRS:
            raise SystemExit(f"unknown pair {p}; choose from {ALL_PAIRS}")
        for m, rate, src in series(p, own_first or a.first, today):
            f, t = p.split("/")
            if not rows:   # the first STRUCT names the columns
                rows.append(f"      STRUCT(DATE '{m}-01' AS month_start, '{f}' AS from_currency, "
                            f"'{t}' AS to_currency, NUMERIC '{rate}' AS rate, '{src}' AS source)")
            else:
                rows.append(f"      STRUCT(DATE '{m}-01', '{f}', '{t}', NUMERIC '{rate}', '{src}')")
    if not rows:
        raise SystemExit("no rows generated")
    print("MERGE `oneeighty-warehouse.ref.fx_rates` T")
    print("USING (SELECT * FROM UNNEST([")
    print(",\n".join(rows))
    print("])) S")
    print("ON  T.month_start = S.month_start AND T.from_currency = S.from_currency AND T.to_currency = S.to_currency")
    print("WHEN MATCHED AND T.source LIKE '%mtd_avg%' THEN UPDATE SET")
    print("  rate = S.rate, source = S.source, ingested_at = CURRENT_TIMESTAMP()")
    print("WHEN NOT MATCHED THEN INSERT (month_start, from_currency, to_currency, rate, source, ingested_at)")
    print("VALUES (S.month_start, S.from_currency, S.to_currency, S.rate, S.source, CURRENT_TIMESTAMP());")


if __name__ == "__main__":
    main()
