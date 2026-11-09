// Meeting evaluation, cascade: 26B per chunk (pass 1 candidate quotes → pass 2 classification) → rules in code (rules.mjs) → overview → Markdown rendered in code.
// Every item needs a transcript timestamp + short verbatim quote; decisions need a proposal plus explicit assent by another speaker (else proposal); tasks need a first-person commitment or accepted assignment in the quoted sentence; numbers come from regex, LLM only attributes them.
// Usage: gpu-run -n auswertung-meeting --ram 20 node auswertung/meeting.mjs <session-dir> [--nur A-B] [--final] [--dry] [--out file.md]
// Resumable (chunk-NN.json v2 reused). Server: zunder (default, port from portwart; both models share that port, sequentially); MEET_SERVER=vmlx opts back (ports 8096/8097). Env: MEET_MODEL (chunk model, default gemma-4-26B-A4B JANG_4M; E4B = $HOME/AI-Model/models/zecanard/gemma-4-E4B-heretic-nothink), MEET_FINAL=e4b (default/26b: 26B; same model as chunks = no server restart), MEET_PORT, MEET_PORT_FINAL (vmlx only).
// Failed chunks (fehler) are recomputed on resume; any failed chunk or missing overview → warning on top of auswertung.md + exit 1.
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { meta as readMeta, norm, outDir, lines as readLines, quoteOk } from './lib.mjs';
import { mkRules, sim } from './rules.mjs';

const HERE = import.meta.dirname, HOME = process.env.HOME;
const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const dir = args.find(a => !a.startsWith('--') && existsSync(join(a, 'session.json')));
if (!dir) { console.error('usage: node auswertung/meeting.mjs <session-dir> [--nur A-B] [--final] [--dry] [--out file.md]'); process.exit(2); }
const meta = readMeta(dir), OUT = outDir(dir, 'meeting'), pad = n => String(n).padStart(2, '0');
const log = (...a) => console.error(`[${new Date().toLocaleTimeString('de-DE')}]`, ...a);
const cfg = { chunk_minutes: 15, chunk_lines_max: 220, overlap_lines: 8, max_tokens_p1: 1800, max_tokens_p2: 2200, assent_window_s: 90, ...(JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8')).meeting ?? {}) };
const M_E4B = `${HOME}/AI-Model/models/zecanard/gemma-4-E4B-heretic-nothink`, M_26B = `${HOME}/AI-Model/models/gemma-4-26B-A4B-it-JANG_4M`;

const ls = readLines(dir, meta.glossar), who = [...new Set(ls.map(l => l.who))];
const W = cfg.chunk_minutes * 60, chunks = [];
for (let w = 0; w <= ls.at(-1).sec; w += W) {
  const win = ls.filter(l => l.sec >= w && l.sec < w + W);
  if (!win.length) continue;
  if (win.length > cfg.chunk_lines_max) { const h = Math.ceil(win.length / 2); chunks.push(win.slice(0, h), win.slice(h)); } else chunks.push(win);
}
if (chunks.length > 1 && chunks.at(-1).length < 25) chunks.at(-2).push(...chunks.pop());
const [a, b] = (opt('--nur') ?? `1-${chunks.length}`).split('-').map(Number);
if (args.includes('--dry')) { chunks.forEach((c, k) => console.log(k + 1, c[0].t, c.at(-1).t, c.length, 'Zeilen')); process.exit(0); }
mkdirSync(OUT, { recursive: true });

const post = (url, body) => new Promise((ok, no) => {
  const r = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 0 }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => ok({ ok: res.statusCode < 300, status: res.statusCode, text: () => d, json: () => JSON.parse(d) }));
  });
  r.on('error', no); r.end(JSON.stringify(body));
});
let srv = null, MODEL, PORT;
const up = port => fetch(`http://127.0.0.1:${port}/v1/models`).then(r => r.ok, () => false);
async function serve(model, port, zunder = process.env.MEET_SERVER !== 'vmlx') {   // own server only; refuses to touch a foreign one on the port
  if (srv) { srv.kill('SIGKILL'); srv = null; await new Promise(r => setTimeout(r, 4000)); }
  if (zunder) port = execFileSync('portwart', ['port', 'zunder']).toString().trim();
  if (await up(port)) { log(`Port ${port} belegt (fremder Server) – abgebrochen`); process.exit(1); }
  MODEL = model; PORT = port;
  const sl = openSync(join(OUT, 'server.log'), 'a');
  srv = zunder ? spawn(process.env.PNP_ZUNDER ?? `${HOME}/Projects/zunder/.build/release/zunder`, ['serve', '--model', model, '--port', port, '--no-lease', '--idle', '600'], { stdio: ['ignore', 'ignore', sl] })
    : spawn('/Applications/vMLX.app/Contents/Resources/bundled-python/python/bin/python3', ['-B', '-s', '-m', 'vmlx_engine.cli', 'serve', model, '--host', '127.0.0.1', '--port', port, '--text-only',
      '--no-continuous-batching', '--max-num-seqs', '1', '--timeout', '900', '--chat-template-kwargs', '{"enable_thinking": false}'], { stdio: ['ignore', 'ignore', sl] });
  for (let i = 0; ; i++) {
    if (await up(port)) break;
    if (i > 300 || srv.exitCode !== null) { log('Server startet nicht'); process.exit(1); }
    await new Promise(r => setTimeout(r, 1000));
  }
  log(`Server bereit auf :${port} (${model.split('/').at(-1)}${zunder ? ', zunder' : ''})`);
}
process.on('exit', () => srv?.kill('SIGKILL'));
process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));

function prompt(name, vars) {
  const [sys, usr] = readFileSync(join(HERE, name), 'utf8').split(/^---USER---$/m), fill = t => t.replace(/\{([A-ZÄÖÜ]+)\}/g, (m, k) => k in vars ? String(vars[k]) : m);
  return [{ role: 'system', content: fill(sys.trim()) }, { role: 'user', content: fill(usr.trim()) }];
}
// lenient: json_schema non-strict (or none), tolerant parse; ONE retry at temp 0 only when `bad(res)` (invalid JSON / non-monotonic), never doubled
const TJ = { type: 'object', additionalProperties: true };
async function chat(messages, max_tokens, bad = () => false, o = {}) {
  let res = null;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await post(`http://127.0.0.1:${PORT}/v1/chat/completions`, { model: MODEL, messages, temperature: i ? 0 : 0.1, top_p: 0.9, top_k: 64, repetition_penalty: 1.05, max_tokens, chat_template_kwargs: { enable_thinking: false }, ...o,   // zunder: thinking ON unless sent per request
        response_format: { type: 'json_schema', json_schema: { name: 'out', schema: o.schema ?? TJ, strict: false } } });
      if (!r.ok) throw new Error(`${r.status} ${r.text().slice(0, 160)}`);
      const t = (r.json().choices[0].message.content ?? '').trim();
      writeFileSync(join(OUT, 'last-raw.txt'), t);
      const raw = t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
      for (const f of [x => x, x => x.replace(/[\u0000-\u001f]+/g, ' '), x => x.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001f]+/g, ' ')]) { try { res = JSON.parse(f(raw)); break; } catch {} }
      if (res && !bad(res)) return res;
      if (!res) throw new Error('kein gültiges JSON');
      log('Zeitstempel nicht monoton → Wiederholung bei Temp 0');
    } catch (e) { log(`Versuch ${i + 1} fehlgeschlagen: ${e.message}`); }
  }
  return res;   // may be non-monotonic: caller sorts
}

// ---- helpers ----
const { classify, sec } = mkRules(ls, who, cfg);
const NUM = [/\d[\d.,]*\s?(€|euro|eur\b|dollar|\$|tausend|k\b)/gi, /\b\w+ (euro|€)/gi, /\d[\d.,]*\s?(prozent|%)/gi, /\b\d{1,2}\.\d{1,2}\.(\d{2,4})?/g,
  /\bbis (montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|ende \w+)\b/gi, /\b\d[\d.,]*\s?(monat\w*|jahr\w*|woche\w*|stunde\w*|tag\w*|user|nutzer|büch\w*|gb|mb|leute\w*|mitglied\w*|spender|abo\w*)\b/gi];

function numberHits(c, von) {
  const hits = [];
  for (const l of c) if (l.sec >= sec(von)) for (const re of NUM) for (const m of l.text.matchAll(re)) {
    if (hits.some(h => h.t === l.t && (h.wert.includes(m[0]) || m[0].includes(h.wert)))) continue;
    hits.push({ t: l.t, wert: m[0].trim(), kontext: l.text.slice(Math.max(0, m.index - 70), m.index + m[0].length + 50) });
  }
  return hits.slice(0, 16);
}
async function doChunk(k) {
  const c = chunks[k - 1], von = c[0].t, ctx = [...(k > 1 ? chunks[k - 2].slice(-cfg.overlap_lines) : []), ...c], t0 = Date.now();
  const mono = r => { const s = (r.kandidaten ?? []).map(x => sec(String(x.t ?? '0:0'))); return s.filter((x, i) => i && x < s[i - 1]).length <= s.length * 0.2; };   // small disorder is fixed by sorting in code; only real scrambling is retried
  const p1 = await chat(prompt('prompt-meeting-p1.md', { NR: k, GESAMT: chunks.length, VON: von, BIS: c.at(-1).t, TEILNEHMER: who.join(', '),
    CHUNK: ctx.map(l => `[${l.t}] ${l.who}: ${l.text}`).join('\n') }), cfg.max_tokens_p1, r => !mono(r));   // chat() takes `bad`; mono = order is good
  const ts = new Set(c.map(l => l.t));
  const cands = (p1?.kandidaten ?? []).filter(x => x?.t && ts.has(x.t) && sec(x.t) >= sec(von) && quoteOk(ls, x.t, x.zitat ?? '')).sort((x, y) => sec(x.t) - sec(y.t))
    .filter((x, i, arr) => !arr.slice(0, i).some(y => y.t === x.t && norm(y.zitat) === norm(x.zitat))).slice(0, 30);
  const nums = numberHits(ctx, von), seen = new Set(), show = (t) => { const x = sec(t); return ls.filter(l => l.sec >= x - 15 && l.sec <= x + 25 && !seen.has(l)).map(l => { seen.add(l); return `[${l.t}] ${l.who}: ${l.text}`; }).join('\n'); };
  let items = [], zn = [], p2fail = false;
  if (cands.length || nums.length) {
    const p2 = await chat(prompt('prompt-meeting-p2.md', { TEILNEHMER: who.join(', '),
      KAND: cands.map((x, i) => `#${i + 1} [${x.t}] „${x.zitat}“\n${show(x.t)}`).join('\n---\n') || '(keine)',
      ZAHLEN: nums.map((h, j) => `#${j + 1} [${h.t}] ${h.wert} · …${h.kontext}…`).join('\n') || '(keine)' }), cfg.max_tokens_p2);
    items = (p2?.items ?? []).filter(x => x && Number.isInteger(+x.i)).map(x => ({ ...x, i: +x.i })); zn = p2?.zahlen ?? [];
    if (!p2) { p2fail = true; log(`Teil ${k}: Klassifikation fehlgeschlagen`); }
  }
  const res = { v: 2, von, bis: c.at(-1).t, fehler: !p1 || p2fail, themen: (p1?.themen ?? []).slice(0, 4).map(String), kandidaten: cands.length, ...classify(cands, items),
    zahlen: nums.map((h, j) => ({ t: h.t, wert: h.wert, was: (zn.find(z => +z.j === j + 1)?.was ?? '').trim() || 'erwähnt, Kontext unklar', zitat: h.kontext.trim().split(/\s+/).slice(0, 8).join(' ') })) };
  writeFileSync(join(OUT, `chunk-${pad(k)}.json`), JSON.stringify(res, null, 1));
  log(`Teil ${k}/${chunks.length} [${von}–${res.bis}] ${cands.length} Kandidaten, ${nums.length} Zahlen, fertig in ${((Date.now() - t0) / 1000).toFixed(0)} s${res.fehler ? ' FEHLER' : ''}`);
}

const valid = k => { try { const c = JSON.parse(readFileSync(join(OUT, `chunk-${pad(k)}.json`), 'utf8')); return c.v === 2 && !c.fehler; } catch { return false; } };   // failed chunks are recomputed
const todo = []; for (let k = a; k <= Math.min(b, chunks.length); k++) if (!valid(k)) todo.push(k);
if (todo.length) { await serve(process.env.MEET_MODEL ?? M_26B, process.env.MEET_PORT ?? '8096'); for (const k of todo) await doChunk(k); }
const failed = []; for (let k = a; k <= Math.min(b, chunks.length); k++) if (!valid(k)) failed.push(k);   // only parts inside --nur count as failed
let exitCode = failed.length ? 1 : 0;

// ---- final: merge + dedupe in code, overview by big model, Markdown rendered in code ----
if (args.includes('--final') || b >= chunks.length) {
  const all = chunks.map((_, k) => k + 1).filter(valid).map(k => JSON.parse(readFileSync(join(OUT, `chunk-${pad(k)}.json`), 'utf8')));
  const LISTS = ['beschluesse', 'vorschlaege', 'aufgaben', 'offene_fragen', 'zahlen', 'risiken', 'anwesenheit', 'rollen'];
  const key = e => e.was ?? e.frage ?? `${e.wer} ${e.art ?? e.rolle}`;
  const D = Object.fromEntries(LISTS.map(k => [k, []]));
  for (const r of all) for (const k of LISTS) for (const e of r[k] ?? []) if (!D[k].some(o => (k === 'zahlen' ? o.t === e.t && o.wert === e.wert : o.t === e.t || sim(key(o), key(e)) > 0.7 || (k === 'beschluesse' && Math.abs(sec(o.t) - sec(e.t)) <= cfg.assent_window_s && sim(key(o), key(e)) > 0.5)))) D[k].push(e);
  for (const k of LISTS) D[k].sort((x, y) => sec(x.t) - sec(y.t));
  D.vorschlaege = D.vorschlaege.filter(v => !D.beschluesse.some(x => sim(x.was, v.was) > 0.6));
  const themen = all.flatMap(r => (r.themen ?? []).map(x => `[${r.von}] ${x}`));
  const dauer = Math.round(ls.at(-1).sec / 60), datum = new Date(meta.started).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const li = (arr, f) => arr.map(e => `[${e.t}] ${f(e)}`).join('\n') || '(keine)';
  const FM = process.env.MEET_FINAL === 'e4b' ? M_E4B : M_26B;   // memory is gpu-run's RAM gate's job
  if (!srv || MODEL !== FM) await serve(FM, FM === M_E4B ? process.env.MEET_PORT ?? '8096' : process.env.MEET_PORT_FINAL ?? '8097');
  const ov = await chat(prompt('prompt-meeting-final.md', { DATUM: datum, KANAL: meta.channel, DAUER: dauer, TEILNEHMER: who.join(', '), THEMEN: themen.join('\n') || '(keine)',
    BESCHLUESSE: li(D.beschluesse, e => `${e.was} (Zustimmung: ${e.zustimmung.join(', ')})`), VORSCHLAEGE: li(D.vorschlaege, e => `${e.was} (${e.von ?? '?'})`), AUFGABEN: li(D.aufgaben, e => `${e.was} · ${e.owner ?? 'offen'} · ${e.frist ?? 'ohne Frist'}`) }), 800, () => false, { temperature: 0.3 });
  const sp = who.map(w => { const m = ls.filter(l => l.who === w); return { w, von: m[0].t, bis: m.at(-1).t, n: m.length, geht: D.anwesenheit.find(e => e.wer === w && e.art === 'geht'), kommt: D.anwesenheit.find(e => e.wer === w && e.art === 'kommt') }; }).sort((x, y) => sec(x.von) - sec(y.von));
  const cell = s => String(s ?? '').replace(/\|/g, '/'), q = e => e.zitat ? ` — „${e.zitat}“` : '';
  const missing = chunks.map((_, k) => k + 1).filter(k => !valid(k) && !failed.includes(k)), problems = [failed.length && `Teile ${failed.join(', ')} fehlgeschlagen`, !ov?.uebersicht && 'Übersicht fehlgeschlagen', missing.length && `Teile ${missing.join(', ')} nicht ausgewertet`].filter(Boolean);
  if (!ov?.uebersicht) exitCode = 1;
  const md = [
    ...(problems.length ? [`> **WARNUNG: Auswertung unvollständig – ${problems.join('; ')}. Ergebnis nicht belastbar.** Teile (Zeitraum): ${[...failed, ...missing].map(k => `${k} (${chunks[k - 1][0].t}–${chunks[k - 1].at(-1).t})`).join(', ') || '–'}`] : []),
    `# ${ov?.titel ?? 'Meeting-Protokoll'}`, `*${meta.channel} · ${datum} · ${dauer} Min · Zeitangaben [mm:ss] beziehen sich auf das Transkript*`,
    `## Übersicht\n\n${ov?.uebersicht ?? '(Übersicht fehlgeschlagen)'}\n\n${themen.length ? 'Themen: ' + themen.map(x => x.replace(/^\[(.+?)\] /, '$1 ')).join(' · ') : ''}`.trim(),
    `## Beschlüsse\n\n` + (D.beschluesse.map(e => `- [${e.t}] ${e.was} (Zustimmung: ${e.zustimmung.join(', ')})${q(e)}${e.t2 ? ` · [${e.t2}] „${e.zitat2}“` : ''}`).join('\n') || '_Keine ausdrücklichen Beschlüsse (Zustimmung mehrerer Sprecher) im Transkript._'),
    `## Vorschläge (offen)\n\n` + (D.vorschlaege.map(e => `- [${e.t}] ${e.was}${e.von ? ` (${e.von})` : ''}${q(e)}`).join('\n') || '_Keine._'),
    `## Aufgaben\n\n` + (D.aufgaben.length ? `| Aufgabe | Owner | Frist | TS |\n|---|---|---|---|\n` + D.aufgaben.map(e => `| ${cell(e.was)} | ${e.owner ?? 'offen'} | ${e.frist ?? '–'} | [${e.t}] |`).join('\n') : '_Keine Aufgaben mit Zusage im Transkript._'),
    `## Zahlen & Kosten\n\n` + (D.zahlen.map(e => `- [${e.t}] **${e.wert}** – ${e.was}`).join('\n') || '_Keine._'),
    `## Risiken\n\n` + (D.risiken.map(e => `- [${e.t}] ${e.was}${q(e)}`).join('\n') || '_Keine geäußert._'),
    `## Offene Fragen\n\n` + (D.offene_fragen.map(e => `- [${e.t}] ${e.frage}${e.von ? ` (${e.von})` : ''}`).join('\n') || '_Keine._'),
    `## Anwesenheit\n\nAus Wortmeldungen abgeleitet (erste/letzte Äußerung); „geht/kommt“ nur, wo ausdrücklich gesagt. „Letzte Äußerung“ weit vor Ende = vermutlich früher gegangen.\n\n| Teilnehmer | Erste Äußerung | Letzte Äußerung | Beiträge | Hinweis |\n|---|---|---|---|---|\n` +
      sp.map(s => `| ${s.w} | [${s.von}] | [${s.bis}] | ${s.n} | ${[s.kommt && `kommt [${s.kommt.t}]`, s.geht && `geht [${s.geht.t}]`, !s.geht && sec(s.bis) < ls.at(-1).sec - 600 && 'keine Äußerung mehr ab [' + s.bis + ']'].filter(Boolean).join(', ') || '–'} |`).join('\n') +
      (D.rollen.length ? `\n\nGenannte Rollen: ` + D.rollen.map(e => `${e.wer}: ${e.rolle} [${e.t}]`).join('; ') : ''),
  ].join('\n\n') + '\n';
  const fo = opt('--out') ?? join(OUT, 'auswertung.md');
  writeFileSync(join(OUT, 'meeting.json'), JSON.stringify({ ...D, themen, uebersicht: ov, sprecher: sp, fehler: failed, fehlend: missing, gesamt: chunks.length }, null, 1));
  writeFileSync(fo, md);
  log(`Protokoll → ${fo}`);
}
process.exit(exitCode);
