#!/usr/bin/env python3
"""
Scrape ALL Odoo partners worldwide from https://www.odoo.com/partners and export
name, country, grade/tier, phone, email, website, address and profile URL to CSV.

Pure standard library (urllib + re) — no third-party deps. Resumable: re-running
skips profiles already written to the CSV.

Usage:
    python3 odoo_partners_scraper.py                  # all countries
    python3 odoo_partners_scraper.py --country 64     # just Egypt (id 64)
    python3 odoo_partners_scraper.py --country egypt-64
    python3 odoo_partners_scraper.py --grade Gold     # only Gold partners
    python3 odoo_partners_scraper.py --workers 12     # parallel profile fetch
"""

import re
import csv
import time
import os
import html
import argparse
import urllib.request
import urllib.error
from urllib.parse import urlsplit, urlunsplit, quote
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://www.odoo.com"
UA = "Mozilla/5.0 (partner-directory research)"
OUT_CSV = "odoo_partners.csv"
DELAY = 0.3          # polite delay between listing-page requests (per thread)
TIMEOUT = 30

# country path segments like /partners/country/egypt-64  (skip /xx_YY/ locale prefixes)
COUNTRY_RE = re.compile(r'href="/partners/country/([a-z0-9\-]+-\d+)"', re.I)
# profile links like /partners/top-business-1314088  (may carry ?country_id=)
PROFILE_RE = re.compile(r'href="(/partners/[a-z0-9\-]+-\d+)(?:\?[^"]*)?"', re.I)
# next-page links like /partners/country/egypt-64/page/2
PAGE_RE = re.compile(r'href="/partners/country/[a-z0-9\-]+-\d+/page/(\d+)"', re.I)

FIELDS = ["country", "name", "grade", "phone", "email", "website", "address",
          "profile_url"]


def _ascii_url(url):
    """Percent-encode non-ASCII chars (e.g. Turkish 'ı') so urllib can send it."""
    p = urlsplit(url)
    netloc = p.netloc.encode("idna").decode("ascii") if any(ord(c) > 127 for c in p.netloc) else p.netloc
    return urlunsplit((p.scheme, netloc, quote(p.path, safe="/%-._~"),
                       quote(p.query, safe="=&%-._~"), ""))


def get(url, retries=3):
    req = urllib.request.Request(_ascii_url(url), headers={"User-Agent": UA})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                if r.status == 200:
                    return r.read().decode("utf-8", "replace")
        except (urllib.error.URLError, urllib.error.HTTPError, OSError):
            pass
        time.sleep(1.5 * (attempt + 1))
    return ""


def discover_countries():
    htmltxt = get(f"{BASE}/partners")
    return sorted(set(COUNTRY_RE.findall(htmltxt)))


def country_country_name(seg):
    return seg.rsplit("-", 1)[0].replace("-", " ").title()


def collect_profile_urls(seg, grade=None):
    """Walk a country's listing pages and return unique profile URLs."""
    urls = set()
    page = 1
    while page <= 100:                       # safety cap (no country has >100 pages)
        if page == 1:
            u = f"{BASE}/partners/country/{seg}"
        else:
            u = f"{BASE}/partners/country/{seg}/page/{page}"
        if grade:
            u += ("?" if "?" not in u else "&") + f"grade={grade}"
        htmltxt = get(u)
        if not htmltxt:
            break
        hits = {BASE + m for m in PROFILE_RE.findall(htmltxt)}
        new = hits - urls
        urls |= hits
        max_page = max([int(p) for p in PAGE_RE.findall(htmltxt)] + [page])
        if page >= max_page and not new:
            break
        if page >= max_page:
            break
        page += 1
        time.sleep(DELAY)
    return urls


def _itemprop(block, prop):
    m = re.search(r'itemprop="%s"[^>]*>(.*?)<' % prop, block, re.S)
    if m and m.group(1).strip():
        return html.unescape(re.sub(r"\s+", " ", m.group(1))).strip()
    m = re.search(r'itemprop="%s"[^>]*content="([^"]*)"' % prop, block)
    return html.unescape(m.group(1)).strip() if m else ""


def parse_profile(url, seg):
    htmltxt = get(url)
    if not htmltxt:
        return None

    # name + grade from <h1>
    name = grade = ""
    m = re.search(r"<h1[^>]*>(.*?)</h1>", htmltxt, re.S)
    if m:
        raw = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(1)))).strip()
        g = re.search(r"\b(Platinum|Gold|Silver|Bronze|Ready)\b", raw)
        if g:
            grade = g.group(1)
        name = re.sub(r"\s*(Platinum|Gold|Silver|Bronze|Ready)\s*$", "", raw).strip()

    # contact block holds the partner's real phone/email/website/address (microdata)
    mb = re.search(r'o_wcrm_contact_details.*?(?=</section|</footer|<footer)',
                   htmltxt, re.S)
    block = mb.group(0) if mb else htmltxt

    phone = _itemprop(block, "telephone")
    email = _itemprop(block, "email")
    if not email:
        me = re.search(r'mailto:([^"?]+)', block)
        email = me.group(1).strip() if me else ""
    address = re.sub(r"\s*-\s*$", "", _itemprop(block, "streetAddress")).strip()

    website = ""
    mw = re.search(r'itemprop="website"[^>]*href="([^"]+)"', block)
    if mw:
        website = mw.group(1).strip()
    else:
        mw = re.search(r'itemprop="website"[^>]*>(https?://[^<\s]+)', block)
        if mw:
            website = mw.group(1).strip()

    return {
        "country": country_country_name(seg),
        "name": name, "grade": grade, "phone": phone, "email": email,
        "website": website, "address": address, "profile_url": url,
    }


def load_done():
    done = set()
    if os.path.exists(OUT_CSV):
        with open(OUT_CSV, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                done.add(row.get("profile_url", ""))
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--country", help="numeric id (64) or 'slug-id' (egypt-64)")
    ap.add_argument("--grade", help="filter: Gold / Silver / Ready / Bronze / Platinum")
    ap.add_argument("--workers", type=int, default=8, help="parallel profile fetchers")
    args = ap.parse_args()

    if args.country:
        if "-" in args.country and not args.country.isdigit():
            countries = [args.country]
        else:
            allc = discover_countries()
            countries = [c for c in allc if c.endswith("-" + args.country)]
            if not countries:
                print(f"country id {args.country} not found")
                return
    else:
        countries = discover_countries()
        print(f"[discover] {len(countries)} countries")

    done = load_done()
    new_file = not os.path.exists(OUT_CSV)
    f = open(OUT_CSV, "a", newline="", encoding="utf-8-sig")
    w = csv.DictWriter(f, fieldnames=FIELDS)
    if new_file:
        w.writeheader()

    total = 0
    for ci, seg in enumerate(countries, 1):
        urls = sorted(collect_profile_urls(seg, grade=args.grade))
        todo = [u for u in urls if u not in done]
        print(f"[{ci}/{len(countries)}] {seg}: {len(urls)} partners ({len(todo)} new)",
              flush=True)
        if not todo:
            continue
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(parse_profile, u, seg): u for u in todo}
            for fut in as_completed(futs):
                try:
                    row = fut.result()
                except Exception as e:
                    print(f"  ! {futs[fut]}: {e}", flush=True)
                    continue
                if row:
                    w.writerow(row)
                    f.flush()
                    done.add(row["profile_url"])
                    total += 1

    f.close()
    print(f"\nDone. {total} new partners written to {OUT_CSV}")


if __name__ == "__main__":
    main()
