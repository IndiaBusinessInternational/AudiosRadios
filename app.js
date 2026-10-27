/* IBI Audios & Radios v1.2 — India Business International.
 * Live radio on a 3D globe. Stations: Radio Browser (radio-browser.info, open directory, no key), placed on
 * cities nightly by scripts/build_stations.py. Globe: globe.gl. No API key, no server, no tracking.
 * Everything the listener keeps (favourites, history, hidden stations, settings, alarm) stays on the device,
 * with Backup / Restore in Settings. */
(() => {
  'use strict';
  const VERSION = 'v1.2';
  const DEFAULT_STATION = '9e9b8485-72ff-4916-9197-59da819c03db';   // Radio Suno Malayalam 91.7 FM, Kochi (Founder, 27 Oct 2026)
  const DEFAULT_PLACE_NAME = 'Kochi';
  const API_HOSTS = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info', 'nl1.api.radio-browser.info', 'at1.api.radio-browser.info'];
  const IND_LANGS = ['malayalam', 'tamil', 'hindi', 'telugu', 'kannada', 'bengali', 'marathi', 'gujarati', 'punjabi', 'odia', 'urdu', 'konkani', 'assamese', 'sanskrit', 'english'];
  const LANG_HOME = { malayalam: 'Kochi', tamil: 'Chennai', hindi: 'Delhi', telugu: 'Hyderabad', kannada: 'Bengaluru', bengali: 'Kolkata', marathi: 'Mumbai', gujarati: 'Ahmedabad', punjabi: 'Chandigarh', odia: 'Bhubaneswar', urdu: 'Hyderabad', konkani: 'Panaji', assamese: 'Guwahati' };
  const GENRES = ['news', 'talk', 'devotional', 'bhajan', 'carnatic', 'bollywood', 'film', 'classical', 'pop', 'rock', 'jazz', 'oldies', 'sports', 'kids', 'christian', 'islamic', 'folk', 'dance', 'lofi', 'instrumental'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
  const icon = (id, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const isPhone = () => innerWidth < 1000;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('iar:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('iar:' + k, JSON.stringify(v)); } catch (e) { /* private mode: keep going */ } },
  };

  // ---------- state ----------
  const S = {
    places: [], tz: [], langs: [], countries: [], ccName: {}, placeById: new Map(),
    stByCC: new Map(), ccLoading: new Map(), byId: new Map(),
    place: -1, filter: null, tab: 'explore', favSeg: 'favs', browse: null, indiaOnly: true,
    current: null, ctx: [], ctxIx: 0, ctxLabel: '', status: 'idle', upgraded: false,
    favs: store.get('favs', []), history: store.get('history', []), hidden: store.get('hidden', []),
    vol: store.get('vol', 90), muted: false, httpsOnly: store.get('httpsOnly', false), autoSkip: store.get('autoSkip', true),
    sleepEnd: 0, alarm: store.get('alarm', null), lists: {}, listSeq: 0, expanded: false, meta: null,
  };
  const audio = $('#audio');
  const panel = $('#panel');
  const view = $('#view');
  let G = null;

  // ---------- dates (IBI format: 28 May 2026, Thursday, 01:38:00 PM, India time) ----------
  function fmtDate(ts) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).formatToParts(new Date(ts));
    const g = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    return `${+g('day')} ${MONTHS[+g('month') - 1]} ${g('year')}, ${g('weekday')}, ${g('hour').padStart(2, '0')}:${g('minute')}:${g('second')} ${g('dayPeriod').toUpperCase()}`;
  }
  function localTime(tz) {
    try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date()); } catch (e) { return ''; }
  }
  function time12(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return `${String(((h + 11) % 12) + 1).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }

  // ---------- toast ----------
  let toastTimer = 0;
  function toast(msg, actLabel, act, ms = 4500) {
    const t = $('#toast');
    t.innerHTML = `<div class="t" role="status"><span>${esc(msg)}</span>${actLabel ? `<button type="button">${esc(actLabel)}</button>` : ''}</div>`;
    if (actLabel) t.querySelector('button').onclick = () => { t.innerHTML = ''; act(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.innerHTML = ''; }, ms);
  }

  // ---------- Radio Browser API (mirrors, first that answers wins) ----------
  let apiIx = 0;
  async function api(path) {
    for (let n = 0; n < API_HOSTS.length; n++) {
      const i = (apiIx + n) % API_HOSTS.length;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      try {
        const r = await fetch('https://' + API_HOSTS[i] + path, { signal: ctl.signal });
        if (!r.ok) throw new Error(r.status);
        apiIx = i;
        return await r.json();
      } catch (e) { /* try the next mirror */ } finally { clearTimeout(timer); }
    }
    throw new Error('The radio directory is not answering. Check the internet and try again.');
  }

  // ---------- station objects ----------
  function fromRow(r, cc) {
    return { id: r[0], name: r[1], url: r[2], fav: r[3], home: r[4], tags: r[5], lang: r[6], codec: r[7], br: r[8], hls: r[9], votes: r[10], clicks: r[11], trend: r[12], pid: r[13], nw: r[14], cc };
  }
  function fromApi(a) {
    const known = S.byId.get(a.stationuuid);
    if (known) return known;
    return {
      id: a.stationuuid, name: String(a.name || '').replace(/\s+/g, ' ').trim(), url: (a.url_resolved || a.url || '').trim(), fav: a.favicon || '', home: a.homepage || '',
      tags: a.tags || '', lang: a.language || '', codec: a.codec || '', br: a.bitrate || 0, hls: a.hls || 0, votes: a.votes || 0, clicks: a.clickcount || 0,
      trend: a.clicktrend || 0, pid: -1, nw: 0, cc: (a.countrycode || '').toUpperCase(), where: [a.state, a.country].filter(Boolean).join(', '),
    };
  }
  const slim = (s) => ({ id: s.id, name: s.name, url: s.url, fav: s.fav, home: s.home, tags: s.tags, lang: s.lang, codec: s.codec, br: s.br, hls: s.hls, votes: s.votes, clicks: s.clicks, trend: s.trend, pid: -1, nw: s.nw, cc: s.cc, where: whereOf(s) });
  function whereOf(s) {
    if (!s) return '';
    const p = s.pid >= 0 ? S.places[s.pid] : null;
    if (p && p.id && S.placeById.get(p.id) === p) {
      const country = S.ccName[p.cc] || p.cc;
      if (s.nw === 1) return `${country} · city not given`;
      return `${p.name}, ${p.cc === 'IN' && p.state ? p.state : country}`;
    }
    return s.where || S.ccName[s.cc] || '';
  }
  const playsHere = (s) => location.protocol !== 'https:' || /^https:/i.test(s.url);
  const visible = (s) => !S.hidden.includes(s.id) && (!S.httpsOnly || playsHere(s));
  const splitList = (s) => String(s || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);

  async function ensureCC(cc) {
    if (!cc) return [];
    if (S.stByCC.has(cc)) return S.stByCC.get(cc);
    if (S.ccLoading.has(cc)) return S.ccLoading.get(cc);
    const p = fetch(`data/st/${cc}.json`).then((r) => { if (!r.ok) throw new Error('stations ' + r.status); return r.json(); }).then((rows) => {
      const arr = rows.map((r) => fromRow(r, cc));
      arr.forEach((s) => S.byId.set(s.id, s));
      S.stByCC.set(cc, arr);
      S.ccLoading.delete(cc);
      return arr;
    }).catch((e) => { S.ccLoading.delete(cc); throw e; });
    S.ccLoading.set(cc, p);
    return p;
  }

  // ---------- data ----------
  async function loadData() {
    setGlobeMsg('Loading the world\'s radio…', true);
    try {
      const r = await fetch('data/places.json');
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      S.meta = d.meta; S.tz = d.tz; S.langs = d.langs;
      S.countries = d.countries;
      d.countries.forEach((c) => { S.ccName[c[0]] = c[1]; });
      S.places = d.places.map((p, i) => ({ i, id: p[0], name: p[1], cc: p[2], state: p[3], lat: p[4], lng: p[5], tz: d.tz[p[6]], count: p[7], langs: p[8] }));
      S.places.forEach((p) => S.placeById.set(p.id, p));
      return true;
    } catch (e) {
      setGlobeMsg('The station map could not load. Check the internet.', false, true);
      return false;
    }
  }
  function setGlobeMsg(text, spin, retry) {
    const m = $('#globeMsg');
    if (!text) { m.hidden = true; return; }
    m.hidden = false;
    m.innerHTML = `${spin ? '<div class="spin"></div>' : ''}<div>${esc(text)}</div>${retry ? '<button type="button" class="btn" id="retryLoad">Try again</button>' : ''}`;
    if (retry) $('#retryLoad').onclick = () => boot();
  }

  // ---------- filter (language) ----------
  function shownPlaces() {
    if (!S.filter) return S.places;
    return S.places.filter((p) => p.langs.includes(S.filter.ix));
  }
  function stationMatchesFilter(s) { return !S.filter || splitList(s.lang).includes(S.filter.value); }
  function setFilter(lang) {
    if (!lang) { S.filter = null; }
    else {
      const ix = S.langs.indexOf(lang);
      S.filter = { value: lang, ix, label: cap(lang) };
    }
    store.set('filter', S.filter ? S.filter.value : null);
    paintFilter();
    if (S.filter && S.filter.ix >= 0) {
      const ps = shownPlaces();
      if (ps.length && !ps.includes(S.places[S.place])) {
        const homeCity = ps.find((p) => p.cc === 'IN' && p.name === LANG_HOME[lang]);   // Indian languages open on their home city
        const india = IND_LANGS.includes(lang) && lang !== 'english' ? ps.filter((p) => p.cc === 'IN') : [];
        const best = homeCity || (india.length ? india : ps).reduce((a, b) => (b.count > a.count ? b : a));
        selectPlace(best.i, { fly: true });
      }
    }
    renderView();
  }
  function paintFilter() {
    const chip = $('#filterChip');
    if (S.filter) {
      const n = S.filter.ix >= 0 ? shownPlaces().length : 0;
      $('#filterChipText').textContent = `${S.filter.label} radio · ${n} ${n === 1 ? 'city' : 'cities'}`;
      chip.hidden = false;
    } else chip.hidden = true;
    if (G) G.pointsData(S.filter && S.filter.ix >= 0 ? shownPlaces() : S.places);
    paintPlaceHead();
  }

  // ---------- globe ----------
  function initGlobe() {
    if (document.body.classList.contains('lite')) return;
    if (typeof window.Globe !== 'function') { setGlobeMsg('The 3D globe could not load on this device. Lite mode lists the same stations.', false); offerLite(); return; }
    const el = $('#globe');
    const small = Math.min(innerWidth, innerHeight) < 700;
    try {
      G = new window.Globe(el, { rendererConfig: { antialias: !small, alpha: true, powerPreference: 'high-performance' } });
    } catch (e) { setGlobeMsg('This device cannot draw the 3D globe. Lite mode lists the same stations.', false); offerLite(); return; }
    G.backgroundColor('rgba(0,0,0,0)')
      .globeImageUrl(small ? 'img/earth-2k.jpg' : 'img/earth-4k.jpg')
      .bumpImageUrl('img/earth-bump.png')
      .showAtmosphere(true).atmosphereColor('#35C0ED').atmosphereAltitude(0.15)
      .pointsMerge(true).pointResolution(6).pointAltitude(0.006)
      .pointLat('lat').pointLng('lng').pointColor(() => '#35C0ED')
      .pointRadius((p) => 0.14 + Math.min(0.42, Math.log10(p.count + 1) * 0.16))
      .pointsData(S.places)
      .ringLat('lat').ringLng('lng').ringColor(() => (t) => `rgba(255,255,255,${1 - t})`).ringMaxRadius(1.6).ringPropagationSpeed(1.4).ringRepeatPeriod(1100)
      .onGlobeClick(({ lat, lng }) => {
        const p = nearestPlace(lat, lng, 6);
        if (p) selectPlace(p.i, { fly: true });
      })
      .onZoom(() => schedulePick());
    const c = G.controls();
    c.minDistance = 108; c.maxDistance = 560; c.rotateSpeed = 0.55; c.zoomSpeed = 0.9;
    const size = () => { G.width(el.clientWidth).height(el.clientHeight); };
    new ResizeObserver(size).observe(el);
    size();
  }
  function offerLite() {
    const m = $('#globeMsg');
    const b = document.createElement('button');
    b.className = 'btn'; b.type = 'button'; b.textContent = 'Use Lite mode';
    b.onclick = () => setLite(true);
    m.appendChild(b);
  }
  const rad = Math.PI / 180;
  function angDist(a1, o1, a2, o2) {
    const h = Math.sin((a2 - a1) * rad / 2) ** 2 + Math.cos(a1 * rad) * Math.cos(a2 * rad) * Math.sin((o2 - o1) * rad / 2) ** 2;
    return 2 * Math.asin(Math.min(1, Math.sqrt(h))) / rad;
  }
  function nearestPlace(lat, lng, maxDeg = 180, list = shownPlaces()) {
    let best = null, bd = maxDeg;
    for (const p of list) { const d = angDist(lat, lng, p.lat, p.lng); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  let pickTimer = 0, flyingUntil = 0;
  function schedulePick() { clearTimeout(pickTimer); pickTimer = setTimeout(centrePick, 220); }
  function centrePick() {
    if (!G || Date.now() < flyingUntil) return;
    const el = $('#globe');
    const pov = G.pointOfView();
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    let best = null, bd = 30 * 30;
    for (const p of shownPlaces()) {
      if (angDist(pov.lat, pov.lng, p.lat, p.lng) > 50) continue;
      const s = G.getScreenCoords(p.lat, p.lng, 0.006);
      const d = (s.x - cx) ** 2 + (s.y - cy) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    $('#ring').classList.toggle('hit', !!best);
    if (best && best.i !== S.place) selectPlace(best.i, { fly: false });
  }
  function flyTo(p, alt) {
    if (!G) return;
    const cur = G.pointOfView();
    flyingUntil = Date.now() + 1000;
    G.pointOfView({ lat: p.lat, lng: p.lng, altitude: alt || Math.min(cur.altitude, 1.1) }, 900);
    setTimeout(() => $('#ring').classList.add('hit'), 950);
  }

  // ---------- places ----------
  function selectPlace(i, { fly = false, keepHash = false } = {}) {
    const p = S.places[i];
    if (!p) return;
    S.place = i;
    store.set('place', p.id);
    if (G) G.ringsData([p]);
    if (fly) flyTo(p);
    paintPlaceHead();
    if (!keepHash && !(location.hash.startsWith('#s=') && S.current)) setHash('#p=' + p.id);
    if (S.tab === 'explore') renderView();
  }
  function paintPlaceHead() {
    const p = S.places[S.place];
    if (!p) return;
    const n = S.filter ? '…' : p.count;
    $('#placeCount').textContent = n;
    if (S.filter) placeStations(p).then((a) => { if (S.places[S.place] === p) $('#placeCount').textContent = a.length; }).catch(() => {});
    $('#placeName').textContent = p.name;
    $('#placeSub').textContent = [p.state && p.state !== p.name ? p.state : '', S.ccName[p.cc] || p.cc].filter(Boolean).join(', ');
    $('#placeTime').textContent = localTime(p.tz);
    $('#placeTime').title = 'Local time in ' + p.name;
  }
  async function placeStations(p) {
    const all = await ensureCC(p.cc);
    return all.filter((s) => s.pid === p.i && visible(s) && stationMatchesFilter(s));
  }
  setInterval(() => { const p = S.places[S.place]; if (p) $('#placeTime').textContent = localTime(p.tz); }, 20000);

  // ---------- hash links ----------
  function setHash(h) { try { history.replaceState(history.state, '', h); } catch (e) { /* file:// */ } }
  const linkOf = (s) => `${location.origin}${location.pathname}#s=${s.cc || 'XX'}.${s.id}`;

  // ---------- panel / sheet ----------
  function measureSheet() {
    if (isPhone() && !S.expanded) document.documentElement.style.setProperty('--sheet-collapsed', panel.offsetHeight + 'px');
  }
  function expand() {
    if (!isPhone() || S.expanded) return;
    S.expanded = true;
    panel.classList.add('expanded');
    history.pushState({ iar: 'sheet' }, '');
  }
  function collapse(fromPop) {
    if (!S.expanded) return;
    if (!fromPop) { history.back(); return; }
    S.expanded = false;
    panel.classList.remove('expanded');
  }
  function setTab(t, { open = true } = {}) {
    S.tab = t;
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    if (open) expand();
    renderView();
    view.scrollTop = 0;
    if (t === 'search' && !isPhone()) setTimeout(() => { const i = $('#q'); if (i) i.focus(); }, 30);
  }

  // ---------- list rendering ----------
  function art(s, big) {
    const initials = esc((s.name || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '♪');
    const src = s.fav ? s.fav.replace(/^http:/i, 'https:') : '';
    return `<span class="art" style="position:relative">${initials}${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="position:absolute;inset:0" onerror="this.remove()">` : ''}</span>`;
  }
  function badges(s) {
    const b = [];
    if (s.br > 0) b.push(`<span class="chip ${s.br >= 192 ? 'hd' : ''}" title="Bitrate">${s.br} kbps</span>`);
    if (s.codec && s.codec !== 'UNKNOWN') b.push(`<span class="chip" title="Audio format">${esc(s.codec.toUpperCase())}</span>`);
    if (s.hls) b.push('<span class="chip" title="Adaptive stream (HLS)">HLS</span>');
    if (!playsHere(s)) b.push('<span class="chip warn" title="Old insecure link: if it cannot play here, it opens in a new tab">Old link</span>');
    if (s.trend >= 15) b.push('<span class="chip hot" title="Many people started it in the last day">Trending</span>');
    else if (s.clicks >= 300 || s.votes >= 1000) b.push('<span class="chip hot" title="Among the most played">Popular</span>');
    if (s.nw === 2) b.push('<span class="chip" title="The station gave no city; placed by its language">City approx.</span>');
    return b.join('');
  }
  function stationRows(list, label) {
    const id = 'l' + (++S.listSeq);
    S.lists[id] = { list, label };
    return list.map((s, i) => {
      const fav = isFav(s);
      const playing = S.current && S.current.id === s.id;
      return `<div class="row ${playing ? 'playing' : ''}" data-act="play" data-l="${id}" data-i="${i}" role="button" tabindex="0" aria-label="Play ${esc(s.name)}">
        ${art(s)}<div class="meta"><div class="t1">${playing ? '▶ ' : ''}${esc(s.name)}</div><div class="t2">${esc(whereOf(s))}${s.tags ? ' · ' + esc(splitList(s.tags).slice(0, 3).join(', ')) : ''}</div><div class="bdg">${badges(s)}</div></div>
        <div class="side"><button type="button" class="iconbtn ${fav ? 'on' : ''}" data-act="fav" data-l="${id}" data-i="${i}" aria-label="${fav ? 'Remove from' : 'Add to'} favourites" aria-pressed="${fav}">${icon('heart', fav ? 'fill' : '')}</button></div></div>`;
    }).join('');
  }
  const loadingRow = (t) => `<div class="loadingrow"><div class="spin"></div>${esc(t)}</div>`;
  const errorBox = (msg, act) => `<div class="empty"><b>Something went wrong</b>${esc(msg)}<br><button type="button" data-act="${act}">Try again</button></div>`;
  const sec = (title, action) => `<div class="sec"><h2>${esc(title)}</h2>${action || ''}</div>`;

  let renderSeq = 0;
  function renderView() {
    const seq = ++renderSeq;
    const done = (html) => { if (seq === renderSeq) view.innerHTML = html; };
    ({ explore: renderExplore, favs: renderFavs, browse: renderBrowse, search: renderSearch, settings: renderSettings }[S.tab])(done, seq);
  }

  // Explore: stations of the selected place, then nearby places
  async function renderExplore(done, seq) {
    const p = S.places[S.place];
    if (!p) { done('<div class="empty"><b>Spin the globe</b>Turn the globe and stop a city inside the ring, or tap a green dot.</div>'); return; }
    done(loadingRow(`Loading stations in ${p.name}…`));
    let list;
    try { list = await placeStations(p); } catch (e) { done(errorBox('The stations of ' + p.name + ' did not load.', 'retry-view')); return; }
    if (seq !== renderSeq) return;
    const local = list.filter((s) => s.nw !== 1), national = list.filter((s) => s.nw === 1);
    let html = '';
    if (local.length) html += sec(`${local.length} ${local.length === 1 ? 'station' : 'stations'} in ${p.name}`) + stationRows(local, p.name);
    if (national.length) html += sec(`${S.ccName[p.cc] || p.cc}: city not given (${national.length})`) + stationRows(national, S.ccName[p.cc]);
    if (!list.length) html += `<div class="empty"><b>No stations here${S.filter ? ' in ' + esc(S.filter.label) : ''}</b>${S.filter ? 'Clear the language filter to see every station.' : 'Hidden stations can be shown again in Settings.'}</div>`;
    const near = shownPlaces().filter((q) => q !== p).map((q) => ({ q, d: angDist(p.lat, p.lng, q.lat, q.lng) })).sort((a, b) => a.d - b.d).slice(0, 8);
    if (near.length) {
      html += sec('Nearby places') + near.map(({ q, d }) => `<button type="button" class="row" data-act="place" data-p="${q.i}"><span class="art">${q.count}</span><div class="meta"><div class="t1">${esc(q.name)}</div><div class="t2">${esc([q.state, S.ccName[q.cc]].filter(Boolean).join(', '))} · ${Math.round(d * 111.2)} km</div></div>${icon('right')}</button>`).join('');
    }
    done(html);
  }

  // Favourites + History
  function renderFavs(done) {
    let html = `<div class="seg" role="tablist"><button type="button" role="tab" data-act="seg" data-seg="favs" aria-selected="${S.favSeg === 'favs'}">Favourites (${S.favs.length})</button><button type="button" role="tab" data-act="seg" data-seg="history" aria-selected="${S.favSeg === 'history'}">Recently played</button></div>`;
    if (S.favSeg === 'favs') {
      html += S.favs.length ? stationRows(S.favs, 'Favourites') : '<div class="empty"><b>No favourites yet</b>Tap ♥ on any station to keep it here. Favourites are saved on this device and work offline.</div>';
    } else {
      if (!S.history.length) html += '<div class="empty"><b>Nothing played yet</b>Stations you listen to appear here with the date and time.</div>';
      else {
        const list = S.history.map((h) => h.s);
        html += sec(`Last ${S.history.length}`, '<button type="button" class="act" data-act="clear-history">Clear history</button>') + stationRows(list, 'Recently played');
        const stamp = S.history.map((h) => fmtDate(h.t));
        let k = 0;
        html = html.replace(/<div class="bdg">/g, () => `<div class="t2">${esc(stamp[k++] || '')}</div><div class="bdg">`);
      }
    }
    done(html);
  }

  // Browse: languages, genres, popular, countries
  async function renderBrowse(done, seq) {
    const langChips = IND_LANGS.map((l) => `<button type="button" class="pill" data-act="lang" data-v="${l}" aria-pressed="${!!(S.filter && S.filter.value === l)}">${cap(l)}</button>`).join('');
    const genreChips = GENRES.map((g) => `<button type="button" class="pill" data-act="genre" data-v="${g}" aria-pressed="${!!(S.browse && S.browse.type === 'genre' && S.browse.value === g)}">${cap(g)}</button>`).join('');
    let head = sec('Languages', S.filter ? '<button type="button" class="act" data-act="lang" data-v="">Show all</button>' : '') + `<div class="chips">${langChips}</div>`
      + sec('Genres', `<button type="button" class="act" data-act="india-only" aria-pressed="${S.indiaOnly}">${S.indiaOnly ? '✓ India only' : 'Whole world'}</button>`) + `<div class="chips">${genreChips}</div>`
      + `<div class="chips"><button type="button" class="pill" data-act="popular" aria-pressed="${!!(S.browse && S.browse.type === 'popular')}">🔥 Trending now</button><button type="button" class="pill" data-act="top" aria-pressed="${!!(S.browse && S.browse.type === 'top')}">⭐ Most played</button></div>`;
    const countries = sec(`Countries (${S.countries.length})`) + S.countries.slice().sort((a, b) => (a[0] === 'IN' ? -1 : b[0] === 'IN' ? 1 : a[1].localeCompare(b[1])))
      .map((c) => `<button type="button" class="row" data-act="country" data-cc="${c[0]}"><span class="art">${esc(c[0])}</span><div class="meta"><div class="t1">${esc(c[1])}</div><div class="t2">${c[2]} stations</div></div>${icon('right')}</button>`).join('');
    const b = S.browse;
    if (!b) { done(head + countries); return; }
    const title = b.label;
    const close = '<button type="button" class="act" data-act="browse-clear">✕ Close list</button>';
    done(head + sec(title, close) + loadingRow('Loading ' + title + '…'));
    try {
      const list = await browseList(b);
      if (seq !== renderSeq) return;
      done(head + sec(`${title} (${list.length})`, close) + (list.length ? stationRows(list, title) : '<div class="empty"><b>No stations found</b>Try “Whole world”, or another genre.</div>') + countries);
    } catch (e) {
      if (seq !== renderSeq) return;
      done(head + sec(title, close) + errorBox(e.message, 'retry-view') + countries);
    }
  }
  async function browseList(b) {
    const cc = S.indiaOnly ? '&countrycode=IN' : '';
    let rows;
    if (b.type === 'lang') rows = await api(`/json/stations/search?language=${encodeURIComponent(b.value)}&languageExact=true&order=clickcount&reverse=true&hidebroken=true&limit=150`);
    else if (b.type === 'genre') rows = await api(`/json/stations/search?tag=${encodeURIComponent(b.value)}&order=clickcount&reverse=true&hidebroken=true&limit=150${cc}`);
    else if (b.type === 'popular') rows = await api(`/json/stations/search?order=clicktrend&reverse=true&hidebroken=true&limit=100${cc}`);
    else if (b.type === 'top') rows = await api(`/json/stations/search?order=clickcount&reverse=true&hidebroken=true&limit=100${cc}`);
    else if (b.type === 'country') {
      const all = await ensureCC(b.value);
      return all.filter(visible).slice().sort((x, y) => (y.clicks + y.votes * 5) - (x.clicks + x.votes * 5)).slice(0, 200);
    }
    return dedupe(rows.map(fromApi)).filter(visible);
  }
  function dedupe(list) { const seen = new Set(); return list.filter((s) => { const k = s.url.toLowerCase(); if (seen.has(k) || seen.has(s.id)) return false; seen.add(k); seen.add(s.id); return true; }); }

  // Search: places (local) + stations (directory)
  let searchTimer = 0, lastQ = store.get('q', '');
  function renderSearch(done) {
    done(`<div class="searchbox"><label class="sr" for="q">Search stations and places</label>${icon('search')}<input id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Station, city or country" value="${esc(lastQ)}"><button type="button" class="iconbtn" data-act="q-clear" aria-label="Clear search">${icon('x')}</button></div><div id="qres"></div>`);
    const input = $('#q');
    input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(input.value), 350); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(input.value); input.blur(); } });
    runSearch(lastQ);
  }
  let searchSeq = 0;
  async function runSearch(q) {
    q = q.trim(); lastQ = q; store.set('q', q);
    const out = $('#qres');
    if (!out) return;
    const seq = ++searchSeq;
    if (q.length < 2) { out.innerHTML = '<div class="empty"><b>Search 50,000 stations</b>Type at least 2 letters: a station (“Suno”), a city (“Kochi”) or a country.</div>'; return; }
    const nq = q.toLowerCase();
    const places = S.places.filter((p) => p.name.toLowerCase().includes(nq) || (S.ccName[p.cc] || '').toLowerCase() === nq).sort((a, b) => b.count - a.count).slice(0, 8);
    const placeHtml = places.length ? sec('Places') + places.map((p) => `<button type="button" class="row" data-act="place" data-p="${p.i}"><span class="art">${p.count}</span><div class="meta"><div class="t1">${esc(p.name)}</div><div class="t2">${esc([p.state, S.ccName[p.cc]].filter(Boolean).join(', '))}</div></div>${icon('right')}</button>`).join('') : '';
    out.innerHTML = placeHtml + sec('Stations') + loadingRow('Searching…');
    try {
      const rows = await api(`/json/stations/search?name=${encodeURIComponent(q)}&order=clickcount&reverse=true&hidebroken=true&limit=80`);
      if (seq !== searchSeq) return;
      const list = dedupe(rows.map(fromApi)).filter(visible);
      out.innerHTML = placeHtml + sec(`Stations (${list.length})`) + (list.length ? stationRows(list, 'Search: ' + q) : `<div class="empty"><b>No station named “${esc(q)}”</b>Check the spelling, or try a shorter word.</div>`);
    } catch (e) {
      if (seq !== searchSeq) return;
      out.innerHTML = placeHtml + sec('Stations') + errorBox(e.message, 'retry-search');
    }
  }

  // Settings
  function renderSettings(done) {
    const theme = curTheme();
    const lite = document.body.classList.contains('lite');
    const a = S.alarm;
    const sw = (act, on, label, sub) => `<button type="button" class="setrow" data-act="${act}" role="switch" aria-checked="${on}"><span><span>${label}</span>${sub ? `<br><span class="sub">${sub}</span>` : ''}</span><span class="switch" aria-checked="${on}"><span class="track"><span class="knob"></span></span></span></button>`;
    const row = (act, label, sub, right) => `<button type="button" class="setrow" data-act="${act}"><span><span>${label}</span>${sub ? `<br><span class="sub">${sub}</span>` : ''}</span>${right || icon('right')}</button>`;
    const m = S.meta || {};
    done(sec('Listening')
      + row('sleep', `${icon('moon')} Sleep timer`, S.sleepEnd ? 'Stops in ' + mmss(S.sleepEnd - Date.now()) : 'Off')
      + row('alarm', `${icon('alarm')} Wake-up alarm`, a && a.on ? `${time12(a.time)} · ${esc(a.station.name)} · ${a.daily ? 'every day' : 'once'}` : 'Off')
      + sw('auto-skip', S.autoSkip, 'Skip stations that are not responding', 'Moves to the next station in the list after one retry')
      + sw('https-only', S.httpsOnly, 'Hide stations with old links', 'Old insecure links cannot play inside the app; they open in a new tab')
      + sec('Display')
      + sw('theme', theme === 'dark', 'Dark theme', 'Follows your device until you change it')
      + sw('lite', lite, 'Lite mode (no globe)', 'For slow phones and to save mobile data')
      + sec('Your data')
      + row('backup', `${icon('dl')} Download backup`, `${S.favs.length} favourites, ${S.history.length} recently played, settings`)
      + row('restore', `${icon('ul')} Restore from backup`, 'Adds the backup to what is here; nothing is deleted')
      + row('unhide', `${icon('hide')} Hidden stations`, S.hidden.length ? `${S.hidden.length} hidden · tap to show them all again` : 'None hidden', S.hidden.length ? '<span class="chip">Show all</span>' : '')
      + (isInstalled() ? '' : row('install', 'Install app', isIOS() ? 'iPhone: Share → Add to Home Screen' : 'Open it from your home screen like any app'))
      + (isPhone() ? '' : sec('Keyboard shortcuts') + '<div class="kbd"><kbd>Space</kbd><span>Play / pause</span><kbd>← →</kbd><span>Previous / next station</span><kbd>↑ ↓</kbd><span>Volume</span><kbd>M</kbd><span>Mute</span><kbd>F</kbd><span>Favourite</span><kbd>R</kbd><span>Surprise me</span><kbd>/</kbd><span>Search</span><kbd>Esc</kbd><span>Close</span></div>')
      + sec('About')
      + `<div class="about"><img src="img/logo-${theme === 'dark' ? 'dark' : 'light'}.png" alt="India Business International"><b style="color:var(--text)">IBI Audios &amp; Radios ${VERSION}</b><br>
        ${(m.stations || 0).toLocaleString('en-IN')} stations in ${(m.places || 0).toLocaleString('en-IN')} places, ${S.countries.length} countries.<br>
        Station map updated ${m.built ? fmtDate(m.built) : '—'} (refreshed every night).<br><br>
        Stations: <a href="https://www.radio-browser.info/" target="_blank" rel="noopener">Radio Browser</a>, a free community directory. City list: <a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0). Earth image: NASA Blue Marble.<br><br>
        Each station and its audio belong to its broadcaster. This app only links to streams that the broadcasters make public; it does not host, record or rebroadcast any audio. To report a station, contact India Business International at indiabusinessinternational@gmail.com.<br><br>
        © India Business International. Favourites, history and settings stay on this device; nothing is sent to us.</div>`);
  }

  // ---------- favourites / history / hidden ----------
  const isFav = (s) => !!s && S.favs.some((f) => f.id === s.id);
  function toggleFav(s) {
    if (!s) { toast('Play a station first, then tap ♥.'); return; }
    if (isFav(s)) {
      const ix = S.favs.findIndex((f) => f.id === s.id);
      const removed = S.favs.splice(ix, 1)[0];
      store.set('favs', S.favs);
      toast(`Removed “${s.name}” from favourites.`, 'Undo', () => { S.favs.splice(ix, 0, removed); store.set('favs', S.favs); refreshAll(); });
    } else {
      S.favs.unshift(slim(s));
      store.set('favs', S.favs);
      toast(`Added “${s.name}” to favourites.`);
    }
    refreshAll();
  }
  function addHistory(s) {
    S.history = [{ t: Date.now(), s: slim(s) }, ...S.history.filter((h) => h.s.id !== s.id)].slice(0, 100);
    store.set('history', S.history);
  }
  function hideStation(s) {
    S.hidden.push(s.id); store.set('hidden', S.hidden);
    toast(`“${s.name}” is hidden on this device.`, 'Undo', () => { S.hidden = S.hidden.filter((x) => x !== s.id); store.set('hidden', S.hidden); refreshAll(); });
    if (S.current && S.current.id === s.id) next(true);
    refreshAll();
  }
  function refreshAll() { renderView(); paintMini(); if (fullEl) paintFull(); }

  // ---------- player ----------
  let hls = null, playToken = 0, stallTimer = 0, retries = 0, autoSkips = 0, hlsLib = null;
  function loadHls() {
    if (hlsLib) return hlsLib;
    hlsLib = new Promise((res) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.light.min.js';
      s.onload = () => res(window.Hls || null);
      s.onerror = () => { hlsLib = null; res(null); };
      document.head.appendChild(s);
    });
    return hlsLib;
  }
  function play(s, ctx, ix, label) {
    if (!s) return;
    S.ctx = ctx && ctx.length ? ctx : [s];
    S.ctxIx = ix != null ? ix : Math.max(0, S.ctx.findIndex((x) => x.id === s.id));
    S.ctxLabel = label || '';
    S.current = s;
    retries = 0;
    addHistory(s);
    setHash(`#s=${s.cc || 'XX'}.${s.id}`);
    store.set('last', slim(s));
    startStream(s);
    countClick(s);
    mediaMeta(s);
    refreshAll();
  }
  function setStatus(st) {
    S.status = st;
    paintMini();
    if (fullEl) paintFullStatus();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = (st === 'live' || st === 'buffering' || st === 'connecting') ? 'playing' : 'paused';
  }
  function stopStream() {
    clearTimeout(stallTimer);
    if (hls) { try { hls.destroy(); } catch (e) { /* already gone */ } hls = null; }
    audio.pause();
    audio.removeAttribute('src');
    try { audio.load(); } catch (e) { /* nothing loaded */ }
  }
  function startStream(s) {
    const tok = ++playToken;
    stopStream();
    lastT = 0;
    let url = s.url;
    S.upgraded = false;
    if (!playsHere(s)) { url = 'https:' + url.slice(url.indexOf(':') + 1); S.upgraded = true; }
    setStatus('connecting');
    applyVolume();
    const isHls = s.hls || /\.m3u8(\?|$)/i.test(url);
    if (isHls && !audio.canPlayType('application/vnd.apple.mpegurl')) {
      loadHls().then((H) => {
        if (tok !== playToken) return;
        if (!H || !H.isSupported()) { fail(tok); return; }
        hls = new H({ lowLatencyMode: false, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 2 });
        hls.on(H.Events.ERROR, (ev, d) => { if (d && d.fatal) fail(tok); });
        hls.loadSource(url);
        hls.attachMedia(audio);
        audio.play().catch((e) => rejected(tok, e));
      });
    } else {
      audio.src = url;
      audio.play().catch((e) => rejected(tok, e));
    }
    stallTimer = setTimeout(() => { if (tok === playToken && S.status === 'connecting') fail(tok); }, 15000);
  }
  function rejected(tok, e) {
    if (tok !== playToken) return;
    if (e && e.name === 'NotAllowedError') { clearTimeout(stallTimer); stopStream(); setStatus('paused'); toast('Tap ▶ to start the radio.'); return; }
    if (e && e.name === 'AbortError') return;
    fail(tok);
  }
  function fail(tok) {
    if (tok !== playToken) return;
    clearTimeout(stallTimer);
    const s = S.current;
    if (!s) return;
    if (S.upgraded) { stopStream(); setStatus('http'); return; }
    if (retries < 1) { retries++; startStream(s); return; }
    stopStream();
    setStatus('error');
    if (S.autoSkip && S.ctx.length > 1 && autoSkips < 3) {
      autoSkips++;
      toast(`“${s.name}” is not responding. Playing the next station.`);
      setTimeout(() => { if (S.status === 'error' && S.current === s) next(true); }, 1200);
    }
  }
  audio.addEventListener('playing', () => { clearTimeout(stallTimer); retries = 0; autoSkips = 0; setStatus('live'); });
  audio.addEventListener('waiting', () => { if (S.status === 'live') setStatus('buffering'); });
  audio.addEventListener('pause', () => { if (S.status === 'live' || S.status === 'buffering') setStatus('paused'); });
  audio.addEventListener('error', () => { if (audio.getAttribute('src') && !hls) fail(playToken); });
  audio.addEventListener('stalled', () => { if (S.status === 'live') setStatus('buffering'); });
  let lastT = 0;   // some streams resume after a stall without a new "playing" event: moving time means live
  audio.addEventListener('timeupdate', () => {
    if ((S.status === 'buffering' || S.status === 'connecting') && !audio.paused && audio.currentTime > lastT + 0.4) { clearTimeout(stallTimer); setStatus('live'); }
    lastT = audio.currentTime;
  });

  function togglePlay() {
    const s = S.current;
    if (!s) {
      const first = view.querySelector('[data-act="play"]');
      if (first) { first.click(); return; }
      toast('Choose a station first.');
      return;
    }
    if (S.status === 'http') { openExternal(s); return; }
    if (S.status === 'live' || S.status === 'buffering' || S.status === 'connecting') { playToken++; stopStream(); setStatus('paused'); return; }
    retries = 0;
    startStream(s);
  }
  function openExternal(s) {
    window.open(s.url, '_blank', 'noopener');
    toast('Opened the stream in a new tab. Use that tab to stop it.');
  }
  function next(auto) { step(1, auto); }
  function prev() { step(-1); }
  function step(d, auto) {
    const ctx = S.ctx.filter(visible);
    if (!S.current || ctx.length < 2) { if (!auto) toast('No other station in this list.'); return; }
    let i = ctx.findIndex((x) => x.id === S.current.id);
    i = ((i < 0 ? 0 : i + d) + ctx.length) % ctx.length;
    const keep = autoSkips;
    play(ctx[i], ctx, i, S.ctxLabel);
    if (auto) autoSkips = keep;
  }
  function countClick(s) { api('/json/url/' + encodeURIComponent(s.id)).catch(() => {}); }
  function applyVolume() {
    let v = S.muted ? 0 : S.vol / 100;
    if (S.sleepEnd) { const left = (S.sleepEnd - Date.now()) / 1000; if (left < 60) v *= Math.max(0, left / 60); }
    if (alarmRamp) v *= alarmRamp();
    audio.volume = Math.max(0, Math.min(1, v));
  }
  function setVol(v) {
    S.vol = Math.max(0, Math.min(100, Math.round(v)));
    S.muted = false;
    store.set('vol', S.vol);
    $('#miniVol').value = S.vol;
    const fv = fullEl && fullEl.querySelector('#fullVol');
    if (fv) fv.value = S.vol;
    applyVolume();
  }

  // media session: lock screen, headset, car
  function mediaMeta(s) {
    if (!('mediaSession' in navigator)) return;
    const artwork = [];
    if (s.fav) artwork.push({ src: s.fav.replace(/^http:/i, 'https:'), sizes: '512x512' });
    artwork.push({ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' });
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: s.name, artist: whereOf(s) || 'Live radio', album: 'IBI Audios & Radios', artwork }); } catch (e) { /* old browser */ }
  }
  if ('mediaSession' in navigator) {
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* unsupported action */ } };
    h('play', () => { if (S.status !== 'live') togglePlay(); });
    h('pause', () => { if (S.status === 'live' || S.status === 'buffering') togglePlay(); });
    h('stop', () => { playToken++; stopStream(); setStatus('paused'); });
    h('previoustrack', () => prev());
    h('nexttrack', () => next());
  }

  // mini player
  const statusText = () => ({
    idle: 'Tap ▶ to listen live', connecting: 'Connecting…', buffering: 'Buffering…', live: '<span class="st-live">● Live</span>', paused: 'Paused',
    error: '<span class="st-err">Not responding · tap ▶ to try again</span>', http: '<span class="st-err">Old link · tap ▶ to open in a new tab</span>',
  }[S.status] || '');
  function paintMini() {
    const s = S.current;
    const playing = S.status === 'live' || S.status === 'buffering' || S.status === 'connecting';
    $('#miniPlay').innerHTML = icon(playing ? 'pause' : 'play', 'fill');
    $('#miniPlay').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('#miniPlay').classList.toggle('busy', S.status === 'connecting' || S.status === 'buffering');
    const sleep = S.sleepEnd ? `<span class="sleepchip" title="Sleep timer">☾ ${mmss(S.sleepEnd - Date.now())}</span>` : '';
    if (!s) { $('#miniT1').textContent = 'Nothing playing'; $('#miniT2').innerHTML = 'Tap a station to listen live' + sleep; $('#miniArt').innerHTML = '♪'; }
    else {
      $('#miniT1').textContent = s.name;
      $('#miniT2').innerHTML = `${statusText()} · ${esc(whereOf(s))}${sleep}`;
      $('#miniArt').outerHTML = art(s).replace('<span class="art"', '<button type="button" class="art" id="miniArt" aria-label="Open player"').replace(/<\/span>$/, '</button>');
    }
    const fav = isFav(s);
    $('#miniFav').classList.toggle('on', fav);
    $('#miniFav').innerHTML = icon('heart', fav ? 'fill' : '');
    $('#miniFav').setAttribute('aria-pressed', String(fav));
    view.querySelectorAll('.row[data-act="play"]').forEach((r) => {
      const L = S.lists[r.dataset.l];
      const it = L && L.list[+r.dataset.i];
      r.classList.toggle('playing', !!(s && it && it.id === s.id));
    });
  }
  const mmss = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec2 = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec2).padStart(2, '0'); };

  // ---------- layers (Esc, tap outside and the phone Back button close the top one) ----------
  const layers = [];
  function openLayer(html, { modal = false, cls = '', onClose } = {}) {
    const el = document.createElement('div');
    el.className = `layer ${modal ? 'modal' : ''} ${cls}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = html;
    el.addEventListener('click', (e) => { if (e.target === el) closeLayer(); });
    document.body.appendChild(el);
    layers.push({ el, onClose });
    history.pushState({ iar: 'layer', n: layers.length }, '');
    const f = el.querySelector('[data-autofocus]') || el.querySelector('button');
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 30);
    return el;
  }
  function closeLayer() { if (layers.length) history.back(); }
  window.addEventListener('popstate', () => {
    if (layers.length) { const L = layers.pop(); L.el.remove(); if (L.onClose) L.onClose(); return; }
    if (S.expanded) collapse(true);
  });
  const sheetHead = (title, extra = '') => `<div class="sheet-h"><button type="button" class="iconbtn" data-act="close" aria-label="Close" title="Close (Esc)">${icon('x')}</button><h3>${esc(title)}</h3>${extra}</div>`;
  function confirmBox(title, text, okLabel, onOk, danger) {
    const el = openLayer(`<div class="sheet">${sheetHead(title)}<div class="sheet-b"><p style="padding:0 10px">${esc(text)}</p></div><div class="sheet-f"><button type="button" class="btn ghost" data-act="close">Cancel</button><button type="button" class="btn ${danger ? 'danger' : ''}" id="okBtn">${esc(okLabel)}</button></div></div>`, { modal: true });
    el.querySelector('#okBtn').onclick = () => { closeLayer(); onOk(); };
  }

  // full player
  let fullEl = null;
  function openFull() {
    if (!S.current) { toast('Tap a station to listen live.'); return; }
    if (fullEl) return;
    fullEl = openLayer('<div class="sheet"></div>', { cls: 'full', onClose: () => { fullEl = null; } });
    paintFull();
  }
  function paintFull() {
    if (!fullEl) return;
    const s = S.current;
    if (!s) { closeLayer(); return; }
    const fav = isFav(s);
    const ctx = S.ctx.filter(visible);
    const i = ctx.findIndex((x) => x.id === s.id);
    const a = S.alarm;
    fullEl.querySelector('.sheet').innerHTML = sheetHead('Now playing', `<button type="button" class="iconbtn" data-act="share" aria-label="Share">${icon('share')}</button>`)
      + `<div class="sheet-b"><div class="hero">${art(s, true)}<div class="fn">${esc(s.name)}</div><div class="fp">${esc(whereOf(s))}${s.lang ? ' · ' + esc(cap(s.lang)) : ''}</div><div class="status" id="fullStatus"></div><div class="bdg">${badges(s)}</div></div>
        <div class="transport"><button type="button" class="iconbtn" data-act="prev" aria-label="Previous station" title="Previous (←)">${icon('prev')}</button><button type="button" class="playbtn" id="fullPlay" data-act="toggle" aria-label="Play"></button><button type="button" class="iconbtn" data-act="next" aria-label="Next station" title="Next (→)">${icon('next')}</button></div>
        <div class="counter">${ctx.length > 1 && i >= 0 ? `${i + 1} / ${ctx.length}${S.ctxLabel ? ' · ' + esc(S.ctxLabel) : ''}` : ''}</div>
        <div class="fullvol">${icon('vol')}<input type="range" id="fullVol" min="0" max="100" value="${S.vol}" aria-label="Volume"></div>
        <div class="actions">
          <button type="button" class="act-b ${fav ? 'on' : ''}" data-act="fav-current" aria-pressed="${fav}">${icon('heart', fav ? 'fill' : '')}${fav ? 'Favourite' : 'Add favourite'}</button>
          <button type="button" class="act-b" data-act="share">${icon('share')}Share</button>
          <button type="button" class="act-b ${S.sleepEnd ? 'on' : ''}" data-act="sleep">${icon('moon')}<span id="fullSleep">${S.sleepEnd ? mmss(S.sleepEnd - Date.now()) : 'Sleep timer'}</span></button>
          <button type="button" class="act-b ${a && a.on ? 'on' : ''}" data-act="alarm">${icon('alarm')}${a && a.on ? time12(a.time) : 'Alarm'}</button>
          <button type="button" class="act-b" data-act="show-globe">${icon('explore')}On the globe</button>
          ${s.home ? `<a class="act-b" href="${esc(s.home)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">${icon('ext')}Website</a>` : ''}
          <button type="button" class="act-b" data-act="vote">${icon('thumb')}Like</button>
          <button type="button" class="act-b" data-act="hide">${icon('hide')}Hide station</button>
        </div>
        ${!playsHere(s) ? `<div class="note">This station uses an old insecure link. The app tries a secure link first; if that fails, <button type="button" class="act" data-act="external" style="color:var(--accent-text);font-weight:700">open it in a new tab ↗</button>.</div>` : ''}
        <div id="similar">${sec('Similar stations')}${loadingRow('Finding similar stations…')}</div></div>`;
    fullEl.querySelector('#fullVol').addEventListener('input', (e) => setVol(+e.target.value));
    paintFullStatus();
    similar(s).then((list) => {
      const box = fullEl && fullEl.querySelector('#similar');
      if (!box || S.current !== s) return;
      box.innerHTML = sec('Similar stations') + (list.length ? stationRows(list, 'Similar to ' + s.name) : '<div class="empty">No similar stations found.</div>');
    }).catch(() => { const box = fullEl && fullEl.querySelector('#similar'); if (box) box.innerHTML = ''; });
  }
  function paintFullStatus() {
    if (!fullEl) return;
    const st = fullEl.querySelector('#fullStatus');
    if (st) st.innerHTML = statusText();
    const b = fullEl.querySelector('#fullPlay');
    if (b) {
      const playing = S.status === 'live' || S.status === 'buffering' || S.status === 'connecting';
      b.innerHTML = icon(playing ? 'pause' : 'play', 'fill');
      b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      b.classList.toggle('busy', S.status === 'connecting' || S.status === 'buffering');
    }
    const sl = fullEl.querySelector('#fullSleep');
    if (sl) sl.textContent = S.sleepEnd ? mmss(S.sleepEnd - Date.now()) : 'Sleep timer';
  }
  async function similar(s) {
    const tags = new Set(splitList(s.tags)), langs = new Set(splitList(s.lang));
    let pool = [];
    if (s.cc) pool = await ensureCC(s.cc).catch(() => []);
    const score = (x) => splitList(x.tags).filter((t) => tags.has(t)).length * 2 + splitList(x.lang).filter((l) => langs.has(l)).length * 1.5 + Math.min(1, (x.clicks + x.votes) / 2000);
    let list = pool.filter((x) => x.id !== s.id && visible(x)).map((x) => [score(x), x]).filter((a) => a[0] >= 1.5).sort((a, b) => b[0] - a[0]).slice(0, 12).map((a) => a[1]);
    if (list.length < 4 && tags.size) {
      const rows = await api(`/json/stations/search?tag=${encodeURIComponent([...tags][0])}&order=clickcount&reverse=true&hidebroken=true&limit=20`).catch(() => []);
      list = dedupe(list.concat(rows.map(fromApi))).filter((x) => x.id !== s.id && visible(x)).slice(0, 12);
    }
    return list;
  }

  // share
  function share(s) {
    if (!s) return;
    const url = linkOf(s);
    const text = `Listen to ${s.name} (${whereOf(s)}) live on IBI Audios & Radios`;
    const el = openLayer(`<div class="sheet">${sheetHead('Share ' + s.name)}<div class="sheet-b"><div class="opts">
      <a class="act-b" href="https://wa.me/?text=${encodeURIComponent(text + ': ' + url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit" data-act="close-after">💬 WhatsApp</a>
      <button type="button" class="act-b" id="copyLink">🔗 Copy link</button>
      ${navigator.share ? '<button type="button" class="act-b" id="moreShare">⋯ More apps</button>' : ''}
    </div><div class="note" style="overflow-wrap:anywhere">${esc(url)}</div></div></div>`, { modal: true });
    el.querySelector('#copyLink').onclick = async () => {
      try { await navigator.clipboard.writeText(url); closeLayer(); toast('Link copied. It opens this station directly.'); } catch (e) { toast('Copy did not work here. Press and hold the link to copy it.'); }
    };
    const more = el.querySelector('#moreShare');
    if (more) more.onclick = () => { navigator.share({ title: s.name, text, url }).then(() => closeLayer()).catch(() => {}); };
  }

  // ---------- sleep timer ----------
  function openSleep() {
    const opts = [15, 30, 45, 60, 90, 120];
    const el = openLayer(`<div class="sheet">${sheetHead('Sleep timer')}<div class="sheet-b"><p class="note">The radio fades out over the last minute, then stops.${S.sleepEnd ? ' Now: stops in ' + mmss(S.sleepEnd - Date.now()) + '.' : ''}</p><div class="opts">
      ${opts.map((m) => `<button type="button" class="pill" data-min="${m}">${m < 60 ? m + ' min' : (m / 60) + (m === 60 ? ' hour' : ' hours')}</button>`).join('')}
      <button type="button" class="pill" data-min="0" aria-pressed="${!S.sleepEnd}">Off</button></div></div></div>`, { modal: true });
    el.querySelectorAll('[data-min]').forEach((b) => b.addEventListener('click', () => {
      const m = +b.dataset.min;
      S.sleepEnd = m ? Date.now() + m * 60000 : 0;
      applyVolume();
      closeLayer();
      toast(m ? `Sleep timer set: the radio stops in ${m} minutes.` : 'Sleep timer off.');
      refreshAll();
    }));
  }
  setInterval(() => {
    if (S.sleepEnd) {
      if (Date.now() >= S.sleepEnd) {
        S.sleepEnd = 0; playToken++; stopStream(); setStatus('paused'); applyVolume();
        toast('Sleep timer: the radio has stopped. Good night.');
      } else applyVolume();
      paintMini(); paintFullStatus();
    }
    checkAlarm();
  }, 1000);

  // ---------- alarm ----------
  let alarmRamp = null, wakeLock = null, lastAlarmKey = store.get('alarmLast', '');
  function openAlarm() {
    const a = S.alarm || { time: '06:30', daily: true, wake: true, on: false, station: S.current ? slim(S.current) : (S.favs[0] || null) };
    const choices = dedupe([...(S.current ? [slim(S.current)] : []), ...S.favs, ...(a.station ? [a.station] : [])]);
    const el = openLayer(`<div class="sheet">${sheetHead('Wake-up alarm')}<div class="sheet-b">
      <div class="field"><label for="alTime">Time</label><input type="time" id="alTime" value="${esc(a.time)}" required data-autofocus></div>
      <div class="field"><label for="alSt">Station</label>${choices.length ? `<select id="alSt">${choices.map((c) => `<option value="${esc(c.id)}" ${a.station && a.station.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : '<div class="err">Play a station or add a favourite first.</div>'}<div class="hint">The current station and your favourites are listed.</div></div>
      <label class="setrow"><span>Every day<br><span class="sub">Off = only the next time</span></span><input type="checkbox" id="alDaily" ${a.daily ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--accent)"></label>
      <label class="setrow"><span>Keep the screen on while the alarm is set<br><span class="sub">Phones stop web apps when the screen goes off</span></span><input type="checkbox" id="alWake" ${a.wake ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--accent)"></label>
      <p class="note">The alarm rings only while this app is open. Plug in the phone and leave the app on screen. The volume rises slowly over a minute.</p><div class="field"><div class="err" id="alErr"></div></div>
      </div><div class="sheet-f">${S.alarm && S.alarm.on ? '<button type="button" class="btn ghost" id="alOff">Turn off</button>' : '<button type="button" class="btn ghost" data-act="close">Cancel</button>'}<button type="button" class="btn" id="alSave">Set alarm</button></div></div>`, { modal: true });
    const save = () => {
      const t = el.querySelector('#alTime').value;
      const sel = el.querySelector('#alSt');
      if (!t) { el.querySelector('#alErr').textContent = 'Choose a time.'; return; }
      if (!sel) { el.querySelector('#alErr').textContent = 'Choose a station: play one or add a favourite first.'; return; }
      const st = choices.find((c) => c.id === sel.value);
      S.alarm = { on: true, time: t, daily: el.querySelector('#alDaily').checked, wake: el.querySelector('#alWake').checked, station: st };
      store.set('alarm', S.alarm);
      lastAlarmKey = ''; store.set('alarmLast', '');
      closeLayer();
      toast(`Alarm set for ${time12(t)}: ${st.name}. Keep this app open.`);
      syncWakeLock();
      refreshAll();
    };
    el.querySelector('#alSave').onclick = save;
    el.querySelector('#alTime').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    const off = el.querySelector('#alOff');
    if (off) off.onclick = () => { S.alarm.on = false; store.set('alarm', S.alarm); closeLayer(); toast('Alarm turned off.'); syncWakeLock(); refreshAll(); };
  }
  function checkAlarm() {
    const a = S.alarm;
    if (!a || !a.on) return;
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const key = now.toDateString() + ' ' + a.time;
    if (hhmm !== a.time || lastAlarmKey === key) return;
    lastAlarmKey = key; store.set('alarmLast', key);
    if (!a.daily) { a.on = false; store.set('alarm', a); syncWakeLock(); }
    const started = Date.now();
    alarmRamp = () => { const f = Math.min(1, 0.1 + (Date.now() - started) / 60000); if (f >= 1) alarmRamp = null; return f; };
    play(a.station, [a.station], 0, 'Alarm');
    const el = openLayer(`<div class="sheet">${sheetHead('Alarm')}<div class="sheet-b"><div class="big">${time12(a.time)}</div><p style="text-align:center;padding:0 10px">${esc(a.station.name)}</p></div>
      <div class="sheet-f"><button type="button" class="btn ghost" id="alSnooze">Snooze 10 min</button><button type="button" class="btn" id="alStop">Stop</button></div></div>`, { modal: true, cls: 'alarmfire' });
    el.querySelector('#alStop').onclick = () => { alarmRamp = null; playToken++; stopStream(); setStatus('paused'); closeLayer(); };
    el.querySelector('#alSnooze').onclick = () => {
      alarmRamp = null; playToken++; stopStream(); setStatus('paused'); closeLayer();
      const t = new Date(Date.now() + 10 * 60000);
      S.alarm = { ...a, on: true, daily: false, time: String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'), snoozeOf: a.snoozeOf || a };
      store.set('alarm', S.alarm);
      toast('Snoozed for 10 minutes.');
    };
    if (a.snoozeOf && a.snoozeOf.daily) { S.alarm = { ...a.snoozeOf, on: true }; store.set('alarm', S.alarm); }
  }
  async function syncWakeLock() {
    const want = S.alarm && S.alarm.on && S.alarm.wake && document.visibilityState === 'visible';
    try {
      if (want && !wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => { syncWakeLock(); checkAlarm(); });

  // ---------- backup / restore ----------
  function backup() {
    const data = { kind: 'iar-backup', app: 'IBI Audios & Radios', version: VERSION, saved: new Date().toISOString(), favs: S.favs, history: S.history, hidden: S.hidden, alarm: S.alarm,
      settings: { theme: localStorage.getItem('iar:theme'), lite: document.body.classList.contains('lite'), httpsOnly: S.httpsOnly, autoSkip: S.autoSkip, vol: S.vol } };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `IBI Audios & Radios backup ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Backup downloaded. Keep the file to restore on any phone or computer.');
  }
  const okStation = (s) => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.url === 'string' && /^https?:/i.test(s.url);
  $('#restoreFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let d;
    try { d = JSON.parse(await f.text()); } catch (err) { toast('That file is not an IBI Audios & Radios backup.'); return; }
    if (!d || d.kind !== 'iar-backup' || !Array.isArray(d.favs)) { toast('That file is not an IBI Audios & Radios backup.'); return; }
    const favs = d.favs.filter(okStation);
    const hist = Array.isArray(d.history) ? d.history.filter((h) => h && okStation(h.s) && typeof h.t === 'number') : [];
    confirmBox('Restore from backup', `This backup from ${d.saved ? fmtDate(d.saved) : 'an earlier date'} has ${favs.length} favourites and ${hist.length} recently played. They will be added to what is here; nothing is deleted.`, 'Restore', () => {
      const have = new Set(S.favs.map((x) => x.id));
      const add = favs.filter((x) => !have.has(x.id)).map((x) => ({ ...x, pid: -1 }));
      S.favs = S.favs.concat(add); store.set('favs', S.favs);
      const seen = new Set();
      S.history = S.history.concat(hist).sort((a, b) => b.t - a.t).filter((h) => !seen.has(h.s.id) && seen.add(h.s.id)).slice(0, 100); store.set('history', S.history);
      if (Array.isArray(d.hidden)) { S.hidden = [...new Set(S.hidden.concat(d.hidden.filter((x) => typeof x === 'string')))]; store.set('hidden', S.hidden); }
      if (d.alarm && okStation(d.alarm.station) && !S.alarm) { S.alarm = { ...d.alarm, on: false }; store.set('alarm', S.alarm); }
      toast(`Restored: ${add.length} favourites added (${favs.length - add.length} were already here).`);
      refreshAll();
    });
  });

  // ---------- theme / lite ----------
  const curTheme = () => document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  function paintTheme() {
    const dark = curTheme() === 'dark';
    const b = $('#themeTop');
    b.setAttribute('aria-checked', String(dark));
    b.querySelector('.lab').textContent = dark ? 'Dark' : 'Light';
    $('meta[name="theme-color"]').content = dark ? '#04070c' : '#e9f0f7';
  }
  function toggleTheme() {
    const n = curTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', n);
    try { localStorage.setItem('iar:theme', n); } catch (e) { /* private mode */ }
    paintTheme();
    if (S.tab === 'settings') renderView();
  }
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', paintTheme);
  function setLite(on) {
    document.body.classList.toggle('lite', on);
    try { localStorage.setItem('iar:lite', on ? '1' : '0'); } catch (e) { /* private mode */ }
    if (on && S.expanded) collapse(false);
    if (!on && !G) { initGlobe(); setGlobeMsg(''); const p = S.places[S.place]; if (p && G) { G.ringsData([p]); G.pointOfView({ lat: p.lat, lng: p.lng, altitude: 1.6 }, 0); } paintFilter(); }
    if (on) setGlobeMsg('');
    renderView();
    setTimeout(measureSheet, 50);
  }

  // ---------- install (PWA) ----------
  let deferredPrompt = null;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function paintInstall() {
    const can = !isInstalled() && (deferredPrompt || isIOS());
    $('#installTop').hidden = !can;
    const dismissed = store.get('installDismissed', 0);
    const show = can && Date.now() - dismissed > 86400000 && !layers.length;
    $('#installBanner').hidden = !show;
    if (isIOS()) $('#installBannerText').textContent = 'On iPhone: tap Share, then “Add to Home Screen”.';
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; paintInstall(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; paintInstall(); toast('Installed. Open IBI Audios & Radios from your home screen.'); });
  async function doInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) { /* dismissed */ }
      deferredPrompt = null;
      $('#installBanner').hidden = true;
      paintInstall();
    } else if (isIOS()) {
      openLayer(`<div class="sheet">${sheetHead('Install on iPhone or iPad')}<div class="sheet-b"><ol style="padding:0 10px 0 34px;line-height:1.8"><li>Tap the <b>Share</b> button in Safari (the square with an arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>.</li></ol></div></div>`, { modal: true });
    } else if (isInstalled()) toast('Already installed.');
    else toast('Open your browser menu (⋮) and choose “Install app”.');
  }

  // ---------- surprise / locate ----------
  async function surprise() {
    const ps = shownPlaces();
    if (!ps.length) return;
    const p = ps[Math.floor(Math.random() * Math.min(ps.length, 600))];
    selectPlace(p.i, { fly: true });
    try {
      const list = await placeStations(p);
      const playable = list.filter(playsHere);
      const pool = playable.length ? playable : list;
      if (pool.length) { const k = Math.floor(Math.random() * pool.length); play(pool[k], pool, k, p.name); }
    } catch (e) { toast('Could not load that place. Try again.'); }
  }
  function locate() {
    if (!navigator.geolocation) { toast('This browser cannot share your location. Spin the globe instead.'); return; }
    $('#fabLocate').classList.add('on');
    navigator.geolocation.getCurrentPosition((pos) => {
      $('#fabLocate').classList.remove('on');
      const p = nearestPlace(pos.coords.latitude, pos.coords.longitude);
      if (p) { selectPlace(p.i, { fly: true }); if (G) G.pointOfView({ lat: p.lat, lng: p.lng, altitude: 0.6 }, 900); setTab('explore'); toast(`Nearest stations: ${p.name}.`); }
    }, () => { $('#fabLocate').classList.remove('on'); toast('Location is off. Allow location for this site, or spin the globe.'); }, { timeout: 12000, maximumAge: 600000 });
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    const L = t.dataset.l ? S.lists[t.dataset.l] : null;
    const item = L ? L.list[+t.dataset.i] : null;
    switch (act) {
      case 'play':
        if (item) {
          if (S.current && S.current.id === item.id && S.status !== 'error' && S.status !== 'http') { openFull(); return; }
          play(item, L.list, +t.dataset.i, L.label);
          if (fullEl && t.closest('.full')) paintFull();
        }
        break;
      case 'fav': e.stopPropagation(); toggleFav(item); break;
      case 'place': { const p = S.places[+t.dataset.p]; selectPlace(p.i, { fly: true }); if (S.tab !== 'explore') setTab('explore'); break; }
      case 'seg': S.favSeg = t.dataset.seg; renderView(); break;
      case 'clear-history': confirmBox('Clear history', `Remove all ${S.history.length} recently played stations from this device?`, 'Clear history', () => { const old = S.history; S.history = []; store.set('history', []); renderView(); toast('History cleared.', 'Undo', () => { S.history = old; store.set('history', old); renderView(); }); }, true); break;
      case 'lang': {
        const v = t.dataset.v;
        if (!v || (S.filter && S.filter.value === v)) { setFilter(null); S.browse = null; }
        else { setFilter(v); S.browse = { type: 'lang', value: v, label: `Top ${cap(v)} stations` }; }
        renderView(); break;
      }
      case 'genre': { const v = t.dataset.v; S.browse = S.browse && S.browse.type === 'genre' && S.browse.value === v ? null : { type: 'genre', value: v, label: `${cap(v)}${S.indiaOnly ? ' · India' : ''}` }; renderView(); break; }
      case 'india-only': S.indiaOnly = !S.indiaOnly; if (S.browse && S.browse.type !== 'lang' && S.browse.type !== 'country') S.browse.label = S.browse.label.replace(/ · India$/, '') + (S.indiaOnly ? ' · India' : ''); renderView(); break;
      case 'popular': S.browse = S.browse && S.browse.type === 'popular' ? null : { type: 'popular', label: 'Trending now' }; renderView(); break;
      case 'top': S.browse = S.browse && S.browse.type === 'top' ? null : { type: 'top', label: 'Most played' }; renderView(); break;
      case 'country': {
        const cc = t.dataset.cc;
        S.browse = { type: 'country', value: cc, label: `Top stations in ${S.ccName[cc]}` };
        const best = S.places.filter((p) => p.cc === cc).sort((a, b) => b.count - a.count)[0];
        if (best && G) { flyTo(best, 1.4); selectPlace(best.i, { keepHash: true }); }
        renderView(); view.scrollTop = 0; break;
      }
      case 'browse-clear': S.browse = null; renderView(); break;
      case 'retry-view': renderView(); break;
      case 'retry-search': runSearch(lastQ); break;
      case 'q-clear': { const i = $('#q'); if (i) { i.value = ''; i.focus(); } runSearch(''); break; }
      case 'sleep': openSleep(); break;
      case 'alarm': openAlarm(); break;
      case 'auto-skip': S.autoSkip = !S.autoSkip; store.set('autoSkip', S.autoSkip); renderView(); break;
      case 'https-only': S.httpsOnly = !S.httpsOnly; store.set('httpsOnly', S.httpsOnly); renderView(); paintPlaceHead(); break;
      case 'theme': toggleTheme(); break;
      case 'lite': setLite(!document.body.classList.contains('lite')); break;
      case 'backup': backup(); break;
      case 'restore': $('#restoreFile').click(); break;
      case 'unhide': if (S.hidden.length) { const old = S.hidden; S.hidden = []; store.set('hidden', []); toast(`${old.length} hidden stations are back.`, 'Undo', () => { S.hidden = old; store.set('hidden', old); refreshAll(); }); refreshAll(); } else toast('No hidden stations. Use “Hide station” in the player to hide one.'); break;
      case 'install': doInstall(); break;
      case 'close': closeLayer(); break;
      case 'close-after': setTimeout(closeLayer, 300); break;
      case 'share': share(S.current); break;
      case 'prev': prev(); break;
      case 'next': next(); break;
      case 'toggle': togglePlay(); break;
      case 'fav-current': toggleFav(S.current); break;
      case 'external': openExternal(S.current); break;
      case 'vote': api('/json/vote/' + encodeURIComponent(S.current.id)).then((r) => toast(r && r.ok ? `Thanks! Your like for “${S.current.name}” is counted.` : 'Already liked recently. Thank you!')).catch(() => toast('Could not send the like. Try again later.')); break;
      case 'hide': { const s = S.current; confirmBox('Hide station', `Hide “${s.name}” on this device? You can show it again in Settings.`, 'Hide', () => { closeLayer(); setTimeout(() => hideStation(s), 50); }); break; }
      case 'show-globe': showOnGlobe(S.current); break;
      default: break;
    }
  });
  document.addEventListener('keydown', (e) => {
    const tg = e.target instanceof Element ? e.target : document.body;
    if ((e.key === 'Enter' || e.key === ' ') && tg.matches('.row[data-act="play"]')) { e.preventDefault(); tg.click(); return; }
    if (tg.matches('input, select, textarea')) { if (e.key === 'Escape') tg.blur(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'Escape') { if (layers.length) closeLayer(); else if (S.expanded) collapse(false); return; }
    if (layers.length && !fullEl) return;
    if (k === ' ' && !tg.matches('button, a, [role="button"]')) { e.preventDefault(); togglePlay(); }
    else if (k === 'ArrowRight') next();
    else if (k === 'ArrowLeft') prev();
    else if (k === 'ArrowUp') { e.preventDefault(); setVol(S.vol + 5); }
    else if (k === 'ArrowDown') { e.preventDefault(); setVol(S.vol - 5); }
    else if (k === 'm' || k === 'M') { S.muted = !S.muted; applyVolume(); toast(S.muted ? 'Muted' : 'Sound on', '', null, 1200); }
    else if (k === 'f' || k === 'F') toggleFav(S.current);
    else if (k === 'r' || k === 'R') surprise();
    else if (k === '/') { e.preventDefault(); setTab('search'); }
  });
  async function showOnGlobe(s) {
    if (!s) return;
    if (s.pid < 0 && s.cc) { try { await ensureCC(s.cc); const k = S.byId.get(s.id); if (k) s = k; } catch (e) { /* use country */ } }
    let p = s.pid >= 0 ? S.places[s.pid] : null;
    if (!p) p = S.places.filter((q) => q.cc === s.cc).sort((a, b) => b.count - a.count)[0];
    if (!p) { toast('This station has no place on the map.'); return; }
    if (S.filter && !stationMatchesFilter(s)) setFilter(null);
    if (layers.length) closeLayer();
    if (document.body.classList.contains('lite')) setLite(false);
    selectPlace(p.i, { fly: true, keepHash: true });
    setTab('explore', { open: false });
  }

  $('#themeTop').addEventListener('click', toggleTheme);
  $('#installTop').addEventListener('click', doInstall);
  $('#installBannerBtn').addEventListener('click', doInstall);
  $('#installBannerX').addEventListener('click', () => { store.set('installDismissed', Date.now()); $('#installBanner').hidden = true; });
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#placeOpen').addEventListener('click', () => setTab('explore'));
  $('#placeCount').addEventListener('click', () => setTab('explore'));
  $('#collapseBtn').addEventListener('click', () => collapse(false));
  $('#filterClear').addEventListener('click', () => { setFilter(null); S.browse = null; renderView(); });
  $('#mini').addEventListener('click', (e) => { if (e.target.closest('#miniArt, #miniMeta')) openFull(); });
  $('#miniPlay').addEventListener('click', togglePlay);
  $('#miniNext').addEventListener('click', () => next());
  $('#miniPrev').addEventListener('click', () => prev());
  $('#miniFav').addEventListener('click', () => toggleFav(S.current));
  $('#miniVol').addEventListener('input', (e) => setVol(+e.target.value));
  $('#fabRandom').addEventListener('click', surprise);
  $('#fabLocate').addEventListener('click', locate);
  $('#fabIn').addEventListener('click', () => { if (G) G.pointOfView({ altitude: Math.max(0.12, G.pointOfView().altitude * 0.6) }, 400); });
  $('#fabOut').addEventListener('click', () => { if (G) G.pointOfView({ altitude: Math.min(4.2, G.pointOfView().altitude / 0.6) }, 400); });
  (() => { // drag the grab handle: up opens the list, down closes it; a tap toggles
    let y0 = null;
    const grab = $('#grab');
    grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; grab.setPointerCapture(e.pointerId); });
    grab.addEventListener('pointerup', (e) => {
      if (y0 == null) return;
      const dy = e.clientY - y0; y0 = null;
      if (dy < -20 || (Math.abs(dy) < 8 && !S.expanded)) expand(); else if (dy > 20 || (Math.abs(dy) < 8 && S.expanded)) collapse(false);
    });
  })();
  const online = () => { $('#offlineBar').hidden = navigator.onLine; };
  addEventListener('online', online); addEventListener('offline', online);
  addEventListener('resize', () => { if (!isPhone() && S.expanded) { S.expanded = false; panel.classList.remove('expanded'); } measureSheet(); });

  // ---------- start ----------
  async function boot() {
    if (!(await loadData())) return;
    if (document.documentElement.classList.contains('lite-boot')) document.body.classList.add('lite');
    initGlobe();
    if (G || document.body.classList.contains('lite')) setGlobeMsg('');
    const f = store.get('filter', null);
    if (f && S.langs.includes(f)) S.filter = { value: f, ix: S.langs.indexOf(f), label: cap(f) };
    paintFilter();
    // what to show first: a shared link, else the last place, else the default Malayalam station in Kochi
    const h = location.hash;
    let start = null, startPlace = null;
    if (h.startsWith('#s=')) {
      const [cc, id] = decodeURIComponent(h.slice(3)).split('.');
      try { await ensureCC(cc); } catch (e) { /* not in the map */ }
      start = S.byId.get(id) || null;
      if (!start) { try { const r = await api('/json/stations/byuuid/' + encodeURIComponent(id)); if (r && r[0]) start = fromApi(r[0]); } catch (e) { /* link to a removed station */ } }
      if (!start) toast('That station is no longer listed. Here is the radio of the world instead.');
    } else if (h.startsWith('#p=')) startPlace = S.placeById.get(h.slice(3)) || null;
    if (!start && !startPlace) {
      const last = store.get('last', null);   // a returning listener gets the station they played last
      if (last && okStation(last)) {
        try { await ensureCC(last.cc); } catch (e) { /* offline: use the saved copy */ }
        start = S.byId.get(last.id) || last;
      }
    }
    if (!start && !startPlace) {
      try { await ensureCC('IN'); } catch (e) { /* offline */ }
      start = S.byId.get(DEFAULT_STATION) || null;
      if (!start) {
        const kochi = S.places.find((p) => p.cc === 'IN' && p.name === DEFAULT_PLACE_NAME);
        const pool = (S.stByCC.get('IN') || []).filter((s) => splitList(s.lang).includes('malayalam') && playsHere(s));
        start = pool.find((s) => kochi && s.pid === kochi.i) || pool[0] || null;
      }
    }
    if (start) {
      S.current = start; S.ctx = [start]; S.ctxIx = 0; S.status = 'idle';
      mediaMeta(start);
      if (start.pid >= 0) startPlace = S.places[start.pid];
      else startPlace = S.places.filter((q) => q.cc === start.cc).sort((a, b) => b.count - a.count)[0] || null;
    }
    if (!startPlace) startPlace = S.places[0];
    if (G) G.pointOfView({ lat: startPlace.lat, lng: startPlace.lng, altitude: isPhone() ? 2.1 : 1.7 }, 0);
    selectPlace(startPlace.i, { keepHash: true });
    if (start) {
      setHash(`#s=${start.cc || 'XX'}.${start.id}`);
      const list = await placeStations(startPlace).catch(() => []);
      const ix = list.findIndex((x) => x.id === start.id);
      if (ix >= 0) { S.ctx = list; S.ctxIx = ix; S.ctxLabel = startPlace.name; }
    }
    paintMini();
    renderView();
    setTimeout(() => { $('#ring').classList.add('hit'); }, 300);
    measureSheet();
  }

  // first paint
  if (document.documentElement.classList.contains('lite-boot')) document.body.classList.add('lite');
  $('#miniVol').value = S.vol;
  paintTheme();
  online();
  paintMini();
  measureSheet();
  if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  setTimeout(paintInstall, 6000);
  boot();
})();
