// Забирает релизы neosten из публичного API Apple Music (iTunes), качает обложки в covers/
// и пишет data/apple.js. Запускается GitHub Actions по расписанию. Ключи не нужны.
import fs from 'node:fs';
const ID = process.env.APPLE_ARTIST_ID || '1802667747';
const OUT = 'data/apple.js';
const get = async (u, bin) => { const r = await fetch(u, { headers: { 'user-agent': 'neosten-site' } }); if (!r.ok) throw new Error(r.status + ' ' + u); return bin ? Buffer.from(await r.arrayBuffer()) : r.json(); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let albums = [];
for (const c of ['ru', 'us']) {
  const j = await get(`https://itunes.apple.com/lookup?id=${ID}&entity=album&country=${c}&limit=200`);
  albums = (j.results || []).filter(x => x.wrapperType === 'collection');
  if (albums.length) break;
}
let old = [];
try { old = JSON.parse(fs.readFileSync(OUT, 'utf8').replace(/^window\.APPLE=/, '').replace(/;\s*$/, '')); } catch {}
const prev = Object.fromEntries(old.map(x => [x.id, x]));
fs.mkdirSync('covers', { recursive: true });
fs.mkdirSync('data', { recursive: true });

const list = [];
for (const a of albums) {
  const id = 'apple-' + a.collectionId, name = a.collectionName || '';
  const title = name.replace(/\s+-\s+(Single|Сингл|EP)$/i, '');
  const type = /\s-\s(Single|Сингл)$/i.test(name) || a.trackCount === 1 ? 'сингл' : /\s-\sEP$/i.test(name) ? 'EP' : 'альбом';
  const cover = `covers/${a.collectionId}.jpg`;
  if (!fs.existsSync(cover) && a.artworkUrl100) {
    try { fs.writeFileSync(cover, await get(a.artworkUrl100.replace(/\d+x\d+bb/, '1000x1000bb'), true)); } catch (e) { console.log('cover fail', e.message); }
  }
  let links = prev[id]?.links;
  if (!links || !Object.keys(links).length) {   // ссылки на другие площадки (song.link), один раз на релиз
    links = {};
    try {
      const s = await get(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(a.collectionViewUrl)}&userCountry=RU`);
      const p = s.linksByPlatform || {};
      if (p.spotify?.url) links.spotify = p.spotify.url;
      if (p.yandex?.url) links.yandex = p.yandex.url;
      await sleep(1500);
    } catch (e) { console.log('songlink skip', e.message); }
  }
  list.push({ id, title, type, date: (a.releaseDate || '').slice(0, 10), cover: fs.existsSync(cover) ? cover : '', url: a.collectionViewUrl, links });
}
list.sort((x, y) => y.date.localeCompare(x.date));
const out = 'window.APPLE=' + JSON.stringify(list, null, 1) + ';\n';
if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== out) { fs.writeFileSync(OUT, out); console.log('updated:', list.length, 'releases'); } else console.log('no changes');
