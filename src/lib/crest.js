// @ts-check

const ESPN_IMAGE = /^https:\/\/a\.espncdn\.com(\/i\/[^?#]+\.png)$/;

/**
 * ESPN crests are 500 px PNGs (about 36 KB each) but are drawn at 16–64 px. ESPN's image combiner
 * resizes them on its CDN (a 48 px crest is about 4 KB), so ask it for the drawn size times `dpr`.
 * Anything that isn't an ESPN `/i/…png` URL is returned unchanged.
 * @param {string} url
 * @param {number} px   drawn size in CSS pixels
 * @param {number} [dpr] device pixel ratio to serve
 */
export function sizedCrest(url, px, dpr = 1) {
  const m = ESPN_IMAGE.exec(url);
  if (!m) return url;
  const side = Math.min(500, Math.ceil(px * dpr));
  return `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${side}&h=${side}`;
}
