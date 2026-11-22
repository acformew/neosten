(function () {
  'use strict';

  const cleanTitle = title => String(title || '')
    .normalize('NFKC')
    .replace(/\s*[-–—]\s*(Single|Сингл|EP)\s*$/i, '')
    .trim();
  const titleKey = title => cleanTitle(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const placeholderTitles = new Set([
    'релиз', 'релиз в Spotify', 'релиз в Яндекс Музыке', 'релиз в Яндекс Музыка',
    'release', 'release on Spotify', 'release on Yandex Music',
  ].map(titleKey));

  function hasReleaseTitle(release) {
    const title = titleKey(release.title);
    return !release.pendingMetadata && !!title && !placeholderTitles.has(title);
  }

  function webURL(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value.trim());
      return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
    } catch { return null; }
  }

  function platformOf(value) {
    const host = webURL(value)?.hostname.replace(/^www\./, '') || '';
    if (host === 'open.spotify.com') return 'spotify';
    if (/^music\.yandex\.(ru|com|kz|by|uz)$/.test(host)) return 'yandex';
    if (host === 'music.apple.com') return 'apple';
    if (/^(?:www\.)?deezer\.com$/.test(host)) return 'deezer';
    if (/^(?:m\.)?vk\.(com|ru)$/.test(host)) return 'vk';
    if (host === 'music.youtube.com') return 'youtubeMusic';
    if (['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) return 'youtube';
    if (host === 'soundcloud.com') return 'soundcloud';
    if (host === 'tidal.com' || host === 'listen.tidal.com') return 'tidal';
    if (/^music\.amazon\.(?:com|co\.uk|de|fr|it|es|ca|com\.au|co\.jp|in)$/.test(host)) return 'amazonMusic';
    return '';
  }

  function releasePath(value) {
    const url = webURL(value);
    if (!url) return null;
    const platform = platformOf(value);
    const path = url.pathname.replace(/\/$/, '');
    if (platform === 'yandex') {
      const track = path.match(/^\/(?:album\/(\d+)\/)?track\/(\d+)$/);
      if (track) return {platform, kind: 'track', id: track[2], album: track[1]};
      const match = path.match(/^\/album\/(\d+)$/);
      return match ? {platform, kind: 'album', id: match[1]} : null;
    }
    if (platform === 'spotify' || platform === 'deezer') {
      const match = path.match(/^\/(?:[\w-]+\/)?(album|track)\/([A-Za-z0-9]+)$/);
      return match ? {platform, kind: match[1], id: match[2]} : null;
    }
    if (platform === 'apple') {
      const track = url.searchParams.get('i');
      if (/^\d+$/.test(track || '') && /\/album\//.test(path)) return {platform, kind: 'track', id: track};
      const match = path.match(/\/(album|song)\/(?:[^/]+\/)?(\d+)$/);
      return match ? {platform, kind: match[1] === 'song' ? 'track' : 'album', id: match[2]} : null;
    }
    if (/\/(?:artists?|users?|channels?|@[^/]+)(?:\/|$)/i.test(path)) return null;
    if (platform === 'soundcloud' && path.split('/').filter(Boolean).length < 2) return null;
    if (platform === 'vk' && !/\/music\/album\/|\/audio-?\d+_|^\/music(?:\/|$)/.test(path)) return null;
    return {platform, url: url.href};
  }

  function linkKey(value) {
    const link = releasePath(value);
    if (!link) return '';
    return link.id ? `${link.platform}:${link.kind}:${link.id}` : link.url;
  }

  function directLinks(links) {
    const result = {};
    for (const value of Object.values(links || {})) {
      const link = releasePath(value);
      if (link?.platform) result[link.platform] = value.trim();
    }
    return result;
  }

  function sameTitle(first, second) {
    const firstTitle = titleKey(first.match || first.title);
    if (!firstTitle || firstTitle !== titleKey(second.match || second.title)) return false;
    const firstLinks = directLinks(first.links);
    const secondLinks = directLinks(second.links);
    return Object.keys(firstLinks).every(platform => {
      const a = releasePath(firstLinks[platform]);
      const b = releasePath(secondLinks[platform]);
      return !a?.id || !b?.id || a.kind !== b.kind || a.id === b.id;
    });
  }

  function matchesFor(catalog, release) {
    const ids = new Set([release.id, ...(release.ids || [])].filter(Boolean));
    const links = new Set([release.src, ...Object.values(directLinks(release.links))].map(linkKey).filter(Boolean));
    const strong = catalog.filter(item =>
      [item.id, ...(item.ids || [])].some(id => ids.has(id)) ||
      [item.src, ...Object.values(directLinks(item.links))].some(url => links.has(linkKey(url)))
    );
    const byTitle = catalog.filter(item => !strong.includes(item) && sameTitle(item, release));
    if (byTitle.length === 1 && strong.every(item => sameTitle(item, byTitle[0]))) return [...strong, byTitle[0]];
    return strong;
  }

  const api = {cleanTitle, titleKey, hasReleaseTitle, webURL, platformOf, releasePath, linkKey, directLinks, matchesFor};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.ReleaseIdentity = api;
})();
