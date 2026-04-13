/**
 * Netlify Scheduled Function: check-instagram
 *
 * Runs every 2 hours. Fetches the behold.so Instagram feed and compares
 * the latest post against the previously stored one (Netlify Blobs).
 * When a new post is detected it logs the event and optionally sends
 * a webhook notification (set NEW_POST_WEBHOOK_URL env var).
 */

const { schedule } = require('@netlify/functions');
const { getStore }  = require('@netlify/blobs');

const BEHOLD_FEED_URL = 'https://feeds.behold.so/JuATRBaeMpZOYE2V0J4R';
const STORE_NAME      = 'instagram-check';
const LAST_POST_KEY   = 'last-post-permalink';

exports.handler = schedule('0 */2 * * *', async () => {
  console.log('[check-instagram] Prüfe auf neue Posts …');

  try {
    // ── Aktuellen Feed laden ──────────────────────────────────────────────
    const res = await fetch(BEHOLD_FEED_URL);
    if (!res.ok) {
      console.error(`[check-instagram] Feed-Abruf fehlgeschlagen: ${res.status}`);
      return { statusCode: 502 };
    }

    const data  = await res.json();
    const posts = Array.isArray(data) ? data : (data.posts || []);

    if (!posts.length) {
      console.log('[check-instagram] Keine Posts im Feed');
      return { statusCode: 200 };
    }

    const latest          = posts[0];
    const latestPermalink = latest.permalink || latest.id;

    // ── Letzten bekannten Post aus dem Store laden ─────────────────────────
    const store    = getStore(STORE_NAME);
    const storedId = await store.get(LAST_POST_KEY);

    // Erster Durchlauf – Post merken, keine Benachrichtigung
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
