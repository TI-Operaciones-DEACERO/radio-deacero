'use strict';
/* gemini.js — adaptador de Gemini (el modelo de pago). Opcional: sin clave no hace nada y la app usa el motor local.
 *
 * - La clave solo viaja en la cabecera x-goog-api-key (nunca en la URL: las URL acaban en registros) y solo vive en el entorno.
 * - Tiempo máximo por llamada, tope de llamadas por minuto (cuesta dinero) y cortacircuitos: tras varios fallos seguidos
 *   deja de intentar un rato y todo cae al motor local sin que nadie espere.
 * - Los errores nunca incluyen la clave ni el cuerpo que devuelve el proveedor. */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const DEFAULT_MODEL = 'gemini-3.7-flash';
const MAX_PROMPT = 8000;

const fail = (code) => Object.assign(new Error(code), { code });

/* Saca el JSON de la respuesta aunque venga con ```json o con texto alrededor. */
function extractJson(raw) {
  const clean = String(raw).replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const starts = [clean.indexOf('['), clean.indexOf('{')].filter((i) => i >= 0);
  if (!starts.length) return undefined;
  const open = clean[Math.min(...starts)];
  const from = Math.min(...starts);
  const to = clean.lastIndexOf(open === '[' ? ']' : '}');
  if (to <= from) return undefined;
  try { return JSON.parse(clean.slice(from, to + 1)); } catch { return undefined; }
}

function createGemini({
  key = '', model = DEFAULT_MODEL, fetch: doFetch = globalThis.fetch, timeoutMs = 12000,
  perMinute = 30, perDay = 1500, failMax = 4, coolMs = 60_000, now = Date.now
} = {}) {
  const enabled = typeof key === 'string' && key.length > 0 && typeof doFetch === 'function';
  let stamps = [];      /* horas de las llamadas del último minuto */
  let fails = 0;
  let day = -1, today = 0;   /* tope diario: cuesta dinero, y un bucle no debe poder vaciarlo */
  let coolUntil = 0;

  async function json({ prompt, system, temperature = 1, maxTokens = 900 }) {
    if (!enabled) throw fail('GEMINI_OFF');
    const t = now();
    if (t < coolUntil) throw fail('GEMINI_COOLING');
    stamps = stamps.filter((x) => t - x < 60_000);
    if (stamps.length >= perMinute) throw fail('GEMINI_LIMIT');
    const d = Math.floor(t / 86_400_000);
    if (d !== day) { day = d; today = 0; }
    if (today >= perDay) throw fail('GEMINI_DAILY');
    today++;
    stamps.push(t);

    const body = {
      contents: [{ role: 'user', parts: [{ text: String(prompt).slice(0, MAX_PROMPT) }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
    };
    if (system) body.systemInstruction = { parts: [{ text: String(system).slice(0, MAX_PROMPT) }] };

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await doFetch(`${BASE}${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          signal: ctl.signal
        });
      } catch (e) {
        throw fail(e && e.name === 'AbortError' ? 'GEMINI_TIMEOUT' : 'GEMINI_NETWORK'); /* sin e.message: podría traer la clave */
      }
      if (!res.ok) throw fail('GEMINI_HTTP_' + res.status);
      let data;
      try { data = await res.json(); } catch { throw fail('GEMINI_BAD'); }
      const raw = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts
        ? data.candidates[0].content.parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('') : '';
      const parsed = raw ? extractJson(raw) : undefined;
      if (parsed === undefined) throw fail('GEMINI_BAD');
      fails = 0;
      return parsed;
    } catch (e) {
      fails++;
      if (fails >= failMax) { coolUntil = now() + coolMs; fails = 0; }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const status = () => ({ enabled, model, cooling: now() < coolUntil });
  return { enabled, json, status };
}

module.exports = { createGemini, extractJson, DEFAULT_MODEL };
