#!/usr/bin/env python3
"""IBI Audios & Radios — nightly station-map builder (v1.2).

Downloads every working station from the free Radio Browser directory (radio-browser.info,
community-run, no key) and places each one on a city from the free GeoNames city list
(geonames.org, CC BY 4.0), so the globe can show one dot per city.

Placement, best first:
  1. the station's own map position  -> the nearest GeoNames city (same country) within 150 km
  2. its "state" field               -> a city of that name, else the largest city of that state
  3. a city named in the station name (e.g. "Radio Mirchi Chennai")
  4. the country's capital, flagged "nationwide" (the station gave no place at all)

Writes data/places.json (the globe) and data/st/<CC>.json (stations, loaded per country on demand).
Standard library only, so it runs on GitHub Actions with nothing to install.
Usage: python scripts/build_stations.py [--cache DIR]
"""
import io, json, math, os, re, sys, time, unicodedata, urllib.request, zipfile
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")
UA = "IBIAudiosRadios/1.0 (+https://radio.indiabusinessinternational.online)"
MIRRORS = ["de1.api.radio-browser.info", "de2.api.radio-browser.info", "fi1.api.radio-browser.info", "nl1.api.radio-browser.info", "at1.api.radio-browser.info"]
GEONAMES = "https://download.geonames.org/export/dump/"
# GeoNames lists some taluks and suburbs as cities carrying the whole district's population, so they
# would swallow the real city next door (Kanayannur would replace Kochi). These are left out.
SKIP_CITIES = {("IN", "Kanayannur"), ("IN", "Rasapudipalem")}
SEATS = {"PPLC", "PPLA", "PPLA2"}        # capitals and district seats win over a bigger suburb within 30 km


def fetch(url, tries=3):
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as e:
            print("  retry", n + 1, url, e, file=sys.stderr)
            time.sleep(3 * (n + 1))
    raise RuntimeError("download failed: " + url)


def cached(cache, name, url):
    if cache:
        p = os.path.join(cache, name)
        if os.path.exists(p):
            with open(p, "rb") as f:
                return f.read()
    data = fetch(url)
    if cache:
        with open(os.path.join(cache, name), "wb") as f:
            f.write(data)
    return data


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def km(a_lat, a_lng, b_lat, b_lng):
    p = math.pi / 180
    h = math.sin((b_lat - a_lat) * p / 2) ** 2 + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin((b_lng - a_lng) * p / 2) ** 2
    return 12742 * math.asin(min(1, math.sqrt(h)))


def main():
    cache = None
    if "--cache" in sys.argv:
        cache = sys.argv[sys.argv.index("--cache") + 1]
        os.makedirs(cache, exist_ok=True)

    # ---- GeoNames ------------------------------------------------------------------------------
    zf = zipfile.ZipFile(io.BytesIO(cached(cache, "cities15000.zip", GEONAMES + "cities15000.zip")))
    rows = zf.read("cities15000.txt").decode("utf-8").splitlines()
    cities = {}                      # geonameid -> dict
    by_name = defaultdict(list)      # (cc, normname) -> [gid]
    by_admin = defaultdict(list)     # (cc, admin1) -> [gid]
    grid = defaultdict(list)         # (int lat, int lng) -> [gid]
    for line in rows:
        c = line.split("\t")
        gid, name, ascii_, alts, lat, lng, cc, a1, pop, tz = c[0], c[1], c[2], c[3], float(c[4]), float(c[5]), c[8], c[10], int(c[14] or 0), c[17]
        if (cc, ascii_) in SKIP_CITIES:
            continue
        cities[gid] = {"name": name, "lat": lat, "lng": lng, "cc": cc, "a1": a1, "pop": pop, "tz": tz, "seat": c[7] in SEATS}
        names = {norm(name), norm(ascii_)}
        for a in alts.split(",")[:40]:
            if a and re.match(r"^[A-Za-z .'-]+$", a):
                names.add(norm(a))
        for n in names:
            if len(n) >= 3:
                by_name[(cc, n)].append(gid)
        by_admin[(cc, a1)].append(gid)
        grid[(int(math.floor(lat)), int(math.floor(lng)))].append(gid)
    admin_names = {}                 # (cc, normname) -> admin1 code
    admin_label = {}                 # (cc, admin1) -> name
    for line in cached(cache, "admin1CodesASCII.txt", GEONAMES + "admin1CodesASCII.txt").decode("utf-8").splitlines():
        c = line.split("\t")
        if len(c) < 3:
            continue
        cc, code = c[0].split(".", 1)
        admin_label[(cc, code)] = c[1]
        admin_names[(cc, norm(c[1]))] = code
        admin_names[(cc, norm(c[2]))] = code
    capital, country_name = {}, {}
    for line in cached(cache, "countryInfo.txt", GEONAMES + "countryInfo.txt").decode("utf-8").splitlines():
        if line.startswith("#"):
            continue
        c = line.split("\t")
        if len(c) > 5:
            country_name[c[0]] = c[4]
            capital[c[0]] = norm(c[5])

    def biggest(gids):
        return max(gids, key=lambda g: cities[g]["pop"]) if gids else None

    def nearest(lat, lng, cc):
        # the biggest city within 30 km (a suburb's station belongs to its city), else the nearest one
        best, bd, big = None, 1e9, None
        for dy in (-2, -1, 0, 1, 2):
            for dx in (-2, -1, 0, 1, 2):
                for g in grid.get((int(math.floor(lat)) + dy, int(math.floor(lng)) + dx), ()):
                    ci = cities[g]
                    if cc and ci["cc"] != cc:
                        continue
                    d = km(lat, lng, ci["lat"], ci["lng"])
                    if d < bd:
                        best, bd = g, d
                    if d <= 30 and (big is None or (ci["seat"], ci["pop"]) > (cities[big]["seat"], cities[big]["pop"])):
                        big = g
        return (big, 0) if big else (best, bd)

    def city_in_text(cc, text):
        words = re.findall(r"[A-Za-z]+", text or "")
        cands = [norm(" ".join(words[i:i + 2])) for i in range(len(words) - 1)] + [norm(w) for w in words]
        for n in cands:
            if len(n) >= 5:
                g = biggest([x for x in by_name.get((cc, n), []) if cities[x]["pop"] >= 50000])
                if g:
                    return g
        return None

    # India: a station that names no place is put in the home city of its language (shown as "approximate")
    lang_home = {"tamil": "chennai", "malayalam": "kochi", "telugu": "hyderabad", "kannada": "bengaluru", "bengali": "kolkata",
                 "bangla": "kolkata", "marathi": "mumbai", "gujarati": "ahmedabad", "punjabi": "chandigarh", "odia": "bhubaneswar",
                 "oriya": "bhubaneswar", "assamese": "guwahati", "konkani": "panaji", "tulu": "mangaluru", "bhojpuri": "patna"}

    # ---- stations --------------------------------------------------------------------------------
    raw = None
    for m in MIRRORS:
        try:
            raw = json.loads(cached(cache, "stations.json", "https://%s/json/stations/search?hidebroken=true&limit=200000" % m))
            break
        except Exception as e:
            print("mirror failed", m, e, file=sys.stderr)
    if not raw or len(raw) < 20000:
        raise SystemExit("too few stations (%s) — keeping the old data" % (len(raw) if raw else 0))

    seen, stations = set(), []
    for s in raw:
        url = (s.get("url_resolved") or s.get("url") or "").strip()
        name = re.sub(r"\s+", " ", s.get("name") or "").strip()
        if not url or not name or not url.startswith("http"):
            continue
        key = url.lower().rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        stations.append(s)

    places = {}                      # pid -> place dict
    how = Counter()
    placed = defaultdict(list)       # cc -> [(pid, station)]
    for s in stations:
        cc = (s.get("countrycode") or "").upper()
        if cc not in country_name:
            how["no country"] += 1
            continue
        pid, nw = None, 0
        lat, lng = s.get("geo_lat"), s.get("geo_long")
        if isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and -90 <= lat <= 90 and -180 <= lng <= 180 and not (abs(lat) < 0.01 and abs(lng) < 0.01):
            g, d = nearest(lat, lng, cc)
            if g and d <= 150:
                pid = g
                how["map position"] += 1
        st = norm(s.get("state"))
        if not pid and st:
            g = biggest(by_name.get((cc, st), []))
            if g:
                pid = g
                how["state / city field"] += 1
        if not pid:
            g = city_in_text(cc, s.get("name")) or city_in_text(cc, (s.get("tags") or "").replace(",", " , "))
            if g:
                pid = g
                how["city in station name / tags"] += 1
        if not pid and st and (cc, st) in admin_names:
            g = biggest(by_admin.get((cc, admin_names[(cc, st)]), []))
            if g:
                pid = g
                how["state field (largest city)"] += 1
        if not pid and cc == "IN":
            for l in (s.get("language") or "").lower().split(","):
                g = lang_home.get(l.strip()) and biggest(by_name.get((cc, lang_home[l.strip()]), []))
                if g:
                    pid, nw = g, 2
                    how["India: language home city (approximate)"] += 1
                    break
        if not pid:
            g = biggest(by_name.get((cc, capital.get(cc, "")), [])) or biggest([x for x in cities if cities[x]["cc"] == cc])
            if not g:
                how["no city"] += 1
                continue
            pid, nw = g, 1
            how["nationwide (capital)"] += 1
        placed[cc].append((pid, nw, s))
        places.setdefault(pid, {"n": 0})["n"] += 1

    # ---- languages (global table) -----------------------------------------------------------------
    def langs_of(s):
        return [x.strip().lower() for x in (s.get("language") or "").split(",") if x.strip()]
    lang_count = Counter(l for cc in placed for _, _, s in placed[cc] for l in set(langs_of(s)))
    lang_table = [l for l, n in lang_count.most_common() if n >= 5][:120]
    lang_ix = {l: i for i, l in enumerate(lang_table)}

    # ---- outputs ----------------------------------------------------------------------------------
    os.makedirs(os.path.join(OUT, "st"), exist_ok=True)
    tz_table, tz_ix = [], {}
    pid_order = sorted(places, key=lambda p: -places[p]["n"])
    pix = {p: i for i, p in enumerate(pid_order)}
    place_langs = defaultdict(set)
    countries = []
    for cc in sorted(placed):
        rows_out = []
        for pid, nw, s in placed[cc]:
            for l in langs_of(s):
                if l in lang_ix:
                    place_langs[pid].add(lang_ix[l])
            rows_out.append([
                s["stationuuid"], re.sub(r"\s+", " ", s["name"]).strip()[:120], (s.get("url_resolved") or s["url"]).strip(),
                (s.get("favicon") or "").strip()[:300], (s.get("homepage") or "").strip()[:300],
                ",".join(t.strip() for t in (s.get("tags") or "").split(",") if t.strip())[:160],
                (s.get("language") or "").strip()[:80], (s.get("codec") or "").strip()[:12],
                int(s.get("bitrate") or 0), int(s.get("hls") or 0), int(s.get("votes") or 0),
                int(s.get("clickcount") or 0), int(s.get("clicktrend") or 0), pix[pid], nw,
            ])
        rows_out.sort(key=lambda r: (r[13], -(r[11] + r[10] * 5)))
        with open(os.path.join(OUT, "st", cc + ".json"), "w", encoding="utf-8") as f:
            json.dump(rows_out, f, ensure_ascii=False, separators=(",", ":"))
        countries.append([cc, country_name[cc], len(rows_out)])

    place_rows = []
    for pid in pid_order:
        c = cities[pid]
        if c["tz"] not in tz_ix:
            tz_ix[c["tz"]] = len(tz_table)
            tz_table.append(c["tz"])
        place_rows.append([pid, c["name"], c["cc"], admin_label.get((c["cc"], c["a1"]), ""), round(c["lat"], 3), round(c["lng"], 3),
                           tz_ix[c["tz"]], places[pid]["n"], sorted(place_langs[pid])])
    meta = {
        "builder": "v1.2", "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "stations": sum(c[2] for c in countries), "places": len(place_rows),
        "how": dict(how),
        "placeFields": ["id", "name", "cc", "state", "lat", "lng", "tz", "count", "langs"],
        "stationFields": ["uuid", "name", "url", "favicon", "homepage", "tags", "language", "codec", "bitrate", "hls", "votes", "clicks", "trend", "place", "nationwide"],
        "source": "Radio Browser (radio-browser.info) station directory; city list GeoNames (geonames.org, CC BY 4.0)",
    }
    with open(os.path.join(OUT, "places.json"), "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "tz": tz_table, "langs": lang_table, "countries": sorted(countries, key=lambda c: c[1]), "places": place_rows},
                  f, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
