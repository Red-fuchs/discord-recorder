// Render chunk-NN.json + stand-NN.txt of a session into auswertung/zwischenstand.md (readable progress view).
// Usage: node auswertung/zeige.mjs recordings/<session>
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const D = join(process.argv[2], 'auswertung');
const row = e => typeof e === 'string' ? e : `${e.t ? '`' + e.t + '` ' : ''}${Object.entries(e).filter(([k]) => k !== 't').map(([k, v]) => Array.isArray(v) ? v.join(', ') : v).join(' – ')}`;
const md = readdirSync(D).filter(f => /^chunk-\d+\.json$/.test(f)).sort().map(f => {
  const n = f.slice(6, 8), c = JSON.parse(readFileSync(join(D, f), 'utf8')), st = join(D, `stand-${n}.txt`);
  const lists = Object.entries(c).filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => `**${k}**\n${v.map(e => '- ' + row(e)).join('\n')}`).join('\n\n');
  return `## Teil ${n} [${c.von}–${c.bis}] ${c.ort ?? ''}\n\n${lists}\n\n<details><summary>Stand danach</summary>\n\n\`\`\`\n${existsSync(st) ? readFileSync(st, 'utf8') : '–'}\n\`\`\`\n</details>`;
}).join('\n\n---\n\n');
writeFileSync(join(D, 'zwischenstand.md'), `# Auswertung – Zwischenstand\n\n${md}\n`);
console.log(join(D, 'zwischenstand.md'));
