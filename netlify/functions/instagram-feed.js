/**
 * Netlify Function: instagram-feed
 *
 * Server-side proxy for the Instagram Graph API.
 * Keeps the access token secret and caches results in Netlify Blobs.
 *
 * GET /netlify/functions/instagram-feed
 * Returns: JSON array of Instagram posts
 */

const { getStore } = require('@netlify/blobs');

const INSTAGRAM_API = 'https://graph.instagram.com';
const FIELDS        = 'id,caption,timestamp,permalink,media_type,media_url';
const CACHE_KEY     = 'feed-cache';
const CACHE_TTL     = 10 * 60 * 1000; // 10 minutes

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return corsResponse(200, '');
  }

  if (event.httpMethod !== 'GET') {
    return corsResponse(405, JSON.stringify({ error: 'Method Not Allowed' }));
  }

  try {
    const store = getStore('instagram');

    // ── Check cache ───────────────────────────────────────────────────────
    const raw = await store.get(CACHE_KEY);
    if (raw) {
      try {
        const cached = JSON.parse(raw);
        if (cached.timestamp && Date.now() - cached.timestamp < CACHE_TTL) {
          console.log('[instagram-feed] Serving from cache');
          return corsResponse(200, JSON.stringify(cached.posts));
        }
      } catch { /* stale or corrupt cache – refetch */ }
    }

    // ── Resolve access token (refreshed blob > env var) ───────────────────
    const token = (await store.get('access-token')) || process.env.INSTAGRAM_ACCESS_TOKEN;

    if (!token) {
      console.error('[instagram-feed] Kein Instagram Access Token verfügbar');
      return corsResponse(500, JSON.stringify({ error: 'Server-Konfigurationsfehler' }));
    }

    // ── Fetch from Instagram Graph API ────────────────────────────────────
    const url = `${INSTAGRAM_API}/me/media?fields=${FIELDS}&access_token=${token}`;
    const res = await fetch(url);

    if (!res.ok) {
      const err = await res.text();
      console.error('[instagram-feed] Instagram API Fehler:', res.status, err);
      // Return stale cache if available
      if (raw) {
        try { return corsResponse(200, JSON.stringify(JSON.parse(raw).posts)); }
        catch { /* no usable cache */ }
      }
      return corsResponse(502, JSON.stringify({ error: 'Instagram API Fehler' }));
    }

    const data  = await res.json();
    const posts = (data.data || []).map(p => ({
      id:        p.id,
      caption:   p.caption || '',
      timestamp: p.timestamp,
      permalink: p.permalink,
      mediaType: p.media_type,
      mediaUrl:  p.media_url,
    }));

    // ── Update cache ──────────────────────────────────────────────────────
    await store.set(CACHE_KEY, JSON.stringify({ posts, timestamp: Date.now() }));

    return corsResponse(200, JSON.stringify(posts));

  } catch (err) {
    console.error('[instagram-feed] Fehler:', err);
    return corsResponse(500, JSON.stringify({ error: 'Interner Fehler' }));
  }
};

function corsResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body,
  };
}
