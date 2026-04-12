/**
 * Netlify Scheduled Function: check-instagram
 *
 * Runs every 2 hours. Fetches the latest Instagram post via the Graph API,
 * compares it against the previously stored one (Netlify Blobs), and
 * optionally sends a webhook notification (set NEW_POST_WEBHOOK_URL env var).
 *
 * Also refreshes the long-lived Instagram access token automatically
 * so it never expires (valid 60 days, refreshed every 2 hours).
 */

const { schedule } = require('@netlify/functions');
const { getStore }  = require('@netlify/blobs');

const INSTAGRAM_API = 'https://graph.instagram.com';
const FIELDS        = 'id,caption,timestamp,permalink';
const STORE_NAME    = 'instagram';
const LAST_POST_KEY = 'last-post-permalink';

exports.handler = schedule('0 */2 * * *', async () => {
  console.log('[check-instagram] Prüfe auf neue Posts …');

  try {
    const store = getStore(STORE_NAME);

    // ── Token laden (erneuert > env var) ──────────────────────────────────
    let token = (await store.get('access-token')) || process.env.INSTAGRAM_ACCESS_TOKEN;

    if (!token) {
      console.error('[check-instagram] Kein Instagram Access Token verfügbar');
      return { statusCode: 500 };
    }

    // ── Token automatisch erneuern ────────────────────────────────────────
    try {
      const refreshRes = await fetch(
        `${INSTAGRAM_API}/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`
      );
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        if (refreshData.access_token) {
          token = refreshData.access_token;
          await store.set('access-token', token);
          console.log('[check-instagram] Token erfolgreich erneuert');
        }
      } else {
        console.warn('[check-instagram] Token-Erneuerung fehlgeschlagen:', refreshRes.status);
      }
    } catch (refreshErr) {
      console.warn('[check-instagram] Token-Erneuerung Fehler:', refreshErr.message);
    }

    // ── Neuesten Post laden ───────────────────────────────────────────────
    const url = `${INSTAGRAM_API}/me/media?fields=${FIELDS}&limit=1&access_token=${token}`;
    const res = await fetch(url);

    if (!res.ok) {
      console.error(`[check-instagram] Instagram API Fehler: ${res.status}`);
      return { statusCode: 502 };
    }

    const data  = await res.json();
    const posts = data.data || [];

    if (!posts.length) {
      console.log('[check-instagram] Keine Posts gefunden');
      return { statusCode: 200 };
    }

    const latest          = posts[0];
    const latestPermalink = latest.permalink;

    // ── Letzten bekannten Post prüfen ─────────────────────────────────────
    const storedId = await store.get(LAST_POST_KEY);

    if (!storedId) {
      console.log('[check-instagram] Erster Lauf – speichere aktuellen Post');
      await store.set(LAST_POST_KEY, latestPermalink);
      return { statusCode: 200 };
    }

    if (storedId === latestPermalink) {
      console.log('[check-instagram] Kein neuer Post');
      return { statusCode: 200 };
    }

    // ── Neuer Post erkannt! ───────────────────────────────────────────────
    const caption = (latest.caption || '').split('\n')[0] || 'Neuer Post';
    console.log(`[check-instagram] Neuer Post erkannt: ${latestPermalink}`);
    console.log(`[check-instagram] Titel: ${caption}`);

    await store.set(LAST_POST_KEY, latestPermalink);

    // ── Optionale Webhook-Benachrichtigung ────────────────────────────────
    const webhookUrl = process.env.NEW_POST_WEBHOOK_URL;
    if (webhookUrl) {
      await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text:      `Neuer Instagram-Post: ${caption}`,
          permalink: latest.permalink,
          timestamp: latest.timestamp,
        }),
      });
      console.log('[check-instagram] Webhook-Benachrichtigung gesendet');
    }

    return { statusCode: 200 };

  } catch (err) {
    console.error('[check-instagram] Fehler:', err);
    return { statusCode: 500 };
  }
});
