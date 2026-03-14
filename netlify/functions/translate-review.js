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
const MAX_INPUT_LENGTH  = 5000; // Accept longer texts
const MAX_TEXT_FOR_AI   = 1200; // Truncate to keep Claude response fast

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

  if (!text && !title) {
    return corsResponse(400, JSON.stringify({ error: 'Fehlender Parameter: text oder title' }));
  }

  if ((text || '').length > MAX_INPUT_LENGTH) {
    return corsResponse(400, JSON.stringify({ error: 'Text zu lang' }));
  }

  // Truncate for Claude to stay within timeout
  const textForAI = (text || '').length > MAX_TEXT_FOR_AI
    ? text.slice(0, MAX_TEXT_FOR_AI) + '…'
    : (text || '');

  // Build prompt
  const prompt = `Du bist Musikredakteur bei THISISAWESOMERADIO, einem unabhängigen Webradio aus Bremen.

Übersetze und überarbeite die folgenden Felder eines Musik-Reviews ins Deutsche.
Regeln:
- Übersetze NUR wenn der Text auf Englisch ist; ist er bereits Deutsch, überarbeite ihn redaktionell.
- Korrigiere Grammatik, Rechtschreibung und Stil.
- Bewahre inhaltliche Aussage und Ton.
- Review-Text: maximal 3–4 Sätze.
- Künstlername und Songtitel NIEMALS übersetzen.
- Antworte ausschließlich als JSON ohne Markdown-Backticks: {"translatedTitle": "...", "translatedText": "..."}

Titel (kann ein Songtitel, ein Albumtitel oder ein einleitender Satz sein):
${title || ''}

Artist: ${artist || ''}

Review-Text:
${textForAI}`;
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
    const raw = data.content?.[0]?.text?.trim();

    if (!raw) {
      console.error('[translate-review] Leere Antwort von Claude:', data);
      return corsResponse(502, JSON.stringify({ error: 'Leere Antwort' }));
    }

    // Strip markdown code fences Claude sometimes wraps around JSON
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    // Parse JSON response from Claude
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('[translate-review] JSON parse fehlgeschlagen, raw:', cleaned);
      // Fallback: return original values
      parsed = { translatedTitle: title, translatedText: text };
    }

    return corsResponse(200, JSON.stringify({
      translatedTitle: parsed.translatedTitle || title,
      translatedText:  parsed.translatedText  || text,
    }));

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
