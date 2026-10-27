# IBI Audios & Radios v1.1

Live radio from about 50,000 stations on a 3D globe, by India Business International.
Live at **https://radio.indiabusinessinternational.online** (public).

- Spin the globe and stop a city in the ring, or tap a dot. Tap a station to listen live.
- Opens on Radio Suno Malayalam 91.7 FM, Kochi (Founder's choice, 27 Oct 2026); returning listeners get their last station.
- Extras: Indian-language filters (Malayalam, Tamil, Hindi…), genres with "India only", trending and most played,
  sleep timer with fade-out, wake-up alarm, recently played, favourites with backup/restore, quality badges,
  automatic skip of dead streams, lock-screen/headset controls, similar stations, WhatsApp share links,
  keyboard shortcuts, Lite mode (no globe), light/dark theme, installable app.
- No API key, no server, no cost. Listener data stays on the device.

## How it is built
| Part | What |
|---|---|
| `index.html`, `app.css`, `app.js` | The app (globe.gl 2.46.2 and hls.js 1.7.3 from jsDelivr) |
| `scripts/build_stations.py` | Downloads every working station from [Radio Browser](https://www.radio-browser.info/) and places it on a [GeoNames](https://www.geonames.org/) city (CC BY 4.0). Writes `data/places.json` + `data/st/<CC>.json` |
| `.github/workflows/stations.yml` | On every push and every night at 3:00 AM IST: builds the station map and deploys the site to GitHub Pages. The data is never committed. |
| `img/` | NASA Blue Marble earth (public domain), IBI logos |

Local test: `python scripts/build_stations.py --cache _build_cache`, then serve the folder.
