// Собирает релизы neosten из НЕСКОЛЬКИХ источников и пишет data/auto.js.
//
// Источники (каждый независим: если один упал — остальные продолжают работать,
// а его прошлые данные берутся из старого data/auto.js):
//   1) Apple Music   — публичный iTunes API, без ключей
//   2) Deezer        — публичный API, без ключей
//   3) Яндекс Музыка — неофициальный публичный API, без ключей
//   4) Spotify       — официальный API (нужны SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET, необязательно)
//   5) links.txt     — прямые ссылки и ручные поправки названий, типов и дат
//   + song.link может дополнить метаданные при наличии ODESLI_KEY
//
// ID артиста на площадках лежат в sources.json (или в переменных окружения).
import fs from 'node:fs';
import crypto from 'node:crypto';

const OUT = 'data/auto.js';
let cfg = { name: 'neosten', apple: '1802667747', spotify: '5qNk6kVsCQa8fKahWEn9hc', deezer: '', yandex: '23866894' };
try { Object.assign(cfg, JSON.parse(fs.readFileSync('sources.json', 'utf8'))); } catch {}
for (const k of ['apple', 'spotify', 'deezer', 'yandex']) { const e = process.env[k.toUpperCase() + '_ARTIST_ID']; if (e) cfg[k] = e; }
cfg.apple = String(cfg.apple || ''); cfg.yandex = String(cfg.yandex || ''); cfg.deezer = String(cfg.deezer || '');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = t => (t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const clean = t => (t || '').replace(/\s*[-–—]\s*(Single|Сингл|EP)\s*$/i, '').trim();
const exists = p => { try { return fs.statSync(p).size > 1000; } catch { return false; } };
const isImg = b => b.length > 1000 && (b[0] === 0xff || b[0] === 0x89 || b.slice(0, 4).toString() === 'RIFF');

async function get(u, { bin = false, headers = {}, method = 'GET', body, tries = 2, timeout = 25000 } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u, { method, body, signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'Mozilla/5.0 neosten-site', ...headers } });
      if (!r.ok) throw new Error(r.status + ' ' + u);
      return bin ? Buffer.from(await r.arrayBuffer()) : await r.json();
    } catch (e) { err = e; if (i + 1 < tries) await sleep(1500); }
  }
  throw err;
}
async function img(urls, dest) {
  if (exists(dest)) return true;
  for (const u of urls.filter(Boolean)) { try { const b = await get(u, { bin: true, tries: 1 }); if (isImg(b)) { fs.writeFileSync(dest, b); return true; } } catch {} }
  console.log('cover fail:', dest); return false;
}

fs.mkdirSync('covers', { recursive: true }); fs.mkdirSync('data', { recursive: true });
let old = [];
try { old = JSON.parse(fs.readFileSync(OUT, 'utf8').replace(/^window\.AUTO=/, '').replace(/;\s*$/, '')); } catch {}
const oldByKey = new Map(old.filter(x => !x.pendingMetadata).map(x => [norm(x.title), x]));

// ================= источники: каждый возвращает [{title,type,date,covers[],links{},id}] =================
const typeOf = (n, hint) => n === 1 ? 'сингл' : hint === 'ep' || (hint === 'single' && n <= 6) ? 'EP' : n && n <= 1 ? 'сингл' : 'альбом';

async function apple() {
  let ap = [];
  for (const c of ['ru', 'us']) {
    const j = await get(`https://itunes.apple.com/lookup?id=${cfg.apple}&entity=album&country=${c}&limit=200`);
    ap = (j.results || []).filter(x => x.wrapperType === 'collection'); if (ap.length) break;
  }
  if (!ap.length) throw new Error('пустой ответ');
  return ap.map(a => {
    const name = a.collectionName || '';
    return { id: 'apple-' + a.collectionId, title: clean(name), date: (a.releaseDate || '').slice(0, 10),
      type: /\s-\s(Single|Сингл)$/i.test(name) || a.trackCount === 1 ? 'сингл' : /\s-\sEP$/i.test(name) ? 'EP' : 'альбом',
      covers: ['1000x1000', '600x600', '300x300', '100x100'].map(s => (a.artworkUrl100 || '').replace(/\d+x\d+bb/, s + 'bb')).filter(Boolean),
      links: a.collectionViewUrl ? { apple: a.collectionViewUrl } : {} };
  });
}

async function deezer(known) {
  let id = cfg.deezer;
  if (!id) {   // поиск по имени: берём только точное совпадение, и только если релизы пересекаются с уже найденными
    const s = await get('https://api.deezer.com/search/artist?q=' + encodeURIComponent(cfg.name) + '&limit=10');
    const c = (s.data || []).filter(a => norm(a.name) === norm(cfg.name)).sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0));
    for (const a of c) {
      const al = await get(`https://api.deezer.com/artist/${a.id}/albums?limit=100`);
      const ts = (al.data || []).map(x => norm(clean(x.title)));
      if (known.size ? ts.some(t => known.has(t)) : c.length === 1 && ts.length) { id = String(a.id); break; }
    }
    if (!id) throw new Error('артист не найден среди ' + c.length + ' кандидатов' + (c.length ? ': ' + c.map(a => a.id + ' ' + a.name).join(', ') : '') + ' (если артист есть на Deezer — впиши его id в sources.json)');
    console.log('deezer artist id (можно закрепить в sources.json):', id);
  }
  let url = `https://api.deezer.com/artist/${id}/albums?limit=100`, all = [];
  for (let i = 0; i < 4 && url; i++) { const j = await get(url); if (j.error) throw new Error(JSON.stringify(j.error)); all = all.concat(j.data || []); url = j.next; }
  if (!all.length) throw new Error('пустой ответ');
  return all.map(a => ({ id: 'deezer-' + a.id, title: clean(a.title), date: (a.release_date || '').slice(0, 10),
    type: a.record_type === 'single' ? 'сингл' : a.record_type === 'ep' ? 'EP' : 'альбом',
    covers: [a.cover_xl, a.cover_big, a.cover_medium].filter(Boolean), links: a.link ? { deezer: a.link.replace(/\?.*$/, '') } : {} }));
}

async function yandex() {
  if (!cfg.yandex) throw new Error('нет id');
  let j; try { j = await get(`https://api.music.yandex.net/artists/${cfg.yandex}/direct-albums?page=0&page-size=100`,
    { tries: 1, headers: { 'x-yandex-music-client': 'YandexMusicAndroid/24023231', 'accept-language': 'ru' } }); }
  catch (e) { throw new Error(/^45[01]|^403/.test(e.message) ? 'Яндекс блокирует серверы GitHub (' + e.message.slice(0, 3) + '); релизы оттуда — через links.txt' : e.message); }
  const al = (j.result && j.result.albums) || [];
  if (!al.length) throw new Error('пустой ответ');
  return al.map(a => ({ id: 'yandex-' + a.id, title: clean(a.title), date: (a.releaseDate || '').slice(0, 10),
    type: typeOf(a.trackCount, (a.type || '').toLowerCase() === 'single' ? 'single' : ''),
    covers: a.coverUri ? ['https://' + a.coverUri.replace('%%', '1000x1000'), 'https://' + a.coverUri.replace('%%', '400x400')] : [],
    links: { yandex: 'https://music.yandex.ru/album/' + a.id } }));
}

async function spotify() {
  const id = process.env.SPOTIFY_CLIENT_ID, sec = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !sec) return undefined;   // ключей нет — источник просто выключен
  const tk = await get('https://accounts.spotify.com/api/token', { method: 'POST', body: 'grant_type=client_credentials',
    headers: { authorization: 'Basic ' + Buffer.from(id + ':' + sec).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' } });
  let url = `https://api.spotify.com/v1/artists/${cfg.spotify}/albums?include_groups=album,single&market=RU&limit=50`, all = [];
  for (let i = 0; i < 4 && url; i++) { const j = await get(url, { headers: { authorization: 'Bearer ' + tk.access_token } }); all = all.concat(j.items || []); url = j.next; }
  if (!all.length) throw new Error('пустой ответ');
  return all.map(a => ({ id: 'spotify-' + a.id, title: clean(a.name), date: a.release_date_precision === 'day' ? a.release_date : '',
    type: typeOf(a.total_tracks, a.album_type), covers: (a.images || []).map(i => i.url),
    links: a.external_urls && a.external_urls.spotify ? { spotify: a.external_urls.spotify } : {} }));
}

// ================= сборка =================
const PRIO = ['apple', 'deezer', 'yandex', 'spotify', 'links'];
const items = new Map();
const put = (it, src) => {
  const k = norm(it.title); if (!k) return;
  let e = items.get(k);
  if (!e) { e = { key: k, ids: [], title: it.title, type: '', date: '', covers: [], links: {}, srcs: new Set(), page: '' }; items.set(k, e); }
  e.ids.push(it.id); e.srcs.add(src);
  if (!e.type) e.type = it.type || '';
  if (it.date && (!e.date || it.date < e.date)) e.date = it.date;     // из разных источников берём самую раннюю дату
  e.covers.push(...(it.covers || []));
  e.links = Object.assign({}, it.links, e.links);                       // у более приоритетного источника преимущество
  if (!e.page) e.page = it.page || '';
  if (it.cover) e.localCover = e.localCover || it.cover;
  if (it.enriched) e.enriched = true;
  if (it.src) e.src = it.src;
};
const carry = name => { for (const x of old) if (!x.pendingMetadata && (x.srcs || (String(x.id).startsWith('apple-') ? ['apple'] : [])).includes(name)) put({ ...x, covers: [] }, name); };

for (const name of ['apple', 'deezer', 'yandex', 'spotify']) {
  const fn = { apple, deezer, yandex, spotify }[name];
  try {
    const known = new Set([...items.keys(), ...oldByKey.keys()]);
    const r = await fn(known);
    if (r === undefined) { console.log(name + ': выключен (нет ключей)'); carry(name); continue; }
    r.forEach(x => put(x, name)); console.log(name + ':', r.length, 'релизов');
  } catch (e) { console.log(name + ' пропущен:', e.message); carry(name); }
}

// ---------- links.txt: «[дата |] ссылка [| title=Название | type=сингл | vk=ссылка ...]» ----------
// Spotify / Apple / Deezer / Яндекс читаются напрямую (song.link больше не нужен).
function webURL(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch { return null; }
}
const HOST = value => webURL(value)?.hostname.replace(/^www\./, '') || '';
const platOf = u => { const h = HOST(u);
  return h === 'open.spotify.com' ? 'spotify' : /music\.apple\.com$/.test(h) ? 'apple' : /deezer\.com$/.test(h) ? 'deezer' : /^music\.yandex\.(?:ru|com|kz|by|uz)$/.test(h) ? 'yandex'
    : /(^|\.)vk\.(com|ru)$/.test(h) ? 'vk' : h === 'music.youtube.com' ? 'youtubeMusic' : /youtube\.com$|youtu\.be$/.test(h) ? 'youtube'
    : /soundcloud\.com$/.test(h) ? 'soundcloud' : /tidal\.com$/.test(h) ? 'tidal' : ''; };
function releasePath(value) {
  const url = webURL(value);
  if (!url) return null;
  const platform = platOf(value);
  const path = url.pathname.replace(/\/$/, '');
  if (platform === 'yandex') {
    const track = path.match(/^\/(?:album\/(\d+)\/)?track\/(\d+)$/);
    if (track) return {platform, kind: 'track', id: track[2], album: track[1]};
    const album = path.match(/^\/album\/(\d+)$/);
    return album ? {platform, kind: 'album', id: album[1]} : null;
  }
  if (platform === 'spotify') {
    const match = path.match(/^\/(?:intl-[\w-]+\/)?(album|track)\/([A-Za-z0-9]+)$/);
    return match ? {platform, kind: match[1], id: match[2]} : null;
  }
  return {platform, url: url.href};
}

function linkKey(value) {
  const link = releasePath(value);
  if (!link) return '';
  return link.id ? `${link.platform}:${link.kind}:${link.id}` : link.url;
}

function releaseLinkMap(links) {
  const direct = {};
  for (const [key, url] of Object.entries(links || {})) {
    const link = releasePath(url);
    if (!link) continue;
    if (link.platform === 'spotify' || link.platform === 'yandex') direct[link.platform] = url;
    else if (key !== 'spotify' && key !== 'yandex') direct[key] = url;
  }
  return direct;
}

function yandexFields(album, track, url) {
  const cover = track?.coverUri || album.coverUri;
  return {
    title: clean(track?.title || album.title),
    type: track ? '' : typeOf(album.trackCount, (album.type || '').toLowerCase() === 'single' ? 'single' : ''),
    date: (album.releaseDate || '').slice(0, 10),
    covers: cover ? ['https://' + cover.replace('%%', '1000x1000')] : [],
    links: {yandex: url},
  };
}

async function resolveYandex(url, link) {
  const headers = {'x-yandex-music-client': 'YandexMusicAndroid/24023231'};
  const options = {tries: 1, timeout: 9000, headers};
  if (link.kind === 'album') {
    const {result} = await get(`https://api.music.yandex.net/albums/${link.id}`, options);
    return result?.title ? yandexFields(result, null, url) : null;
  }

  const id = link.album ? `${link.id}:${link.album}` : link.id;
  const {result} = await get(`https://api.music.yandex.net/tracks/${id}`, options);
  const track = Array.isArray(result) ? result[0] : result;
  if (!track?.title) return null;
  const albums = track.albums || [];
  const album = link.album ? albums.find(item => String(item.id) === link.album) : albums[0];
  if ((!album?.releaseDate || !album.coverUri) && (link.album || album?.id)) {
    try {
      const {result: full} = await get(`https://api.music.yandex.net/albums/${link.album || album.id}`, options);
      if (full) return yandexFields({
        ...full,
        releaseDate: album?.releaseDate || full.releaseDate,
        coverUri: album?.coverUri || full.coverUri,
      }, track, url);
    } catch {}
  }
  return yandexFields(album || {}, track, url);
}

let spTok = null;
async function spToken() {
  if (spTok !== null) return spTok || null;
  const id = process.env.SPOTIFY_CLIENT_ID, sec = process.env.SPOTIFY_CLIENT_SECRET; if (!id || !sec) { spTok = ''; return null; }
  try { const tk = await get('https://accounts.spotify.com/api/token', { method: 'POST', body: 'grant_type=client_credentials', tries: 1,
    headers: { authorization: 'Basic ' + Buffer.from(id + ':' + sec).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' } }); spTok = tk.access_token || ''; }
  catch (e) { console.log('spotify token:', e.message); spTok = ''; }
  return spTok || null;
}
async function resolveLink(url, manualDate) {
  const link = releasePath(url);
  if (!link) return null;
  const p = link.platform, enc = encodeURIComponent(url);
  if (p === 'spotify') {
    const m = url.match(/spotify\.com\/(?:intl-[\w-]+\/)?(album|track)\/([A-Za-z0-9]+)/); if (!m) return null;
    const canon = `https://open.spotify.com/${m[1]}/${m[2]}`, tok = await spToken();
    if (tok) { try {
      const j = await get(`https://api.spotify.com/v1/${m[1]}s/${m[2]}?market=RU`, { headers: { authorization: 'Bearer ' + tok }, tries: 1 }), al = m[1] === 'album' ? j : (j.album || {});
      return { title: m[1] === 'album' ? clean(j.name) : j.name, type: typeOf(al.total_tracks, al.album_type), date: al.release_date_precision === 'day' ? al.release_date : '', covers: (al.images || []).map(i => i.url), links: { spotify: canon } };
    } catch (e) { console.log('spotify api:', e.message); } }
    const o = await get('https://open.spotify.com/oembed?url=' + encodeURIComponent(canon), {tries: 1, timeout: 9000});   // без ключей: название + обложка
    let date = '';
    if (!manualDate) try { const r = await fetch(`https://open.spotify.com/embed/${m[1]}/${m[2]}`, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0' } });
      const d = (await r.text()).match(/"(?:releaseDate|release_date)"[^0-9]{0,80}(\d{4}-\d{2}-\d{2})/); if (d) date = d[1]; } catch {}
    const th = o.thumbnail_url || '';
    return { title: clean(o.title), type: '', date, covers: [th.replace('00001e02', '0000b273'), th].filter(Boolean), links: { spotify: canon } };
  }
  if (p === 'apple') {
    const m = url.match(/\/album\/(?:[^/?#]+\/)?(\d{5,})/), tr = (url.match(/[?&]i=(\d+)/) || [])[1], id = tr || (m && m[1]); if (!id) return null;
    for (const c of ['ru', 'us']) {
      const a = ((await get(`https://itunes.apple.com/lookup?id=${id}&country=${c}`, { tries: 1 })).results || [])[0]; if (!a) continue;
      const isT = a.wrapperType === 'track', nm = isT ? a.trackName : a.collectionName || '';
      return { title: clean(nm), type: a.trackCount === 1 ? 'сингл' : /\s-\sEP$/i.test(a.collectionName || '') ? 'EP' : isT ? '' : 'альбом', date: (a.releaseDate || '').slice(0, 10),
        covers: ['1000x1000', '600x600', '300x300'].map(z => (a.artworkUrl100 || '').replace(/\d+x\d+bb/, z + 'bb')).filter(Boolean), links: { apple: url } };
    }
    return null;
  }
  if (p === 'deezer') {
    const m = url.match(/deezer\.com\/(?:\w+\/)?(album|track)\/(\d+)/); if (!m) return null;
    const j = await get(`https://api.deezer.com/${m[1]}/${m[2]}`, { tries: 1 }); if (j.error) return null;
    const al = m[1] === 'album' ? j : (j.album || {});
    return { title: clean(m[1] === 'album' ? j.title : j.title), type: al.record_type === 'single' ? 'сингл' : al.record_type === 'ep' ? 'EP' : m[1] === 'album' ? 'альбом' : '',
      date: (j.release_date || '').slice(0, 10), covers: [al.cover_xl, al.cover_big].filter(Boolean), links: { deezer: url.replace(/\?.*$/, '') } };
  }
  if (p === 'yandex') {
    if (!process.env.ODESLI_KEY) return resolveYandex(url, link);
    try {
      const result = await resolveYandex(url, link);
      if (result) return result;
    } catch {}
  }
  if (process.env.ODESLI_KEY) {   // необязательно: ключ song.link (api.song.link) для VK и прочих площадок
    const d = await get(`https://api.song.link/v1-alpha.1/links?url=${enc}&userCountry=RU&key=${process.env.ODESLI_KEY}`, { tries: 1 });
    const ent = (d.entitiesByUniqueId || {})[d.entityUniqueId] || {}, links = {};
    for (const [k, v] of Object.entries(d.linksByPlatform || {})) if (v.url && ['spotify', 'appleMusic', 'yandex', 'youtubeMusic', 'youtube', 'deezer', 'tidal', 'soundcloud', 'amazonMusic'].includes(k)) links[k === 'appleMusic' ? 'apple' : k] = v.url;
    return { title: ent.title || '', type: '', date: '', covers: ent.thumbnailUrl ? [ent.thumbnailUrl] : [], links };
  }
  return null;
}

function parseLinkRow(raw) {
  const line = raw.trim().replace(/\s+#(?:\s|$).*$/, '').trim();
  if (!line || line.startsWith('#')) return null;
  const row = {date: '', title: '', type: '', urls: [], extra: {}};
  for (const field of line.split('|').map(value => value.trim())) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(field)) {
      row.date = field;
      continue;
    }
    const assignment = field.match(/^([\w.-]+)=(.*)$/s);
    if (assignment) {
      const key = assignment[1].toLowerCase();
      const value = assignment[2].trim();
      if (key === 'title' || key === 'type') row[key] = value;
      else if (releasePath(value)) {
        row.extra[key] = value;
        row.urls.push(value);
      }
    } else if (releasePath(field)) {
      row.urls.push(field);
    }
  }
  return row.urls.length ? row : null;
}

const knownByLink = new Map();
function rememberRelease(release) {
  if (!release.title || release.pendingMetadata) return;
  for (const url of [release.src, ...Object.values(release.links || {})]) {
    const key = linkKey(url);
    if (!key) continue;
    const previous = knownByLink.get(key);
    if (!previous) knownByLink.set(key, release);
    else {
      knownByLink.set(key, {
        ...previous, ...release,
        cover: release.cover || previous.cover,
        date: release.date || previous.date,
        links: {...previous.links, ...release.links},
      });
    }
  }
}
old.forEach(rememberRelease);
for (const item of items.values()) rememberRelease(item);

const lines = fs.existsSync('links.txt') ? fs.readFileSync('links.txt', 'utf8').split(/\r?\n/) : [];
const rows = lines.map(parseLinkRow).filter(Boolean);
const requests = new Map();

async function lookupRow(row) {
  const known = row.urls.map(url => knownByLink.get(linkKey(url))).find(Boolean);
  if (known && (row.date || known.date) && (known.cover || known.localCover || known.covers?.length)) return known;
  for (const url of row.urls) {
    const key = linkKey(url);
    if (!requests.has(key)) {
      requests.set(key, resolveLink(url, row.date).catch(error => {
        console.log('link: не удалось получить данные', url, '-', error.message);
        return null;
      }));
    }
    const found = await requests.get(key);
    if (found?.title) return {
      ...known, ...found,
      date: found.date || known?.date,
      links: {...known?.links, ...found.links},
    };
  }
  return known;
}

function applyManualLinks(release, direct, explicit) {
  const priorities = release.linkPriorities ||= {};
  for (const [key, address] of Object.entries(direct)) {
    const priority = Object.hasOwn(explicit, key) ? 2 : 1;
    if ((priorities[key] || 0) > priority) continue;
    release.links[key] = address;
    priorities[key] = priority;
  }
}

const manualDate = new Map();
const pendingRows = [];
for (let start = 0; start < rows.length; start += 4) {
  const batch = rows.slice(start, start + 4);
  const metadata = await Promise.all(batch.map(lookupRow));
  for (const [index, row] of batch.entries()) {
    const found = metadata[index] || row.urls.map(url => knownByLink.get(linkKey(url))).find(Boolean);
    const title = row.title || found?.title;
    const url = row.urls[0];
    const id = 'link-' + crypto.createHash('md5').update(linkKey(url) || url).digest('hex').slice(0, 8);
    const supplied = {};
    for (const address of row.urls) {
      const platform = platOf(address);
      if (platform) supplied[platform] = address;
    }
    const explicit = releaseLinkMap(row.extra);
    const direct = {...releaseLinkMap(supplied), ...explicit};
    if (!title) { pendingRows.push({row, id, url, direct, explicit}); continue; }
    const item = {
      ...found, id, src: url, title,
      type: row.type || found?.type,
      date: row.date || found?.date,
      cover: found?.cover || found?.localCover,
      links: releaseLinkMap({...found?.links, ...direct}),
    };
    if (row.date) manualDate.set(norm(title), row.date);
    put(item, 'links');
    const stored = items.get(norm(title));
    applyManualLinks(stored, direct, explicit);
    rememberRelease({...item, links: stored.links});
  }
}

const unresolved = new Map();
for (const {row, id, url, direct, explicit} of pendingRows) {
  const matched = row.urls.map(address => knownByLink.get(linkKey(address))).find(Boolean);
  if (matched) {
    if (!items.has(norm(matched.title))) put({...matched, id, src: url}, 'links');
    applyManualLinks(items.get(norm(matched.title)), direct, explicit);
    if (row.date) manualDate.set(norm(matched.title), row.date);
    continue;
  }

  // Сохраняем прямую ссылку даже при первой недоступности метаданных.
  const platform = platOf(url);
  const name = platform === 'yandex' ? 'Яндекс Музыке' : platform === 'spotify' ? 'Spotify' : '';
  const previous = unresolved.get(id);
  const pending = previous || {
    id, title: name ? `релиз в ${name}` : 'релиз', type: '', date: '', cover: '', links: {}, page: '',
    src: url, srcs: ['links'], pendingMetadata: true,
  };
  pending.date = row.date || pending.date;
  pending.type = row.type || pending.type;
  applyManualLinks(pending, direct, explicit);
  unresolved.set(id, pending);
}
if (unresolved.size) console.log('сохранены ссылки без полученных метаданных:', unresolved.size);

// дополняем ссылки: ищем тот же релиз на Deezer и в Apple Music по названию (строгое совпадение названия и артиста)
const artistOk = n => norm(n).includes(norm(cfg.name));
for (const e of items.values()) {
  if (!e.links.deezer) { try {
    const j = await get('https://api.deezer.com/search/album?limit=10&q=' + encodeURIComponent(`artist:"${cfg.name}" album:"${e.title.replace(/"/g, '')}"`), { tries: 1 });
    const h = (j.data || []).find(a => norm(clean(a.title)) === e.key && artistOk(a.artist && a.artist.name));
    if (h) { e.links.deezer = h.link; if (h.cover_xl) e.covers.push(h.cover_xl); console.log('deezer: найден «' + e.title + '», id артиста', h.artist.id, '(можно вписать в sources.json)'); }
  } catch {} await sleep(250); }
  if (!e.links.apple) { try {
    const j = await get('https://itunes.apple.com/search?entity=album&limit=10&country=ru&term=' + encodeURIComponent(cfg.name + ' ' + e.title), { tries: 1 });
    const h = (j.results || []).find(a => norm(clean(a.collectionName)) === e.key && artistOk(a.artistName));
    if (h) e.links.apple = h.collectionViewUrl;
  } catch {} await sleep(250); }
}

// финал: ids, обложки, запись
const list = Array.from(unresolved.values(), ({linkPriorities, ...release}) => release);
for (const e of items.values()) {
  const o = oldByKey.get(e.key);
  const id = (o && o.id) || e.ids.slice().sort((a, b) => PRIO.indexOf(a.split('-')[0]) - PRIO.indexOf(b.split('-')[0]))[0];
  let cover = '';
  const prev = [e.localCover, o && o.cover].find(p => p && exists(p));
  if (prev) cover = prev; else { const cp = `covers/${id}.jpg`; if (await img(e.covers, cp)) cover = cp; }
  const date = manualDate.get(e.key) || e.date;
  list.push({ id, title: e.title, type: e.type, date, cover, links: releaseLinkMap(e.links), page: e.page, srcs: [...e.srcs],
    ...(e.src ? { src: e.src } : {}), ...(e.enriched ? { enriched: true } : {}) });
}
list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
if (!list.length && old.length) { console.log('все источники недоступны — оставляю прошлые данные'); process.exit(0); }
const out = 'window.AUTO=' + JSON.stringify(list, null, 1) + ';\n';
if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== out) { fs.writeFileSync(OUT, out); console.log('updated:', list.length, 'releases'); } else console.log('no changes');
