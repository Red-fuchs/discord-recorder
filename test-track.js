// Offline check: speech bursts with gaps + late joiner must yield equally long, aligned FLACs.
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Track, BPS } from './track.js';
const dir = '/tmp/rec-test'; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);
const t0 = Date.now(), sess = { dir, t0 };
const tone = ms => { const n = Math.floor(ms * BPS / 1000 / 4), b = Buffer.alloc(n * 4); for (let i = 0; i < n; i++) { const v = Math.round(8000 * Math.sin(i / 10)); b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2); } return b; };
const a = new Track(sess, { displayName: 'Aet', id: '1' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let b;
for (let k = 0; k < 150; k++) {                    // 3 s total, 20 ms frames
  const t = k * 20;
  if (t < 1000 || t > 2000) a.pcm(tone(20));        // A speaks 0-1 s and 2-3 s
  if (t === 1500) b = new Track(sess, { displayName: 'Lyco', id: '2' });
  if (b && t >= 1500 && t < 2500) b.pcm(tone(20));  // B joins late, speaks 1.5-2.5 s
  await sleep(20);
}
const end = Date.now() - t0;
await Promise.all([a.close(end), b.close(end)]);
for (const f of [a.file, b.file]) console.log(f, execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${dir}/${f}`]).toString().trim(), 's; end', end / 1000);
