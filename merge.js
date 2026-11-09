// Merge per-speaker ASR word timestamps (asr/<track>.json) into one timeline: words.json, transcript.md, transcript.srt.
// Usage: node merge.js recordings/<session> [glossar]   (default: session.json glossar)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import { load, fixWords } from './glossar.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: node merge.js <session-dir>'); process.exit(1); }
const meta = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
const gl = load(process.argv[3] ?? meta.glossar);
const GAP = 1.5;                                    // s of silence that ends a turn

const words = meta.tracks.flatMap(t => {
  const f = join(dir, 'asr', parse(t.file).name + '.json');
  if (!existsSync(f)) { console.warn(`fehlt: ${f}`); return []; }
  const d = JSON.parse(readFileSync(f, 'utf8'));
  // aligner drops punctuation: walk the full text in order and take the matching token
  const toks = (d.text ?? '').split(/\s+/), norm = x => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  let j = 0;
  return fixWords((d.words ?? d.segments ?? []).map(w => {
    const raw = (w.text ?? w.word).trim();
    const k = toks.findIndex((x, i) => i >= j && norm(x) === norm(raw));
    if (k >= 0 && k - j < 4) j = k + 1;
    return { who: t.name, w: k >= 0 && k + 1 === j ? toks[k] : raw, start: w.start, end: w.end };
  }), gl);   // per speaker, before interleaving
}).filter(w => w.w).sort((a, b) => a.start - b.start);

// turns per speaker (pause < GAP), then interleave by start; crosstalk no longer splits sentences
const open = new Map(), turns = [];
for (const w of words) {
  const t = open.get(w.who);
  if (t && w.start - t.end < GAP) { t.text += ' ' + w.w; t.end = w.end; }
  else { const n = { who: w.who, start: w.start, end: w.end, text: w.w }; open.set(w.who, n); turns.push(n); }
}
turns.sort((a, b) => a.start - b.start);

const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const srtT = s => new Date(s * 1000).toISOString().slice(11, 23).replace('.', ',');

writeFileSync(join(dir, 'words.json'), JSON.stringify(words, null, 1));
writeFileSync(join(dir, 'transcript.md'), `# ${meta.channel} – ${meta.started}\n\n` +
  turns.map(t => `**[${mmss(t.start)}] ${t.who}:** ${t.text}`).join('\n\n') + '\n');
writeFileSync(join(dir, 'transcript.srt'),
  turns.map((t, i) => `${i + 1}\n${srtT(t.start)} --> ${srtT(t.end)}\n${t.who}: ${t.text}\n`).join('\n'));
console.log(`${words.length} Wörter, ${turns.length} Redebeiträge → ${dir}/transcript.md`);
