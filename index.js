// Local multitrack Discord recorder: one FLAC per speaker, all tracks time-aligned to session start.
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, GatewayIntentBits, Events, SlashCommandBuilder, MessageFlags, ChannelType } from 'discord.js';
import { joinVoiceChannel, EndBehaviorType, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import prism from 'prism-media';
import { Track, slug, stamp, RATE, CH, HOER } from './track.js';
import { load, names, fixText } from './glossar.js';

const OUT = process.env.RECORD_DIR ?? join(import.meta.dirname, 'recordings');

const sessions = new Map();                        // guildId -> session
const LIVE_DEFAULT = process.env.LIVE_STT === '1', LIVE_POST = process.env.LIVE_POST !== '0';
// access: owners from .env (ALLOWED_USERS, empty = everyone may control), extra users added via /zugriff → allowed.json
const OWNERS = new Set((process.env.ALLOWED_USERS ?? '').split(',').map(x => x.trim()).filter(Boolean));
const ACL = join(import.meta.dirname, 'allowed.json');
const extra = new Set(existsSync(ACL) ? JSON.parse(readFileSync(ACL, 'utf8')) : []);
const saveAcl = () => writeFileSync(ACL, JSON.stringify([...extra], null, 2));
const allowed = id => !OWNERS.size || OWNERS.has(id) || extra.has(id);

const mmss = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// live transcript line → live.md (+ Discord unless LIVE_POST=0): own thread if allowed, else one growing message in the channel
async function liveTarget(s) {
  if (!s.feed) s.feed = s.startMsg?.startThread({ name: `📝 Transkript ${stamp().slice(0, 16)}`, autoArchiveDuration: 1440 })
    .catch(e => (console.warn('[live] kein Thread:', e.message), s.chat));
  return s.feed;
}

const line = r => `\`${mmss(r.start)}\` **${r.who}:** ${r.text}`.slice(0, 1800);

// final → live.md + fixed line; volatile → italic preview per speaker; Discord edits throttled to EDIT_MS
const EDIT_MS = 1500;
function emit(s, r) {
  r.text = fixText(r.text, s.gl);
  s.lines ??= []; s.partial ??= new Map();
  if (r.final) {
    appendFileSync(join(s.dir, 'live.md'), `**[${mmss(r.start)}] ${r.who}:** ${r.text}\n\n`);
    s.partial.delete(r.who);
    if (s.lines.join('\n').length + r.text.length > 1700) { s.lines = []; s.msg = null; }   // message full → next one
    s.lines.push(line(r));
  } else s.partial.set(r.who, r);
  if (LIVE_POST && !s.flushT) s.flushT = setTimeout(() => flush(s), EDIT_MS);
}

function flush(s) {
  s.flushT = null;
  const body = [...s.lines, ...[...s.partial.values()].map(p => `_${line(p)} …_`)].join('\n').slice(0, 2000);
  if (!body || body === s.shown) return;
  s.shown = body;
  s.post = (s.post ?? Promise.resolve()).then(async () => {
    const ch = await liveTarget(s);
    s.msg = s.msg ? await s.msg.edit(body) : await ch.send({ content: body, allowedMentions: { parse: [] } });
  }).catch(e => console.warn('[live] post:', e.message));
}

function setLive(s, on) {
  s.live = on;
  s.tracks.forEach(t => on ? t.startStt(r => emit(s, r)) : t.stopStt());
}

function subscribe(session, userId) {
  if (session.streams.has(userId)) return;
  const member = session.guild.members.cache.get(userId);
  if (!member || member.user.bot) return;
  const track = session.tracks.get(userId) ?? session.tracks.set(userId, new Track(session, member)).get(userId);
  if (session.live) track.startStt(r => emit(session, r));
  const opus = session.conn.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 } });
  const dec = new prism.opus.Decoder({ rate: RATE, channels: CH, frameSize: 960 });
  session.streams.set(userId, opus);
  opus.pipe(dec).on('data', buf => track.pcm(buf));
  const drop = () => session.streams.delete(userId);
  opus.once('end', drop); opus.once('error', drop); dec.once('error', drop);  // corrupt packet: resubscribe on next speech
}

async function start(i, audio = true) {
  const vc = i.options.getChannel('kanal') ?? i.member.voice.channel;   // explicit channel wins, else caller's
  if (!vc) return i.reply({ content: 'Geh in einen Sprachkanal oder wähle `kanal:`.', flags: MessageFlags.Ephemeral });
  if (sessions.has(i.guildId)) return i.reply({ content: 'Läuft schon.', flags: MessageFlags.Ephemeral });
  if (!audio && !existsSync(HOER)) return i.reply({ content: '`stt/hoer` fehlt (swiftc -O stt/hoer.swift -o stt/hoer).', flags: MessageFlags.Ephemeral });
  await i.deferReply();
  const conn = joinVoiceChannel({ channelId: vc.id, guildId: i.guildId, adapterCreator: i.guild.voiceAdapterCreator, selfDeaf: false, selfMute: true });
  try { await entersState(conn, VoiceConnectionStatus.Ready, 20_000); }
  catch { conn.destroy(); return i.editReply('Konnte dem Sprachkanal nicht beitreten.'); }
  const dir = join(OUT, `${stamp()}_${slug(vc.name)}`);
  mkdirSync(dir, { recursive: true });
  const live = !audio || (i.options.getBoolean('live') ?? LIVE_DEFAULT) && existsSync(HOER);   // transcript-only: always live
  const glossar = i.options.getString('kampagne') ?? process.env.GLOSSAR ?? null;
  const s = { glossar, gl: load(glossar), guild: i.guild, channel: vc, chat: i.channel, conn, dir, t0: Date.now(), tracks: new Map(), streams: new Map(), by: i.user.tag, live, audio };
  sessions.set(i.guildId, s);
  conn.receiver.speaking.on('start', uid => subscribe(s, uid));
  s.pump = setInterval(() => s.live && s.tracks.forEach(t => t.padTo(Date.now() - s.t0, 400)), 250);
  conn.on(VoiceConnectionStatus.Disconnected, () => stop(i.guildId).catch(console.error));
  await i.editReply(!audio ? `📝 **Transkript läuft** in **${vc.name}** (keine Audio-Aufnahme): jede Stimme wird separat mitgeschrieben. Wer nicht mitgeschrieben werden will, bitte jetzt Bescheid sagen. Stop mit \`/transcript stop\`.`
    : `🔴 **Aufnahme läuft** in **${vc.name}**: jede Stimme wird separat aufgenommen. Wer nicht aufgenommen werden will, bitte jetzt Bescheid sagen. Stop mit \`/record stop\`.${live ? ' 📝 Live-Transkript an.' : ''}`);
  s.startMsg = await i.fetchReply().catch(() => null);
  console.log(`[rec] start ${dir}`);
}

async function stop(guildId) {
  const s = sessions.get(guildId);
  if (!s) return null;
  sessions.delete(guildId);
  clearInterval(s.pump); clearTimeout(s.flushT);
  const endMs = Date.now() - s.t0;
  s.streams.forEach(st => st.destroy());
  try { s.conn.destroy(); } catch {}
  await Promise.all([...s.tracks.values()].map(t => t.close(endMs)));
  const meta = { audio: s.audio, live: s.live, glossar: s.glossar, started: new Date(s.t0).toISOString(), durationSec: Math.round(endMs / 1000), channel: s.channel.name, startedBy: s.by,
    tracks: [...s.tracks.entries()].map(([id, t]) => ({ userId: id, name: t.name, file: t.file })) };
  writeFileSync(join(s.dir, 'session.json'), JSON.stringify(meta, null, 2));
  console.log(`[rec] stop ${s.dir} (${meta.tracks.length} tracks, ${meta.durationSec}s)`);
  return meta;
}

const cmd = new SlashCommandBuilder().setName('record').setDescription('Mehrspur-Aufnahme')
  .addSubcommand(c => c.setName('start').setDescription('Aufnahme im aktuellen Sprachkanal starten')
    .addBooleanOption(o => o.setName('live').setDescription('Live-Transkript (Apple, lokal) in den Chat'))
    .addStringOption(o => o.setName('kampagne').setDescription('Namensliste (glossar/*.tsv)').addChoices(...names().slice(0, 25).map(n => ({ name: n, value: n }))))
    .addChannelOption(o => o.setName('kanal').setDescription('Sprachkanal (Standard: deiner)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)))
  .addSubcommand(c => c.setName('live').setDescription('Live-Transkript während der Aufnahme an/aus')
    .addBooleanOption(o => o.setName('an').setDescription('an oder aus').setRequired(true)))
  .addSubcommand(c => c.setName('stop').setDescription('Aufnahme beenden und speichern'));

const tcmd = new SlashCommandBuilder().setName('transcript').setDescription('Nur Live-Transkript, keine Audio-Aufnahme')
  .addSubcommand(c => c.setName('start').setDescription('Transkript im aktuellen Sprachkanal starten')
    .addStringOption(o => o.setName('kampagne').setDescription('Namensliste (glossar/*.tsv)').addChoices(...names().slice(0, 25).map(n => ({ name: n, value: n }))))
    .addChannelOption(o => o.setName('kanal').setDescription('Sprachkanal (Standard: deiner)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)))
  .addSubcommand(c => c.setName('stop').setDescription('Transkript beenden und speichern'));

const acmd = new SlashCommandBuilder().setName('zugriff').setDescription('Wer den Recorder steuern darf (nur Owner)')
  .addSubcommand(c => c.setName('add').setDescription('Nutzer freischalten').addUserOption(o => o.setName('user').setDescription('Nutzer').setRequired(true)))
  .addSubcommand(c => c.setName('remove').setDescription('Freigabe entziehen').addUserOption(o => o.setName('user').setDescription('Nutzer').setRequired(true)))
  .addSubcommand(c => c.setName('liste').setDescription('Freigeschaltete Nutzer anzeigen'));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

// global command: shows up on every server the bot is on; guild copies cleared so /record isn't listed twice
client.once(Events.ClientReady, async c => {
  await c.application.commands.set([cmd, tcmd, acmd]);
  for (const g of c.guilds.cache.values()) await g.commands.set([]);
  console.log(`[rec] ready as ${c.user.tag} in ${c.guilds.cache.size} server(s); output: ${OUT}`);
});

client.on(Events.GuildCreate, g => console.log(`[rec] joined ${g.name}`));

client.on(Events.InteractionCreate, async i => {
  if (!i.isChatInputCommand() || !['record', 'transcript', 'zugriff'].includes(i.commandName)) return;
  const eph = content => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {});
  if (i.commandName === 'zugriff') {
    if (!OWNERS.has(i.user.id)) return eph('Nur der Owner verwaltet den Zugriff.');
    const sub = i.options.getSubcommand(), u = i.options.getUser('user');
    if (sub === 'liste') return eph([...OWNERS].map(id => `<@${id}> (Owner)`).concat([...extra].map(id => `<@${id}>`)).join('\n'));
    if (sub === 'add') extra.add(u.id); else extra.delete(u.id);
    saveAcl();
    return eph(sub === 'add' ? `✅ <@${u.id}> darf den Recorder steuern.` : `🚫 <@${u.id}> ist nicht mehr freigeschaltet.`);
  }
  if (!allowed(i.user.id)) return eph('Nur für freigeschaltete Nutzer.');
  try {
    const sub = i.options.getSubcommand();
    if (sub === 'start') return await start(i, i.commandName === 'record');
    if (sub === 'live') {
      const s = sessions.get(i.guildId), on = i.options.getBoolean('an');
      if (!s) return await i.reply({ content: 'Keine laufende Aufnahme.', flags: MessageFlags.Ephemeral });
      if (!s.audio) return await i.reply({ content: 'Transkript-Modus: beenden mit `/transcript stop`.', flags: MessageFlags.Ephemeral });
      if (on && !existsSync(HOER)) return await i.reply({ content: '`stt/hoer` fehlt (swiftc -O stt/hoer.swift -o stt/hoer).', flags: MessageFlags.Ephemeral });
      setLive(s, on);
      return await i.reply(on ? '📝 Live-Transkript **an**.' : 'Live-Transkript **aus**.');
    }
    await i.deferReply();
    const m = await stop(i.guildId);
    const dur = m && (m.durationSec < 60 ? m.durationSec + ' s' : Math.round(m.durationSec / 60) + ' min');
    await i.editReply(!m ? 'Keine laufende Aufnahme.' : m.audio ? `⏹️ Gespeichert: ${m.tracks.length} Spuren, ${dur}.` : `⏹️ Transkript gespeichert: ${m.tracks.length} Sprecher, ${dur}.`);
  } catch (e) { console.error(e); (i.deferred ? i.editReply : i.reply).call(i, 'Fehler: ' + e.message).catch(() => {}); }
});

// Ctrl+C / launchd stop (SIGTERM): finalize all running recordings instead of losing them
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await Promise.all([...sessions.keys()].map(stop)); process.exit(0); });

client.login(process.env.DISCORD_TOKEN);
