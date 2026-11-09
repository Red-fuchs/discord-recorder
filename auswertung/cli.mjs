#!/usr/bin/env node
// auswertung CLI: run | status | list | check. Exit: 0 ok, 1 check mismatch/failed run, 2 usage, 3 not found.
// GPU runs are NOT queued here: wrap with `gpu-run -n auswertung --ram 10 auswertung run …`.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REC, meta, typ, outDir, resolveSession, lines, norm } from './lib.mjs';

const HERE = import.meta.dirname, argv = process.argv.slice(2), JSON_OUT = argv.includes('--json');
const [cmd, ...rest] = argv.filter(a => a !== '--json');
const opt = k => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
const pos = rest.filter((a, i) => !a.startsWith('--') && !['--typ', '--nur', '--md', '--out', '--glossar'].includes(rest[i - 1]));
const out = (o, text) => console.log(JSON_OUT ? JSON.stringify(o, null, 1) : text);
const die = (code, msg) => { JSON_OUT ? console.log(JSON.stringify({ error: msg, code })) : console.error(msg); process.exit(code); };

const HELP = `auswertung – Sitzungs-Auswertung (PnP-Recap / Meeting-Protokoll) aus Discord-Recorder-Transkripten

  auswertung run <session> [--typ pnp|meeting] [--nur A-B] [--final] [--out datei.md] [--glossar name]
      typ automatisch: Glossar gesetzt → pnp; Kanal Coworking/Allgemein → meeting; sonst pnp.
      LLM-Lauf: mit  gpu-run -n auswertung --ram 10 auswertung run …  starten.
  auswertung status [<session>]     Fortschritt (Teile, Final) · ohne Angabe: neueste Session mit Auswertung
  auswertung list                   Sessions + vorhandene Ausgaben
  auswertung eval <session> [--json]   Recall gegen golden.json (bekannte Fakten der Session): Owner, Vorschläge≠Beschlüsse, Kosten, Risiken, Gehen
  auswertung check <session> [--md datei]   Belegprüfung: jeder [mm:ss]-Zeitstempel und jedes „Zitat“ im Markdown muss im Transkript stehen
  --json  maschinenlesbare Ausgabe (status/list/check)   --help
<session> = Pfad, Name unter recordings/ oder eindeutiger Namensteil.
Exit: 0 ok · 1 Abweichungen/Lauf fehlgeschlagen · 2 Aufruf falsch · 3 nicht gefunden`;

const chunkTotal = (dir, t) => { const r = spawnSync('node', [join(HERE, t === 'meeting' ? 'meeting.mjs' : 'run.mjs'), dir, '--dry'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim().split('\n').length : null; };
const count = (d, re) => existsSync(d) ? readdirSync(d).filter(f => re.test(f)).length : 0;
const legacy = dir => join(HERE, `${basename(dir)}_auswertung.md`);
// meeting: failed chunks (fehler:true) / missing overview in meeting.json; old files without these fields count as fine
function problems(dir) {
  const mo = outDir(dir, 'meeting'), jf = f => { try { return JSON.parse(readFileSync(join(mo, f), 'utf8')); } catch { return null; } };
  const teile = existsSync(mo) ? readdirSync(mo).filter(f => /^chunk-\d+\.json$/.test(f)).sort().filter(f => { const c = jf(f); return !c || c.fehler === true; }).map(f => +f.match(/\d+/)[0]) : [], mj = jf('meeting.json');
  return { teile, uebersicht_fehlt: !!mj && !mj.uebersicht };
}
const probText = p => [p.teile.length && `Teile ${p.teile.join(', ')} fehlgeschlagen`, p.uebersicht_fehlt && 'Übersicht fehlgeschlagen'].filter(Boolean).join('; ');
function info(dir, total = false) {
  const m = meta(dir), t = typ(m), mo = outDir(dir, 'meeting'), po = outDir(dir, 'pnp');
  const o = { session: basename(dir), channel: m.channel, typ: t, meeting: { chunks: count(mo, /^chunk-\d+\.json$/), md: existsSync(join(mo, 'auswertung.md')) },
    pnp: { chunks: count(po, /^chunk-\d+\.json$/), recap: existsSync(join(po, 'recap.md')), blog: existsSync(join(po, 'blog.md')) }, legacy_md: existsSync(legacy(dir)) };
  if (t === 'meeting') o.fehler = problems(dir);
  if (total) o.total = chunkTotal(dir, t);
  return o;
}

if (!cmd || cmd === '--help' || cmd === '-h' || argv.includes('--help')) { console.log(HELP); process.exit(cmd ? 0 : 2); }

try {
  if (cmd === 'list') {
    const rows = readdirSync(REC).filter(d => existsSync(join(REC, d, 'session.json'))).sort().map(d => info(join(REC, d)));
    out(rows, rows.map(r => `${r.session.padEnd(42)} ${r.typ.padEnd(8)} ` + [r.meeting.chunks && `meeting:${r.meeting.chunks}${r.meeting.md ? '+md' : ''}`, r.pnp.chunks && `pnp:${r.pnp.chunks}${r.pnp.recap ? '+recap' : ''}${r.pnp.blog ? '+blog' : ''}`, r.legacy_md && 'legacy-md'].filter(Boolean).join(' ')).join('\n'));
  } else if (cmd === 'status') {
    const dir = pos[0] ? resolveSession(pos[0]) : readdirSync(REC).map(d => join(REC, d)).filter(d => existsSync(join(d, 'auswertung')) || existsSync(join(d, 'auswertung-meeting'))).sort().at(-1);
    if (!dir) die(3, 'keine Auswertung gefunden');
    const i = info(dir, true), done = i.typ === 'meeting' ? i.meeting.chunks : i.pnp.chunks, fin = i.typ === 'meeting' ? i.meeting.md : i.pnp.recap;
    const running = spawnSync('pgrep', ['-f', `(run|meeting).mjs .*${i.session}`]).status === 0;
    if (!JSON_OUT && i.typ === 'pnp' && existsSync(join(dir, 'auswertung'))) process.exit(spawnSync('node', [join(HERE, 'fortschritt.mjs'), dir], { stdio: 'inherit' }).status ?? 0);
    const pb = i.fehler ? probText(i.fehler) : '', unvoll = i.total != null && done < i.total, ok = !!fin && !pb && !unvoll;
    out({ ...i, done, final: fin, running, ok, problem: pb || (fin && unvoll ? `nur ${done}/${i.total} Teile` : null) },
      `${i.session} [${i.typ}] ${running ? 'läuft' : 'steht'}: Teile ${done}/${i.total ?? '?'}${ok ? ' · Protokoll ✓' : fin ? ' · Protokoll vorhanden, aber UNVOLLSTÄNDIG' : ''}${pb ? ` · FEHLER: ${pb}` : fin && unvoll ? ` · nur ${done}/${i.total} Teile` : ''}`);
  } else if (cmd === 'check') {
    if (!pos[0]) die(2, 'check <session>');
    const dir = resolveSession(pos[0]), m = meta(dir);
    const md = opt('--md') ?? [join(outDir(dir, 'meeting'), 'auswertung.md'), legacy(dir), join(outDir(dir, 'pnp'), 'recap.md')].find(existsSync);
    if (!md || !existsSync(md)) die(3, 'keine Auswertung-Markdown gefunden (--md angeben)');
    const ls = lines(dir, m.glossar), have = new Set(ls.map(l => l.t)), text = readFileSync(md, 'utf8');
    const ts = [...text.matchAll(/\[(\d{1,3}:[0-5]\d)\]/g)].map(x => x[1]), bad_ts = [...new Set(ts.filter(x => !have.has(x)))];
    const quotes = [...text.matchAll(/[„"«]([^„"“”»«\n]{12,200})[“"”»]/g)].map(x => x[1]).filter(q => !q.includes('*') && q.trim().split(/\s+/).length >= 3);
    const whole = norm(ls.map(l => l.text).join(' ')), bad_q = quotes.filter(q => !whole.includes(norm(q)));
    const pb = md.startsWith(outDir(dir, 'meeting')) ? probText(problems(dir)) : '', warned = /^> \*\*WARNUNG: Auswertung unvollständig/m.test(text), fail = pb || (warned ? 'Markdown trägt Unvollständigkeits-Warnung' : '');
    const res = { md, session: basename(dir), timestamps: ts.length, timestamps_ungrounded: bad_ts, quotes: quotes.length, quotes_ungrounded: bad_q, ok: bad_ts.length === 0 && bad_q.length === 0 && ts.length > 0 && !fail, unvollstaendig: fail || null, warn: ts.length ? null : 'Markdown enthält keine [mm:ss]-Zeitstempel – nichts belegbar' };
    out(res, `${md}\nZeitstempel: ${ts.length} (${bad_ts.length} nicht im Transkript${bad_ts.length ? ': ' + bad_ts.join(', ') : ''})\nZitate: ${quotes.length} (${bad_q.length} nicht im Transkript)${bad_q.map(q => `\n  ✗ „${q}“`).join('')}${res.warn ? '\nWARNUNG: ' + res.warn : ''}${fail ? '\nFEHLER: Auswertung unvollständig – ' + fail : ''}\n${res.ok ? 'OK' : 'ABWEICHUNGEN'}`);
    process.exit(res.ok ? 0 : 1);
  } else if (cmd === 'eval') {
    if (!pos[0]) die(2, 'eval <session>');
    const dir = resolveSession(pos[0]), g = (existsSync(join(HERE, 'golden.json')) ? JSON.parse(readFileSync(join(HERE, 'golden.json'), 'utf8')) : {})[basename(dir)];
    if (!g) die(3, `kein Golden-Set für ${basename(dir)} in golden.json`);
    const f = join(outDir(dir, 'meeting'), 'meeting.json'); if (!existsSync(f)) die(3, 'meeting.json fehlt – erst auswertung run');
    const D = JSON.parse(readFileSync(f, 'utf8')), sec = t => { const [m, x] = t.split(':').map(Number); return m * 60 + x; }, near = (e, t, tol = g.tol) => !t || Math.abs(sec(e.t) - sec(t)) <= tol;
    const has = (e, kw) => { const z = norm([e.was, e.wert, e.zitat, e.frage].join(' ')); return kw.some(k => z.includes(norm(k))); };
    const nm = (a, b) => norm(a ?? '').startsWith(norm(b).slice(0, 5));
    const rows = g.checks.map(c => {
      let r = 'miss', d = '';
      if (c.art === 'aufgabe') { const e = D.aufgaben.find(e => nm(e.owner, c.owner) && (near(e, c.t) || has(e, c.kw))); const kwe = D.aufgaben.find(e => (near(e, c.t) || has(e, c.kw)) && has(e, c.kw));
        r = e ? (c.frist && !norm(e.frist ?? '').includes(norm(c.frist)) ? 'partial' : 'hit') : kwe ? 'partial' : 'miss'; d = e ? `[${e.t}] ${e.owner} · ${e.frist ?? 'ohne Frist'}` : kwe ? `Aufgabe [${kwe.t}] aber Owner ${kwe.owner ?? 'offen'}` : ''; }
      else if (c.art === 'vorschlag') { const v = D.vorschlaege.find(e => has(e, c.kw)), b = D.beschluesse.find(e => has(e, c.kw)); r = b ? 'fail' : v ? (c.von && !nm(v.von, c.von) ? 'partial' : 'hit') : 'miss'; d = b ? `als Beschluss [${b.t}]` : v ? `[${v.t}] ${v.von}` : ''; }
      else if (c.art === 'zahl') { const e = D.zahlen.find(e => near(e, c.t) && has(e, c.kw)); r = e ? 'hit' : 'miss'; d = e ? `[${e.t}] ${e.wert} ${e.was}` : ''; }
      else if (c.art === 'risiko') { const e = D.risiken.find(e => near(e, c.t) || has(e, c.kw)); r = e ? 'hit' : 'miss'; d = e ? `[${e.t}] ${e.was}` : ''; }
      else if (c.art === 'geht') { const e = D.anwesenheit.find(e => e.art === 'geht' && nm(e.wer, c.wer) && near(e, c.t, 90)), s = D.sprecher.find(s => nm(s.w, c.wer) && near({ t: s.bis }, c.t, 90));
        r = e ? 'hit' : s ? 'partial' : 'miss'; d = e ? `ausdrücklich [${e.t}]` : s ? `nur abgeleitet: letzte Äußerung [${s.bis}]` : ''; }
      return { id: c.id, result: r, detail: d };
    });
    const score = rows.reduce((n, r) => n + (r.result === 'hit' ? 1 : r.result === 'partial' ? 0.5 : 0), 0), res = { session: basename(dir), recall: +(score / rows.length).toFixed(2), hits: rows.filter(r => r.result === 'hit').length, total: rows.length, rows };
    out(res, rows.map(r => `${r.result.padEnd(7)} ${r.id.padEnd(28)} ${r.detail}`).join('\n') + `\nRecall ${res.recall} (${res.hits}/${res.total} voll, partial = 0.5)`);
    process.exit(res.hits === res.total ? 0 : 1);
  } else if (cmd === 'run') {
    if (!pos[0]) die(2, 'run <session> [--typ pnp|meeting]');
    const dir = resolveSession(pos[0]), t = opt('--typ') ?? typ(meta(dir));
    if (!['pnp', 'meeting'].includes(t)) die(2, '--typ pnp|meeting');
    const pass = rest.filter((a, i) => a !== pos[0] && a !== '--typ' && rest[i - 1] !== '--typ');
    console.error(`auswertung: ${basename(dir)} → ${t}`);
    process.exit(spawnSync('node', [join(HERE, t === 'meeting' ? 'meeting.mjs' : 'run.mjs'), dir, ...pass], { stdio: 'inherit' }).status ?? 1);
  } else die(2, `unbekannter Befehl: ${cmd}\n\n${HELP}`);
} catch (e) { die(e.code === 3 ? 3 : 1, e.message); }
