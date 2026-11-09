# Auswertung Schicksalsschlag-Transkript – Design (2026-10-30)

**Pipeline:** Vorverarbeitung (Code) → pro Chunk `prompt-chunk.md` (JSON, `schema.json`) → `prompt-stand.md` (Rolling-Stand, Klartext ≤1500 Zeichen) → `prompt-final.md` (Markdown-Recap). Prompt-Dateien: System, Zeile `---USER---`, User-Template. Parameter in `config.json`; Startwerte `stand-start.md`, Namensliste `namen.md`.

**Vorverarbeitung (Code, deterministisch):** `**[mm:ss] Sprecher:**` → `[mm:ss] Label:` mit `speaker_labels` (SL / Irmeltrud / Karl / Don). Zeilen nach Zeitstempel stabil sortieren (Spuren-Merge liefert nicht-monotone Zeiten, z. B. 131:02 vor 131:00). Zeilen, die nur Satzzeichen enthalten, streichen. Die Spielerlabels sind absichtlich Figurennamen: das nimmt dem 4B-Modell die schwerste Aufgabe (Sprecher → Figur) ab. Verifiziert aus dem Transkript: Spieler-1 = Irmeltrud Stolperwurz (41:52), Spieler-2 = Knochen-Karl (Nekromant, „Nackenklatscher“ 130:44/131:00), Spieler-3 = Don Zaloog (Langfinger 131:29, „Don Salom“ 34:55), GM-Name = SL (erzählt, spielt den Kater), Jin Mu-Won = Figur ohne Spieler, opfert sich 25:51.

**Chunking:** Zeitfenster 10 min (≈ 95 Zeilen, ≈ 1500 Wörter, ≈ 2,5–3k Tokens) → 28 Chunks für 280 min. Begründung: Zeilendichte ist gleichmäßig (73–121 Zeilen/10 min), Zeitfenster sind für Szenenliste und Spot-Check direkt nachschlagbar, und 3k Tokens Transkript sind die Grenze, bis zu der E4B noch Details hält. Fenster > 140 Zeilen → in 2×5 min teilen; Rest < 30 Zeilen → an Vorgänger hängen. Overlap 10 Zeilen (~1 min) als Kontext, Regel 9 im Prompt + Code-Dedupe nach `t` verhindern Doppelzählung. Pro Call ≈ 5k Tokens Input (System 0,9k + Stand 0,4k + Namen 0,7k + Chunk 3k), 0,5–1k Output.

**Stand:** separater Call, festes 5-Block-Klartextformat, Cap 1500 Zeichen (Code prüft; bei Überschreitung denselben Prompt mit Zusatz „Kürze auf 1500 Zeichen“ wiederholen). Stand ist Kontext, nie Faktenquelle: jede Behauptung im Chunk-JSON braucht ein `t` aus dem Chunk.

**Namensliste:** `namen.md` (Glossar + Hörfehler + in dieser Session neu gehörte Namen). Empfehlung: pro Chunk filtern – Kernliste (Spielfiguren, Kater, Weberin, Kettler, Garnwesen) immer, Glossarnamen nur wenn ein Token im Chunk fuzzy (ratio ≥ 0,75) trifft. Das senkt Namens-Halluzination (z. B. „Abt Odilo Wendt“ kommt in der Session nie vor). `neue_namen` mit ≥ 2 Treffern nach Fable/Human-Freigabe an die Liste anhängen.

**Modell:** Gemma-4 E4B Heretic (Entscheidung User), 6-bit bevorzugt (4-bit verliert bei Umlaut-Namen). Sampling: temp 0,1, top_p 0,9, rep-penalty 1,05, max_tokens 1200; Final temp 0,3, max 4000. Gemma: System-Teil als erste User-Nachricht voranstellen, falls das Template keine System-Rolle kennt. JSON-Schema als `response_format` wenn der Server es kann (vMLX/LM Studio), sonst: Parse-Fehler → 1 Retry mit „Nur JSON, beginne mit {“, dann Chunk als `fehler` markieren, nicht raten. Ehrlich: Qwen3.5-9B wäre bei Namensdisziplin und Final-Synthese sicherer; E4B reicht für die Chunk-Extraktion, der Final-Pass ist sein Schwachpunkt.

**Final-Pass:** ein Call mit JSON-Array aller Chunks (≈ 28 × 500 Tokens ≈ 14k). Über 12k Tokens Runner `zitate`/`orte` streichen (`config.json`). Bessere Variante, falls E4B dort abdriftet: Tabellen (NSC/Orte/Gegenstände neu vs bekannt, Würfe, Glossar) im Code aus dem JSON bauen und dem Modell nur `szene_neu` + `ereignisse` + `offen` + `meta` für die Prosa geben, Prosa in 3–4 Blöcken à ~7 Szenen.

**Failure modes → Mitigation:**
- Namens-Halluzination → geschlossene Liste, Filter pro Chunk, `t`-Anker; Code verwirft Namen, die weder in Liste noch wörtlich im Chunk stehen.
- Erfundene/falsche Zeitstempel → Code prüft jedes `t`: muss als Zeile im Chunk existieren und ≥ VON sein; sonst Eintrag streichen, Zähler loggen.
- OOC-Leck (Metakritik 146:46, Bier/Pause ab 49:42, Technik 00:00–01:14) → Regel 5, eigenes Feld `meta`, Final-Pass hält OOC aus der Prosa.
- SL-Ich-Form = NSC → Regel 4; `wer` nur Figurennamen (Enum-ähnlich prüfbar).
- Würfelzahlen fehlen (Foundry zeigt sie, kaum ausgesprochen) → nur Art/Säule/Ergebnis/SP; SP-Summen sind untere Schranke.
- Format-Drift → Schema-Enforcement, additionalProperties false, Caps pro Liste.
- Detailverlust → 10-min-Fenster, max 10 Ereignisse, STAND als Gedächtnis.

**Spot-Check (Fable):** 5 Chunks – 1 (Einstieg/OOC), 13 (120–130, dichteste), 15 (146 Metakritik), 1 zufällig, 28 (Ende). Pro Chunk: jedes `t` aufschlagen, prüfen ob die Zeile die Aussage trägt (Ziel ≥ 85 % gestützt), 0 Namen außerhalb Liste/Chunk, 0 OOC in `ereignisse`. Alle `wuerfe` (wenige) und alle `neue_namen` vollständig prüfen. Final: Szenenliste gegen Chunk-`szene_neu`, Recap-Absätze stichprobenartig auf Erfindungen.

**Wo E4B wahrscheinlich scheitert:** Kater vs. Kettler vs. SL-Erzählstimme bei Hörfehlern („der Kater sozusagen in die Richtung“), Jin-Opfer-Szene (Dialog in Ich-Form, drei Figuren), Schicksalspunkt-Buchhaltung über Chunkgrenzen, Hörfehler-Deutung („Rattelfrage“ = Orakelfrage, „Garn Wissen“ = Garnwesen), und ein 14k-Token-Final in einem Stück (Erwartung: letzte Szenen werden dünn, Tabellen unvollständig → Code-Tabellen-Variante nutzen).
