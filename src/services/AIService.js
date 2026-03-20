// AIService.js — AI-powered news summarization via Google Gemini
//
// ⚠️  SECURITY REMINDER ⚠️
// This file runs entirely in the browser (GitHub Pages = public frontend).
// Your Gemini API key is visible to anyone who opens DevTools.
//
// For production, route the call through a serverless function:
//   • Vercel Edge Function  →  /api/ai-insight
//   • Cloudflare Worker     →  free tier, easy setup
//   • Netlify Function      →  /_netlify/functions/ai-insight
//
// The serverless function holds the key server-side and you call
// YOUR function's URL instead of Google directly.
//
// For development / personal use: set your key via:
//   localStorage.setItem('bon-gemini-key', 'AIza...')
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'bon-gemini-key';
const MODEL       = 'gemini-1.5-flash-latest';
const ENDPOINT    = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Optional: hardcode a key here ONLY for private/personal use.
// Leave empty ('') to require the user to set it via localStorage.
const DEFAULT_KEY = '';

// ── Public helpers ──────────────────────────────────────────

export function getGeminiKey() {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_KEY;
}

export function setGeminiKey(key) {
  if (key) localStorage.setItem(STORAGE_KEY, key.trim());
  else localStorage.removeItem(STORAGE_KEY);
}

export function hasGeminiKey() {
  return Boolean(getGeminiKey());
}

// ── Main function ───────────────────────────────────────────

/**
 * Summarize stock news headlines into 3 bullet points.
 * Returns an array of 3 strings, or null on failure.
 *
 * @param {Array<{headline: string, summary?: string}>} newsItems
 * @returns {Promise<string[] | null>}
 */
export async function getAINewsInsight(newsItems) {
  const key = getGeminiKey();
  if (!key)                    return null;
  if (!newsItems?.length)      return null;

  // Build prompt from up to 8 headlines + summaries
  const lines = newsItems.slice(0, 8).map(n => {
    const summary = n.summary ? ` — ${n.summary.slice(0, 120)}` : '';
    return `• ${n.headline}${summary}`;
  }).join('\n');

  const prompt =
    `You are a concise financial analyst. Summarize the following stock news into ` +
    `exactly 3 bullet points. Each bullet should be one sentence, plain English, ` +
    `no markdown, no bold text. Focus on the main reason the stock is moving today ` +
    `and what investors should watch. Start each bullet with the "•" character.\n\n` +
    `News:\n${lines}`;

  try {
    const res = await fetch(`${ENDPOINT}?key=${key}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature:     0.35,
          maxOutputTokens: 300,
          topP:            0.8,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
      signal: AbortSignal.timeout(14000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // 429 = quota; 400 = bad key — both should be silent
      console.warn('[AIService] Gemini error:', res.status, err?.error?.message);
      return null;
    }

    const json  = await res.json();
    const text  = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) return null;

    // Parse bullet points — accept •, -, *, or numbered lines
    const bullets = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 8)
      .map(l => l.replace(/^[•\-\*\d]+[\.\)]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 3);

    return bullets.length >= 1 ? bullets : null;
  } catch (e) {
    // Network error, timeout, AbortError — all silent
    if (e.name !== 'AbortError') console.warn('[AIService]', e.message);
    return null;
  }
}
