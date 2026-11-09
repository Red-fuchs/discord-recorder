#!/usr/bin/env node
// Progress of run.mjs for a session: % + bar per phase (Protokoll, Blog) + ETA. -w = refresh every 5 s.
// Usage: node auswertung/fortschritt.mjs [recordings/<session>] [-w]   (default: newest session with auswertung/)
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REC = join(import.meta.dirname, '..', 'recordings'), watch = process.argv.includes('-w');
const dir = process.argv.slice(2).find(a => !a.startsWith('-')) ??
  readdirSync(REC).map(d => join(REC, d)).filter(d => existsSync(join(d, 'auswertung'))).sort().at(-1);
if (!dir) { console.error('keine Auswertung gefunden'); process.exit(1); }
const OUT = join(dir, 'auswertung');
const total = +execFileSync('node', [join(import.meta.dirname, 'run.mjs'), dir, '--dry'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n').length;

const bar = (n, of, w = 30) => { const p = of ? n / of : 0, f = Math.round(p * w); return `[${'█'.repeat(f)}${'░'.repeat(w - f)}] ${String(Math.round(p * 100)).padStart(3)}%  ${n}/${of}`; };
const mm = s => s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round(s % 3600 / 60)} min` : `${Math.round(s / 60)} min`;

function show() {
  const files = readdirSync(OUT), times = re => files.filter(f => re.test(f)).map(f => statSync(join(OUT, f)).mtimeMs).sort();
  const ch = times(/^stand-\d+\.txt$/), bl = times(/^blog-\d+\.md$/);
  const done = ch.length + bl.length, all = total * 2;
  // avg seconds per step from the latest phase that has ≥2 timestamps
  const ts = (bl.length >= 2 ? bl : ch), avg = ts.length >= 2 ? (ts.at(-1) - ts[0]) / (ts.length - 1) / 1000 : null;
  const running = (() => { try { return execFileSync('pgrep', ['-f', `run.mjs .*${dir.split('/').at(-1)}`]).toString().trim() !== ''; } catch { return false; } })();
  const lines = [
    `Auswertung ${dir.split('/').at(-1)}  ${running ? '▶ läuft' : '■ steht'}`,
    `Protokoll ${bar(ch.length, total)}`,
    `Blog      ${bar(bl.length, total)}`,
    `Gesamt    ${bar(done, all)}`,
    `${avg ? `Ø ${Math.round(avg)} s/Teil · Rest ~${mm(avg * (all - done))}` : 'Rest: noch keine Messung'}` +
      `${existsSync(join(OUT, 'recap.md')) ? ' · recap.md ✓' : ''}${existsSync(join(OUT, 'blog.md')) ? ' · blog.md ✓' : ''}`,
  ];
  if (watch) process.stdout.write('\x1b[H\x1b[2J');
  console.log(lines.join('\n'));
}
show();
if (watch) setInterval(show, 5000);
