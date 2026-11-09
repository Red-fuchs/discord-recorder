// Serial PnP session evaluation with a local LLM (Gemma-4 E4B Heretic via zunder; PNP_SERVER=vmlx|mlx_lm opts out):
// chunk transcript → per-chunk JSON (schema-guided) → rolling compact STAND → final Markdown recap.
// Usage: gpu-run -n pnp-auswertung --ram 10 node auswertung/run.mjs recordings/<session> [--glossar schicksal] [--nur 1-3] [--final]
// Resumable: existing chunk-NN.json / stand-NN.txt in <session>/auswertung/ are reused.
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { load, fixText } from '../glossar.js';

const HERE = import.meta.dirname;
const tok = s => Math.ceil(s.length / 3.5);
// protocol = E4B Heretic (fast, ok at extraction); blog/recap = Gemma-4 26B-A4B (much better prose, same speed per token)
const LAST = ['--szenen', '--final'].some(f => process.argv.includes(f));
const MODEL = process.env.PNP_MODEL ?? (LAST ? `${process.env.HOME}/AI-Model/models/gemma-4-26B-A4B-it-JANG_4M` : `${process.env.HOME}/AI-Model/models/zecanard/gemma-4-E4B-heretic-nothink`);   // Heretic E4B, template fixed: original hard-sets enable_thinking=true
const SERVER = process.env.PNP_SERVER ?? 'zunder';   // zunder (default) | vmlx | mlx_lm
const PORT = process.env.PNP_PORT ?? (SERVER === 'zunder' ? execFileSync('portwart', ['port', 'zunder']).toString().trim() : LAST ? '8097' : '8096');
const URL = `http://127.0.0.1:${PORT}/v1/chat/completions`;

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const dir = args.find(a => !a.startsWith('--') && existsSync(join(a, 'session.json')));
if (!dir) { console.error('usage: node auswertung/run.mjs <session-dir> [--glossar name] [--nur A-B] [--final]'); process.exit(2); }
const meta = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
const gl = load(opt('--glossar') ?? meta.glossar);
const cfg = { chunk_tokens: 3000, overlap_lines: 6, stand_max_chars: 2500, temperature: 0.2, max_tokens: 2048,
  ...(existsSync(join(HERE, 'config.json')) ? JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8')) : {}) };
const schema = existsSync(join(HERE, 'schema.json')) ? JSON.parse(readFileSync(join(HERE, 'schema.json'), 'utf8')) : null;
const OUT = join(dir, process.env.PNP_TAG ? `auswertung-${process.env.PNP_TAG}` : 'auswertung');   // PNP_TAG: model comparison in a separate dir
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.error(`[${new Date().toLocaleTimeString('de-DE')}]`, ...a);

// prompt file: system part, `---USER---`, user template; {KEY} placeholders
function prompt(name, vars) {
  const [sys, usr] = readFileSync(join(HERE, name), 'utf8').split(/^---USER---$/m);
  const fill = t => t.replace(/\{([A-ZÄÖÜ]+)\}/g, (m, k) => k in vars ? String(vars[k]) : m);
  return [{ role: 'system', content: fill(sys.trim()) }, { role: 'user', content: fill((usr ?? '').trim()) }];
}

const STAND_SCHEMA = { type: 'object', additionalProperties: false, required: ['ort', 'ziel', 'figuren', 'verlauf', 'offen', 'gesehen'], properties: {
  ort: { type: 'string', maxLength: 120 }, ziel: { type: 'string', maxLength: 200 }, figuren: { type: 'string', maxLength: 300 },
  verlauf: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 140 } }, offen: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 120 } },
  gesehen: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 40 } } } };
const standText = j => `Ort: ${j.ort}\nZiel: ${j.ziel}\nFiguren: ${j.figuren}\nVerlauf:\n${j.verlauf.map(v => '- ' + v.replace(/^[-•*]\s*/, '')).join('\n')}\nOffen:\n${j.offen.map(v => '- ' + v.replace(/^[-•*]\s*/, '')).join('\n')}\nGesehen: ${j.gesehen.join(', ')}`;

// plain http POST without fetch's 300 s headers timeout (long final generations)
const post = (url, body) => new Promise((ok, no) => {
  const r = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 0 }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => ok({ ok: res.statusCode < 300, status: res.statusCode, text: () => d, json: () => JSON.parse(d) }));
  });
  r.on('error', no); r.end(JSON.stringify(body));
});

async function chat(messages, json, o = {}, sch = schema) {
  const body = { model: MODEL, messages, temperature: cfg.temperature, top_p: cfg.top_p, repetition_penalty: cfg.repetition_penalty, max_tokens: cfg.max_tokens, chat_template_kwargs: { enable_thinking: false }, ...o,   // zunder defaults to thinking ON unless sent per request
    ...(json && sch ? { response_format: { type: 'json_schema', json_schema: { name: 'out', schema: sch, strict: true } } } : {}) };
  for (let a = 1; a <= 1 + (cfg.retry_on_invalid_json ?? 2); a++) {
    if (a > 1 && body.response_format) body.response_format.json_schema.strict = false;   // retry lenient, filter in code
    try {
      const r = await post(URL, body);
      if (!r.ok) throw new Error(`${r.status} ${r.text().slice(0, 200)}`);
      const j = r.json(), m = j.choices[0].message, t = (m.content ?? '').trim();
      writeFileSync(join(OUT, 'last-raw.txt'), `finish=${j.choices[0].finish_reason} usage=${JSON.stringify(j.usage)} keys=${Object.keys(m)}\nREASONING:\n${m.reasoning_content ?? m.reasoning ?? ''}\nCONTENT:\n${t}`);
      if (!t) throw new Error('leere Antwort (siehe last-raw.txt)');
      if (!json) return t;
      const raw = t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);   // tolerate stray text / fences around JSON
      for (const f of [x => x, x => x.replace(/\r?\n/g, '\\n'), x => x.replace(/[\u0000-\u001f]+/g, ' ')]) { try { return JSON.parse(f(raw)); } catch {} }
      throw new Error('kein gültiges JSON');
    } catch (e) { log(`Versuch ${a} fehlgeschlagen: ${e.message}`); if (a === 1 + (cfg.retry_on_invalid_json ?? 2)) { if (json) return null; throw e; } }
  }
}

// transcript → [{t, sec, who, text}] sorted by time (merged tracks are non-monotonic); speakers → role labels
const src = ['live.fixed.md', 'transcript.md', 'live.md'].map(f => join(dir, f)).find(existsSync);
const norm = x => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const label = who => Object.entries(cfg.speaker_labels ?? {}).find(([k]) => norm(k) === norm(who) || norm(who).startsWith(norm(k).slice(0, 8)))?.[1] ?? who;
const lines = fixText(readFileSync(src, 'utf8'), gl).split(/\n\n+/).map(l => l.match(/^\*\*\[(\d+):(\d\d)(?:\.\d)?\] (.+?):\*\* (.*)$/s))
  .filter(Boolean).map(([, m, ss, who, text]) => ({ t: `${m}:${ss}`, sec: +m * 60 + +ss, who: label(who), text: text.replace(/\s+/g, ' ') }))
  .sort((x, y) => x.sec - y.sec);
// chunks = chunk_minutes windows; too many lines → halve; tail < 30 lines merged into previous
const W = (cfg.chunk_minutes ?? 10) * 60, chunks = [];
for (let w = 0; w <= lines.at(-1).sec; w += W) {
  const win = lines.filter(l => l.sec >= w && l.sec < w + W);
  if (!win.length) continue;
  if (win.length > (cfg.chunk_lines_max ?? 140)) chunks.push(win.filter(l => l.sec < w + W / 2), win.filter(l => l.sec >= w + W / 2));
  else chunks.push(win);
}
if (chunks.length > 1 && chunks.at(-1).length < 30) chunks.at(-2).push(...chunks.pop());
const withOverlap = k => [...(k ? chunks[k - 1].slice(-cfg.overlap_lines) : []), ...chunks[k]];
// keep only entries whose t exists in the chunk and is >= VON (overlap lines are context only)
function validate(res, c) {
  const ts = new Set(c.map(l => l.t));
  for (const [k, v] of Object.entries(res)) if (Array.isArray(v)) res[k] = v.filter(e => typeof e !== 'object' || !e?.t || ts.has(e.t));
  return res;
}
const WELT = join(HERE, 'welt-schicksal.md');
const names = (existsSync(WELT) ? readFileSync(WELT, 'utf8').trim() + '\n\n' : '') + (existsSync(join(HERE, cfg.files?.namen ?? 'namen.md')) ? readFileSync(join(HERE, cfg.files?.namen ?? 'namen.md'), 'utf8').trim() : gl ? gl.terms.map(t => t.term).join(', ') : '');
const [a, b] = (opt('--nur') ?? `1-${chunks.length}`).split('-').map(Number);
log(`${src}: ${lines.length} Zeilen → ${chunks.length} Teile (${cfg.chunk_minutes ?? 10}-min-Fenster), bearbeite ${a}-${b}`);
if (args.includes('--dry')) { chunks.forEach((c, k) => console.log(k + 1, c[0].t, c.at(-1).t, c.length, 'Zeilen', tok(c.map(l => l.text).join(' ')), 'Tok', [...new Set(c.map(l => l.who))].join('/'))); process.exit(0); }

// own vMLX server WITHOUT --reasoning-parser: gemma-serve's gemma4 parser swallows Heretic's output (content+reasoning empty)
const PY = '/Applications/vMLX.app/Contents/Resources/bundled-python/python/bin/python3';
// PNP_SERVER=vmlx: old vMLX path (1.6.83 breaks non-streaming completions: unexpected keyword 'stop_sequence')
// PNP_SERVER=mlx_lm: plain mlx_lm.server (newer archs like LFM2.5; no guided JSON – parser must cope)
// default zunder: own Swift MLX server (~/Projects/zunder), json_schema enforced by llguidance; port from portwart; already inside gpu-run -> --no-lease
const srv = SERVER === 'zunder'
  ? spawn(process.env.PNP_ZUNDER ?? `${process.env.HOME}/Projects/zunder/.build/release/zunder`, ['serve', '--model', MODEL, '--port', PORT, '--no-lease', '--idle', '600'], { stdio: ['ignore', 'ignore', openSync(join(OUT, 'server.log'), 'w')] })
  : SERVER === 'mlx_lm'
  ? spawn(process.env.PNP_MLX_LM ?? '/opt/miniconda3/bin/mlx_lm.server', ['--model', MODEL, '--host', '127.0.0.1', '--port', PORT], { stdio: ['ignore', 'ignore', openSync(join(OUT, 'server.log'), 'w')] })
  : spawn(PY, ['-B', '-s', '-m', 'vmlx_engine.cli', 'serve', MODEL, '--host', '127.0.0.1', '--port', PORT, '--text-only',
    '--no-continuous-batching', '--max-num-seqs', '1', '--timeout', '900', '--chat-template-kwargs', '{"enable_thinking": false}'],
    { stdio: ['ignore', 'ignore', 'ignore'] });
process.on('exit', () => srv.kill('SIGKILL'));   // never leave the model in RAM (SIGTERM is ignored while generating)
process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));
for (let i = 0; ; i++) {
  if (await fetch(`http://127.0.0.1:${PORT}/v1/models`).then(r => r.ok, () => false)) break;
  if (i > 180 || srv.exitCode !== null) { log('Server startet nicht'); process.exit(1); }
  await new Promise(r => setTimeout(r, 1000));
}
log(`Server bereit auf :${PORT}`);

const pad = n => String(n).padStart(2, '0');
let stand = existsSync(join(HERE, cfg.files?.stand_start ?? 'stand-start.md')) ? readFileSync(join(HERE, cfg.files?.stand_start ?? 'stand-start.md'), 'utf8').trim() : '(Beginn der Sitzung – noch nichts bekannt)';
for (let k = 1; k < a; k++) if (existsSync(join(OUT, `stand-${pad(k)}.txt`))) stand = readFileSync(join(OUT, `stand-${pad(k)}.txt`), 'utf8');

const ONLY_BLOG = args.includes('--nur-blog'), TAG = opt('--tag') ? '.' + opt('--tag') : '';   // --nur-blog --tag 26b: model comparison without touching main results
for (let k = a; k <= Math.min(b, chunks.length) && !ONLY_BLOG; k++) {
  const fj = join(OUT, `chunk-${pad(k)}.json`), fs = join(OUT, `stand-${pad(k)}.txt`), c = chunks[k - 1], ctx = withOverlap(k - 1);
  if (existsSync(fj) && existsSync(fs)) { stand = readFileSync(fs, 'utf8'); continue; }
  const t0 = Date.now();
  const res = await chat(prompt('prompt-chunk.md', { STAND: stand, NAMEN: names, NR: k, GESAMT: chunks.length,
    VON: c[0].t, BIS: c.at(-1).t, CHUNK: ctx.map(l => `[${l.t}] ${l.who}: ${l.text}`).join('\n') }), true);
  if (!res) { log(`Teil ${k}: kein gültiges JSON → als fehler markiert`); }
  const ok = res ?? { von: c[0].t, bis: c.at(-1).t, fehler: true, ereignisse: [] };
  validate(ok, c);
  writeFileSync(fj, JSON.stringify(ok, null, 1));
  const sj = await chat(prompt('prompt-stand.md', { STAND: stand, ERGEBNIS: JSON.stringify(ok) }), true, { max_tokens: cfg.max_tokens_stand ?? 1000 }, STAND_SCHEMA);
  if (sj) stand = standText(sj).slice(0, cfg.stand_max_chars);
  writeFileSync(fs, stand);
  log(`Teil ${k}/${chunks.length} [${c[0].t}–${c.at(-1).t}] fertig in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// blog pass: one narrative paragraph per chunk (state before chunk + raw lines), then frame (title/intro/subtitles/outlook)
const startStand = existsSync(join(HERE, cfg.files?.stand_start ?? 'stand-start.md')) ? readFileSync(join(HERE, cfg.files?.stand_start ?? 'stand-start.md'), 'utf8').trim() : '';
const DATUM = new Date(meta.started).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
// --szenen: blog by scenes (model segments the session from all chunk events, then one section per scene)
if (args.includes('--szenen')) {
  const evs = chunks.map((_, k) => join(OUT, `chunk-${pad(k + 1)}.json`)).filter(existsSync).flatMap(f => JSON.parse(readFileSync(f, 'utf8')).ereignisse ?? []).filter(e => e?.t);
  const fs = join(OUT, 'szenen.json'), sec = t => { const [m, x] = t.split(':').map(Number); return m * 60 + x; };
  if (!existsSync(fs)) {
    const SZ = { type: 'object', additionalProperties: false, required: ['szenen'], properties: { szenen: { type: 'array', minItems: 6, maxItems: 14,
      items: { type: 'object', additionalProperties: false, required: ['von', 'titel'], properties: { von: { type: 'string', pattern: '^\\d{1,3}:[0-5]\\d$' }, titel: { type: 'string', maxLength: 60 } } } } } };
    const r = await chat(prompt('prompt-szenen.md', { EREIGNISSE: evs.map(e => `${e.t} · ${e.was ?? ''}`).join('\n') }), true, { max_tokens: 1500, temperature: 0.2 }, SZ);
    writeFileSync(fs, JSON.stringify(r.szenen.sort((x, y) => sec(x.von) - sec(y.von)), null, 1));
  }
  const sz = JSON.parse(readFileSync(fs, 'utf8')); sz[0].von = '00:00';
  const MAXS = (cfg.scene_max_minutes ?? 35) * 60, end = lines.at(-1).sec + 1, mmss = x => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
  for (let i = 0; i < sz.length; i++) {   // split over-long scenes into equal parts (keeps title, adds I/II/III)
    const a0 = sec(sz[i].von), a1 = i + 1 < sz.length ? sec(sz[i + 1].von) : end, n = Math.ceil((a1 - a0) / MAXS);
    if (n > 1) sz.splice(i, 1, ...Array.from({ length: n }, (_, j) => ({ von: mmss(Math.round(a0 + j * (a1 - a0) / n)), titel: `${sz[i].titel} (${['I', 'II', 'III', 'IV'][j] ?? j + 1})` })));
  }
  log(`${sz.length} Szenen: ${sz.map(x => x.von + ' ' + x.titel).join(' | ')}`);
  const TS = { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', minLength: 800, maxLength: 5000 } } };
  for (let i = 0; i < sz.length; i++) {
    const f = join(OUT, `szene-${pad(i + 1)}.md`); if (existsSync(f)) continue;
    const a0 = sec(sz[i].von), a1 = i + 1 < sz.length ? sec(sz[i + 1].von) : Infinity, L = lines.filter(l => l.sec >= a0 && l.sec < a1);
    if (!L.length) { writeFileSync(f, ''); continue; }
    const k = chunks.findIndex(c => c.at(-1).sec >= a0), st = k > 0 && existsSync(join(OUT, `stand-${pad(k)}.txt`)) ? readFileSync(join(OUT, `stand-${pad(k)}.txt`), 'utf8') : startStand;
    const prev = i ? readFileSync(join(OUT, `szene-${pad(i)}.md`), 'utf8').slice(-600) : '(Anfang)', t0 = Date.now();
    const r = await chat(prompt('prompt-blog-szene.md', { STAND: st, NAMEN: names, VORHER: prev, NR: i + 1, GESAMT: sz.length, TITEL: sz[i].titel, VON: L[0].t, BIS: L.at(-1).t,
      FAKTEN: evs.filter(e => sec(e.t) >= a0 && sec(e.t) < a1).map(e => `[${e.t}] ${e.was ?? ''}`).join('\n') || '(keine)',
      CHUNK: L.map(l => `[${l.t}] ${l.who}: ${l.text}`).join('\n') }), true, { max_tokens: 2500, temperature: cfg.temperature_blog ?? 0.7 }, TS);
    writeFileSync(f, (r?.text ?? '').trim() + '\n');
    log(`Szene ${i + 1}/${sz.length} „${sz[i].titel}“ (${L.length} Zeilen) fertig in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  const parts = sz.map((_, i) => readFileSync(join(OUT, `szene-${pad(i + 1)}.md`), 'utf8').trim());
  const R2 = { type: 'object', additionalProperties: false, required: ['titel', 'einstieg', 'ausblick'], properties: {
    titel: { type: 'string', maxLength: 80 }, einstieg: { type: 'string', maxLength: 600 }, ausblick: { type: 'string', maxLength: 500 } } };
  const fr = await chat(prompt('prompt-blog-rahmen.md', { DATUM, STAND: stand, ABSAETZE: parts.map((p, i) => `${i + 1}. ${sz[i].titel}: ${p.slice(0, 400)}`).join('\n') }), true, { max_tokens: 1500, temperature: 0.5 }, R2);
  writeFileSync(join(OUT, 'blog-szenen.md'), `# ${fr.titel}\n\n*Schicksalsschlag – Runde vom ${DATUM}*\n\n${fr.einstieg}\n\n` +
    parts.map((p, i) => p ? `## ${sz[i].titel}\n\n${p}` : '').filter(Boolean).join('\n\n') + `\n\n## Wie es weitergeht\n\n${fr.ausblick}\n`);
  log(`Blog (Szenen) → ${join(OUT, 'blog-szenen.md')}`);
  process.exit(0);
}

if (!args.includes('--ohne-blog')) {
  for (let k = a; k <= Math.min(b, chunks.length); k++) {
    const fb = join(OUT, `blog-${pad(k)}${TAG}.md`), c = chunks[k - 1];
    if (existsSync(fb)) continue;
    const st = k > 1 && existsSync(join(OUT, `stand-${pad(k - 1)}.txt`)) ? readFileSync(join(OUT, `stand-${pad(k - 1)}.txt`), 'utf8') : startStand;
    const prev = k > 1 && existsSync(join(OUT, `blog-${pad(k - 1)}${TAG}.md`)) ? readFileSync(join(OUT, `blog-${pad(k - 1)}${TAG}.md`), 'utf8') : '(Anfang)';
    const t0 = Date.now();
    const BS = { type: 'object', additionalProperties: false, required: ['absatz'], properties: { absatz: { type: 'string', minLength: 300, maxLength: 2000 } } };
    const cj = existsSync(join(OUT, `chunk-${pad(k)}.json`)) ? JSON.parse(readFileSync(join(OUT, `chunk-${pad(k)}.json`), 'utf8')) : {};
    const FAKTEN = [...(cj.ereignisse ?? []), ...(cj.offen ?? [])].filter(e => e?.t).map(e => `[${e.t}] ${e.was ?? e.text ?? JSON.stringify(e)}`).join('\n') || '(keine)';
    const bj = await chat(prompt('prompt-blog.md', { FAKTEN, STAND: st, NAMEN: names, VORHER: prev.slice(-600), NR: k, GESAMT: chunks.length,
      VON: c[0].t, BIS: c.at(-1).t, CHUNK: c.map(l => `[${l.t}] ${l.who}: ${l.text}`).join('\n') }), true,
      { max_tokens: cfg.max_tokens_blog ?? 900, temperature: cfg.temperature_blog ?? 0.7 }, BS);   // JSON-wrapped: stops Heretic's visible planning notes
    writeFileSync(fb, (bj?.absatz ?? '–').trim() + '\n');
    log(`Blog ${k}/${chunks.length} fertig in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  const parts = chunks.map((_, k) => join(OUT, `blog-${pad(k + 1)}.md`));
  if (!TAG && parts.every(existsSync)) {
    const ps = parts.map(f => readFileSync(f, 'utf8').trim());
    const R = { type: 'object', additionalProperties: false, required: ['titel', 'einstieg', 'zwischentitel', 'ausblick'], properties: {
      titel: { type: 'string', maxLength: 80 }, einstieg: { type: 'string', maxLength: 600 },
      zwischentitel: { type: 'array', items: { type: 'string', maxLength: 50 } }, ausblick: { type: 'string', maxLength: 500 } } };
    const fr = await chat(prompt('prompt-blog-rahmen.md', { DATUM, STAND: stand, ABSAETZE: ps.map((p, i) => `${i + 1}. ${p.slice(0, 400)}`).join('\n') }), true,
      { max_tokens: 1500, temperature: 0.5 }, R);
    const body = ps.map((p, i) => p === '–' || !p ? '' : `## ${fr.zwischentitel[i] && fr.zwischentitel[i] !== '–' ? fr.zwischentitel[i] : `Teil ${i + 1}`}\n\n${p}`).filter(Boolean).join('\n\n');
    writeFileSync(join(OUT, 'blog.md'), `# ${fr.titel}\n\n*Schicksalsschlag – Runde vom ${DATUM}*\n\n${fr.einstieg}\n\n${body}\n\n## Wie es weitergeht\n\n${fr.ausblick}\n`);
    log(`Blog → ${join(OUT, 'blog.md')}`);
  }
}

if (!ONLY_BLOG && (args.includes('--final') || (b >= chunks.length && !existsSync(join(OUT, 'recap.md'))))) {
  const keys = cfg.ergebnisse_compact_keys, drop = cfg.ergebnisse_drop_for_final_if_over_tokens;
  let all = chunks.map((_, k) => join(OUT, `chunk-${pad(k + 1)}.json`)).filter(existsSync)
    .map(f => JSON.parse(readFileSync(f, 'utf8'))).map(r => keys ? Object.fromEntries(keys.filter(k => k in r).map(k => [k, r[k]])) : r);
  if (drop && tok(JSON.stringify(all)) > drop.limit) all = all.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.drop.includes(k))));
  log(`Final: ${tok(JSON.stringify(all))} Tokens Eingabe`);
  const MS = { type: 'object', additionalProperties: false, required: ['markdown'], properties: { markdown: { type: 'string' } } };
  const mj = await chat([...prompt('prompt-final.md', { STAND: stand, NAMEN: names, DATUM, ERGEBNISSE: JSON.stringify(all) }).slice(0, 1),
    { role: 'user', content: prompt('prompt-final.md', { STAND: stand, NAMEN: names, DATUM, ERGEBNISSE: JSON.stringify(all) })[1].content + '\n\nAntworte nur mit JSON {"markdown": "<fertiger Recap>"} – keine Analyse, keine Planung.' }],
    true, { max_tokens: cfg.max_tokens_final ?? 4000, temperature: cfg.temperature_final ?? 0.3 }, MS);   // JSON-wrapped: free text leaks planning notes
  const md = mj?.markdown ?? '(Recap fehlgeschlagen – siehe last-raw.txt)';
  writeFileSync(join(OUT, 'recap.md'), md + '\n');
  log(`Recap → ${join(OUT, 'recap.md')}`);
}
process.exit(0);
