# discord-recorder

Local multitrack recorder for Discord voice channels, like Craig but running on your own Mac. Every speaker ends up as a
separate, time-aligned FLAC track, ready for ASR, merge and actual-play / meeting write-ups.

> Status: personal project, used for my own tabletop RPG sessions and coworking calls. Provided as is.
> A German README is in `README.de.md`.

## Features

- `/record start` / `/record stop` slash commands; the bot announces the recording publicly in the channel.
- One mono 48 kHz FLAC per person, all tracks equally long and in sync (gaps are filled with silence; drift between
  tracks is about 0.1 s or less, see `test-track.js`).
- Discord's end-to-end voice encryption (DAVE) is supported via `@discordjs/voice` 0.19.
- Optional live transcript with Apple SpeechAnalyzer (`stt/hoer.swift`, macOS 26+): posted into a thread and written to `live.md`.
- `/transcript start|stop`: transcript only, no audio is stored.
- Access control: `ALLOWED_USERS` in `.env` plus `/zugriff add|remove|liste`.
- Per-campaign glossary files (`glossar/<name>.tsv`) fix mis-heard names in live text and in the final transcript.
- Accurate transcript: `./transcribe.sh` runs Qwen3-ASR (local MLX, word timestamps) per speaker, `merge.js` interleaves the speakers.
- `auswertung/`: local-LLM evaluation of a session, either an RPG recap/blog (by scene) or meeting minutes
  (decisions vs. proposals, tasks with owner, numbers, risks), each item tied to a transcript timestamp.

## Architecture

```
Discord voice -> index.js (bot, per-user Opus streams) -> track.js (PCM -> FLAC via ffmpeg, keeps tracks in sync)
                                                      -> stt/hoer (optional live STT) -> live.md / thread
recordings/<date>_<channel>/  *.flac + session.json
transcribe.sh -> mlx-qwen3-asr per track -> merge.js -> transcript + words.json
auswertung/*  -> local OpenAI-compatible LLM server -> recap / minutes
```

## Quick start

1. Create a bot at https://discord.com/developers/applications, reset its token, invite it with
   `scope=bot+applications.commands` and the permissions to view channels, send messages, join voice channels and create threads.
2. `cp .env.example .env` and set `DISCORD_TOKEN`. The `.env` is gitignored. Never share the token.
3. `npm install && npm start`, then join a voice channel and run `/record start` in Discord.

Output lands in `recordings/<date>_<channel>/` (`<name>_<userid>.flac` per speaker plus `session.json`).
Use `RECORD_DIR` in `.env` to store elsewhere.

Optional: `swiftc -O stt/hoer.swift -o stt/hoer` for live transcripts; `./transcribe.sh recordings/<session>` for ASR
(needs `mlx-qwen3-asr`, ffmpeg; set `MLX_QWEN3_ASR` to its path; the script uses a `gpu-run` wrapper for GPU queueing, replace
it with a plain call if you do not have one).

## Consent

Everyone in the channel sees the announcement. Only record people who agree, and check the law where you live.

## Credits

Built on discord.js, @discordjs/voice, prism-media, opusscript, @noble/ciphers, ffmpeg, Qwen3-ASR (Apache-2.0 model, check its license for your use),
and Apple's Speech framework. `glossar/*.tsv` are small examples from a Warhammer 40k and a homebrew RPG campaign (all names fictional).

## License

MIT, see `LICENSE`.
