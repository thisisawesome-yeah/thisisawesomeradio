/**
 * Netlify Function: translate-review
 *
 * Acts as a secure server-side proxy for the Anthropic Claude API.
 * The API key is stored as a Netlify environment variable (ANTHROPIC_API_KEY)
 * and never exposed to the browser.
 *
 * POST /netlify/functions/translate-review
 * Body: { text: string, artist: string, title: string }
 * Returns: { translatedText: string }
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL             = 'claude-sonnet-4-20250514';
const MAX_TOKENS        = 1000;
const MAX_INPUT_LENGTH  = 2000; // Guard against oversized inputs

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return corsResponse(200, '');
  }

  if (event.httpMethod !== 'POST') {
    return corsResponse(405, JSON.stringify({ error: 'Method Not Allowed' }));
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[translate-review] ANTHROPIC_API_KEY ist nicht gesetzt');
    return corsResponse(500, JSON.stringify({ error: 'Server-Konfigurationsfehler' }));
  }

  // Parse & validate input
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return corsResponse(400, JSON.stringify({ error: 'Ungültiges JSON' }));
  }

  const { text, artist, title } = body;

  if (!text || typeof text !== 'string') {
    return corsResponse(400, JSON.stringify({ error: 'Fehlender Parameter: text' }));
  }

  if (text.length > MAX_INPUT_LENGTH) {
    return corsResponse(400, JSON.stringify({ error: 'Text zu lang' }));
  }

  // Build prompt
  const prompt = `Du bist Musikredakteur bei THISISAWESOMERADIO, einem unabhängigen Webradio aus Bremen.

Aufgabe: Übersetze und überarbeite den folgenden Review-Text ins Deutsche.
- Wenn der Text bereits auf Deutsch ist, überarbeite ihn redaktionell.
- Korrigiere Grammatik, Rechtschreibung und Stil.
- Bewahre die inhaltliche Aussage und den Ton.
- Halte den Text prägnant (maximal 3–4 Sätze).
- Gib NUR den fertigen deutschen Text zurück – keine Anführungszeichen, keine Erklärungen.

Artist: ${artist || ''}
Titel: ${title || ''}
Review-Text:
${text}`;

  // Call Claude API
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[translate-review] Claude API Fehler:', response.status, err);
      return corsResponse(502, JSON.stringify({ error: 'Upstream-Fehler' }));
    }

    const data = await response.json();
    const translatedText = data.content?.[0]?.text?.trim();

    if (!translatedText) {
      console.error('[translate-review] Leere Antwort von Claude:', data);
      return corsResponse(502, JSON.stringify({ error: 'Leere Antwort' }));
    }

    return corsResponse(200, JSON.stringify({ translatedText }));

  } catch (err) {
    console.error('[translate-review] Netzwerkfehler:', err);
    return corsResponse(503, JSON.stringify({ error: 'Service nicht erreichbar' }));
  }
};

function corsResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body,
  };
}
