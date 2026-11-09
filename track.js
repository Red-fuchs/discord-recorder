// PCM track writer: streams to ffmpeg FLAC, keeps time alignment by padding silence.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export const HOER = join(import.meta.dirname, 'stt', 'hoer');

export const RATE = 48000, CH = 2, BPS = RATE * CH * 2;   // Discord PCM: 48 kHz stereo s16le
export const MAX_DRIFT_MS = 60;                           // pad with silence when a track lags wall clock by more

export const slug = s => s.normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'user';
export const stamp = () => new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-');   // local time, sortable

function silence(ms) { return Buffer.alloc(Math.floor(ms * BPS / 1000 / 4) * 4); }

export class Track {
  constructor(session, member) {
    this.file = session.audio ? `${slug(member.displayName)}_${member.id}.flac` : null;
    this.name = member.displayName;
    this.written = 0;                              // bytes of PCM written so far
    this.ff = this.file && spawn('ffmpeg', ['-loglevel', 'error', '-f', 's16le', '-ar', RATE, '-ac', CH, '-i', 'pipe:0',
      '-ac', '1', '-c:a', 'flac', join(session.dir, this.file)], { stdio: ['pipe', 'inherit', 'inherit'] });
    this.done = this.ff ? new Promise(r => this.ff.on('close', r)) : Promise.resolve();   // transcript-only: no FLAC
    this.t0 = session.t0;
  }
  // keep track aligned to session clock: fill gaps (silence while not speaking) with zeros
  padTo(ms, max = MAX_DRIFT_MS) {
    const lag = ms - this.written / BPS * 1000;
    if (lag > max) this.write(silence(lag));
  }
  write(buf) { this.written += buf.length; this.ff?.stdin.write(buf); this.stt?.stdin.write(buf); }
  // live Apple STT: same PCM stream (incl. silence padding) → times relative to session start
  startStt(onText) {
    if (this.stt) return;
    const off = this.written / BPS;
    this.stt = spawn(HOER, [process.env.STT_LOCALE ?? 'de-DE'], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.stt.stdin.on('error', () => {});
    this.sttDone = new Promise(r => this.stt.on('close', r));
    createInterface({ input: this.stt.stdout }).on('line', l => {
      try { const r = JSON.parse(l); onText({ who: this.name, start: r.start + off, end: r.end + off, text: r.text, final: r.final !== false }); } catch {}
    });
  }
  async stopStt() { const p = this.stt; if (!p) return; this.stt = null; p.stdin.end(); await this.sttDone; }
  pcm(buf) { this.padTo(Date.now() - this.t0); this.write(buf); }
  async close(endMs) { this.padTo(endMs); this.ff?.stdin.end(); await Promise.all([this.done, this.stopStt()]); }
}

