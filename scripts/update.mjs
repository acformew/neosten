// Собирает релизы neosten из НЕСКОЛЬКИХ источников и пишет data/auto.js:
//  1) Apple Music (авто, публичный API, без ключей)
//  2) links.txt — ссылки на релизы с ЛЮБОЙ площадки (Spotify, Яндекс, VK...) -> через song.link
//     получаем обложку, название и ссылки на все остальные площадки.
// Любой источник может не сработать — остальные продолжают работать.
import fs from 'node:fs';
import crypto from 'node:crypto';
const ID = process.env.APPLE_ARTIST_ID || '1802667747', OUT = 'data/auto.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = t => (t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
async function get(u, bin) { const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 neosten-site' } }); if (!r.ok) throw new Error(r.status + ' ' + u); return bin ? Buffer.from(await r.arrayBuffer()) : r.json(); }
async function img(urls, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return true;
  for (const u of urls) { try { const b = await get(u, true); if (b.length > 1000) { fs.writeFileSync(dest, b); return true; } } catch {} }
  console.log('cover fail:', dest); return false;
}
fs.mkdirSync('covers', { recursive: true }); fs.mkdirSync('data', { recursive: true });
let old = [];
try { old = JSON.parse(fs.readFileSync(OUT, 'utf8').replace(/^window\.AUTO=/, '').replace(/;\s*$/, '')); } catch {}
const bySrc = Object.fromEntries(old.filter(x => x.src).map(x => [x.src, x]));
const items = new Map();
const put = it => { const k = norm(it.title); if (!k) return; const e = items.get(k);
  if (!e) items.set(k, it); else { e.links = Object.assign({}, it.links, e.links); for (const f of ['cover', 'date', 'type', 'page']) e[f] = e[f] || it[f]; } };

// ---- 1. Apple Music
try {
  let ap = [];
  for (const c of ['ru', 'us']) { const j = await get(`https://itunes.apple.com/lookup?id=${ID}&entity=album&country=${c}&limit=200`); ap = (j.results || []).filter(x => x.wrapperType === 'collection'); if (ap.length) break; }
  for (const a of ap) {
    const name = a.collectionName || '', id = 'apple-' + a.collectionId, cp = `covers/${a.collectionId}.jpg`;
    const ok = await img(['1000x1000', '600x600', '300x300', '100x100'].map(s => (a.artworkUrl100 || '').replace(/\d+x\d+bb/, s + 'bb')).filter(Boolean), cp);
    put({ id, title: name.replace(/\s+-\s+(Single|Сингл|EP)$/i, ''),
      type: /\s-\s(Single|Сингл)$/i.test(name) || a.trackCount === 1 ? 'сингл' : /\s-\sEP$/i.test(name) ? 'EP' : 'альбом',
      date: (a.releaseDate || '').slice(0, 10), cover: ok ? cp : '', links: { apple: a.collectionViewUrl } });
  }
} catch (e) { console.log('apple skipped:', e.message); for (const x of old.filter(x => String(x.id).startsWith('apple-'))) put(x); }

// ---- 2. links.txt: «[дата |] ссылка [| vk=ссылка ...]»
const lines = fs.existsSync('links.txt') ? fs.readFileSync('links.txt', 'utf8').split(/\r?\n/) : [];
for (const raw of lines) {
  const ln = raw.replace(/#.*$/, '').trim(); if (!ln) continue;
  const parts = ln.split('|').map(s => s.trim()); let date = '', url = '', extra = {};
  for (const p of parts) { if (/^\d{4}-\d{2}-\d{2}/.test(p)) date = p.slice(0, 10); else if (/^https?:/.test(p)) url = p; else if (/^\w+=https?:/.test(p)) extra[p.split('=')[0]] = p.slice(p.indexOf('=') + 1); }
  if (!url) continue;
  let it = bySrc[url];
  if (!it || !Object.keys(it.links || {}).length || !it.cover) {
    try {
      let d; try { d = await get(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(url)}&userCountry=RU`); } catch (e) { await sleep(30000); d = await get(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(url)}&userCountry=RU`); }
      const ent = (d.entitiesByUniqueId || {})[d.entityUniqueId] || {}, links = {};
      for (const [k, v] of Object.entries(d.linksByPlatform || {})) if (v.url && ['spotify', 'appleMusic', 'yandex', 'youtubeMusic', 'youtube', 'deezer', 'tidal', 'soundcloud', 'amazonMusic'].includes(k)) links[k === 'appleMusic' ? 'apple' : k] = v.url;
      const id = 'link-' + crypto.createHash('md5').update(url).digest('hex').slice(0, 8), cp = `covers/${id}.jpg`;
      const ok = ent.thumbnailUrl ? await img([ent.thumbnailUrl], cp) : false;
      it = { id, src: url, title: ent.title || '', type: '', date: '', cover: ok ? cp : '', links, page: d.pageUrl || '' };
      await sleep(7000);   // лимит song.link: ~10 запросов в минуту
    } catch (e) { console.log('link skipped:', url, e.message); continue; }
  }
  put({ ...it, date: date || it.date || '', links: Object.assign({}, it.links, extra) });
}

const list = [...items.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
const out = 'window.AUTO=' + JSON.stringify(list, null, 1) + ';\n';
if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== out) { fs.writeFileSync(OUT, out); console.log('updated:', list.length, 'releases'); } else console.log('no changes');
