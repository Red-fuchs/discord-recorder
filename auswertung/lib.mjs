// Shared helpers for the auswertung CLI + meeting mode (run.mjs stays self-contained on purpose).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load, fixText } from '../glossar.js';

export const REC = join(import.meta.dirname, '..', 'recordings');
export const norm = x => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const meta = dir => JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
export const typ = m => m.glossar ? 'pnp' : /coworking|allgemein/i.test(m.channel ?? '') ? 'meeting' : 'pnp';
export const outDir = (dir, t) => join(dir, t === 'meeting' ? 'auswertung-meeting' : 'auswertung');

// <session>: path, name under recordings/, or unique substring
export function resolveSession(s) {
  for (const p of [resolve(s), join(REC, s)]) if (existsSync(join(p, 'session.json'))) return p;
  const hits = existsSync(REC) ? readdirSync(REC).filter(d => d.includes(s) && existsSync(join(REC, d, 'session.json'))) : [];
  if (hits.length === 1) return join(REC, hits[0]);
  throw Object.assign(new Error(hits.length ? `mehrdeutig: ${hits.join(', ')}` : `Session nicht gefunden: ${s}`), { code: 3 });
}

export const transcriptFile = dir => ['live.fixed.md', 'transcript.md', 'live.md'].map(f => join(dir, f)).find(existsSync);
// -> [{t:'m:ss', sec, who, text}] sorted by time
export function lines(dir, glossar) {
  const src = transcriptFile(dir), gl = load(glossar ?? (typ(meta(dir)) === 'meeting' ? 'meeting' : null));   // meeting sessions: names/terms glossary applied before the LLM
  return fixText(readFileSync(src, 'utf8'), gl).split(/\n\n+/).map(l => l.match(/^\*\*\[(\d+):(\d\d)(?:\.\d)?\] (.+?):\*\* (.*)$/s))
    .filter(Boolean).map(([, m, s, who, text]) => ({ t: `${m}:${s}`, sec: +m * 60 + +s, who, text: text.replace(/\s+/g, ' ') })).sort((a, b) => a.sec - b.sec);
}
// quote must occur (normalized) in a line within ±win seconds of t
export const quoteOk = (ls, t, q, win = 45) => {
  const [m, s] = t.split(':').map(Number), sec = m * 60 + s, nq = norm(q);
  return nq.length >= 6 && ls.some(l => Math.abs(l.sec - sec) <= win && norm(l.text).includes(nq));
};
