# discord-recorder

Lokaler Mehrspur-Recorder für Discord-Sprachkanäle (wie Craig, aber auf deinem Mac).
Jede Person landet als eigene, zeitgleiche FLAC-Spur – fertig für ASR → Merge → Hörspiel/Actual-Play.

## Einmalig einrichten

1. **Bot anlegen:** https://discord.com/developers/applications → *New Application* → Name z. B. `PnP Recorder`.
2. Links **Bot** → *Reset Token* → Token kopieren.
3. Hier im Ordner: `cp .env.example .env` und Token hinter `DISCORD_TOKEN=` einfügen.
   Die `.env` bleibt lokal (steht in `.gitignore`) – Token niemals teilen.
4. **Bot einladen** (Server-Admin): Links **OAuth2** → *Client ID* kopieren, dann diese URL öffnen (ID einsetzen):
   ```
   https://discord.com/oauth2/authorize?client_id=DEINE_CLIENT_ID&scope=bot+applications.commands&permissions=309238696960
   ```
   Rechte: Kanal sehen, Nachrichten senden, Sprachkanal beitreten, Threads erstellen + darin schreiben (Live-Transkript).

## Benutzen

```bash
cd ~/Projects/discord-recorder
npm start
```

In Discord (selbst im Sprachkanal sein):
- `/record start` – Bot kommt in den Kanal, kündigt die Aufnahme öffentlich an
- `/record stop` – speichert alles

Ergebnis: `recordings/<datum>_<kanal>/`
- `Name_UserID.flac` – eine Spur pro Person (mono, 48 kHz), alle gleich lang und synchron ab Start
- `session.json` – Start, Dauer, Kanal, Spurliste

### Live-Transkript (Apple, lokal)

Einmalig bauen: `swiftc -O stt/hoer.swift -o stt/hoer` (macOS 26+, SpeechAnalyzer; lädt beim 1. Mal das deutsche Modell).
- `/record start live:True` – Transkript gleich mitlaufen lassen; `kanal:#Sprachkanal` wählt den Kanal (Standard: deiner). Aus einem Textkanal gestartet → eigener Thread dort
- `/record live an:True|False` – während der Aufnahme an/aus
- Ergebnis: eigener Thread „📝 Transkript …“ (Zeilen werden an eine Nachricht angehängt, kein Chat-Spam; ohne Thread-Recht eine wachsende Nachricht im Kanal) + `live.md` im Aufnahmeordner (Zeiten ab Start)
- `.env`: `LIVE_STT=1` = standardmäßig an, `LIVE_POST=0` = nur `live.md`, nicht in den Chat, `STT_LOCALE=en-US` für eine andere Sprache
- Das genaue Transkript mit Wort-Zeitstempeln bleibt `npm run transcribe` (Qwen3-ASR)

### Nur Transkript (keine Audio-Aufnahme)

- `/transcript start [kanal] [kampagne]` / `/transcript stop` – wie `/record` mit Live-Transkript, aber ohne FLAC-Spuren; Sprecher weiterhin pro User getrennt
- Ergebnis: nur `live.md` + `session.json` (`"audio": false`); braucht `stt/hoer`. Nachträgliches `npm run transcribe` geht hier nicht (kein Audio)

### Zugriff

- `.env` `ALLOWED_USERS=<id>,<id>` = Owner (leer = jeder darf steuern)
- `/zugriff add|remove user:@Name`, `/zugriff liste` – nur Owner; weitere Freigaben landen in `allowed.json` (lokal, gitignored), gelten auf allen Servern

### Namensliste pro Kampagne (`glossar/<name>.tsv`)

Format wie claude-artifact-cli: `BEGRIFF<TAB>Fehlhörung | Fehlhörung`, `#` = Kommentar.
- `/record start kampagne:schicksal` (oder `.env` `GLOSSAR=schicksal`) → Live-Text wird korrigiert, Name steht in `session.json`
- `npm run transcribe -- recordings/<ordner>` nimmt die Liste aus `session.json` (oder `--glossar wh40k` davor): Begriffe → Qwen-Kontext, Fehlhörungen → ersetzt in `words.json`/`transcript.*`
- Neue Liste = neue Datei; Bot neu starten, damit sie in der Auswahl erscheint

`Ctrl+C` im Terminal (oder SIGTERM, z. B. launchd-Stop) beendet sauber und speichert laufende Aufnahmen.
Als Dienst: `~/Library/LaunchAgents/local.discord-recorder.plist` (RunAtLoad + KeepAlive, Log `recordings/bot.log`); Neustart `launchctl kickstart -k gui/$(id -u)/local.discord-recorder`.
Anderer Speicherort: `RECORD_DIR=...` in `.env`.

## Hinweise

- **Einverständnis:** Alle sehen die Ansage im Chat. Wer nicht will, sagt es – dann nicht aufnehmen.
- Mac muss während der Session laufen (kein Ruhezustand: `caffeinate -i npm start`).
- Discord verschlüsselt Sprache Ende-zu-Ende (DAVE); `@discordjs/voice` 0.19 + `@snazzah/davey` unterstützen das.
- Zeitgenauigkeit: Pausen werden mit Stille aufgefüllt, Abweichung zwischen Spuren ≲ 0,1 s.

## Dateien

- `index.js` – Bot, Slash-Commands, Empfang pro Person
- `track.js` – schreibt PCM → FLAC (ffmpeg) und hält Spuren synchron
- `test-track.js` – Offline-Test der Synchronisation (`node test-track.js`)

## Auswertung (lokal, `auswertung/`)

Serielle Auswertung einer Aufnahme mit lokalen Modellen (vMLX, über `gpu-run`):
```bash
gpu-run -n pnp-auswertung --ram 10 node auswertung/run.mjs recordings/<ordner>          # Protokoll (Gemma-4 E4B Heretic): chunk-NN.json + stand-NN.txt + recap.md
gpu-run -n pnp-blog --ram 18 node auswertung/run.mjs recordings/<ordner> --szenen        # Blog nach Szenen (Gemma-4 26B-A4B): blog-szenen.md
pnp-fortschritt -w                                                                        # Fortschritt (Symlink auf auswertung/fortschritt.mjs)
node auswertung/zeige.mjs recordings/<ordner>                                             # Zwischenstand lesbar
```
- Prompts: `prompt-chunk/stand/final.md` (Protokoll), `prompt-szenen.md` + `prompt-blog-szene.md` + `prompt-blog-rahmen.md` (Blog); `config.json` (Fenster, Sprecher-Rollen, Tokens)
- `namen.md` + `welt-schicksal.md` (aus Foundry) = Namen/Rollen; enthält SL-Geheimnisse → Blog-Prompt verbietet Spoiler
- Fortsetzbar: vorhandene Dateien werden übersprungen; `--nur A-B`, `--dry`, `--final`, `--nur-blog --tag x`, `PNP_MODEL`, `PNP_TAG` (eigener Ausgabeordner)
- Heretic-E4B braucht die Template-Kopie `~/AI-Model/models/zecanard/gemma-4-E4B-heretic-nothink` (Original setzt `enable_thinking=true` hart)

