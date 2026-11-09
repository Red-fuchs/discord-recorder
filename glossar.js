// Campaign glossary (same TSV format as claude-artifact-cli/glossar): TERM<TAB>variant | variant, # comments.
// context() → ASR hint string; fixText() for live text; fixWords() merges multi-word mishearings in word timelines.
// CLI: node glossar.js context <name>   (name = glossar/<name>.tsv or a path)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, 'glossar');
const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const names = () => existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith('.tsv')).map(f => f.slice(0, -4)) : [];

export function load(name) {
  if (!name) return null;
  const p = existsSync(name) ? name : join(DIR, `${name}.tsv`);
  if (!existsSync(p)) return null;
  const terms = readFileSync(p, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
    const [term, v = ''] = l.split('\t');
    return { term: term.trim(), variants: v.split('|').map(x => x.trim()).filter(Boolean) };
  });
  // longest variant first so "bob raider" beats "bob"
  const vars = terms.flatMap(t => t.variants.map(v => ({ term: t.term, toks: v.split(/\s+/).map(norm).filter(Boolean) })))
    .filter(v => v.toks.length).sort((a, b) => b.toks.length - a.toks.length);
  const res = vars.map(v => ({ term: v.term, re: new RegExp(`(?<![\\p{L}\\p{N}])${v.toks.map(esc).join('[^\\p{L}\\p{N}]+')}(?![\\p{L}\\p{N}])`, 'giu') }));
  return { terms, vars, res };
}

export const context = gl => gl ? gl.terms.map(t => t.term).join(' ') : '';

export const fixText = (text, gl) => gl ? gl.res.reduce((s, r) => s.replace(r.re, r.term), text) : text;

// words: [{w,start,end,...}] of ONE speaker or sorted mix; merges per speaker only
export function fixWords(words, gl) {
  if (!gl) return words;
  const out = [];
  for (let i = 0; i < words.length;) {
    const v = gl.vars.find(v => v.toks.every((t, k) => words[i + k] && words[i + k].who === words[i].who && norm(words[i + k].w) === t));
    if (!v) { out.push(words[i++]); continue; }
    const last = words[i + v.toks.length - 1], tail = last.w.match(/[^\p{L}\p{N}]*$/u)[0];
    out.push({ ...words[i], w: v.term + tail, end: last.end });
    i += v.toks.length;
  }
  return out;
}

if (process.argv[1] === import.meta.filename && process.argv[2] === 'context') console.log(context(load(process.argv[3])));
