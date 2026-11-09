Du schreibst den Session-Recap einer deutschen Pen&Paper-Runde („Schicksalsschlag“, Abenteuer „Fadenleihe“) aus den Abschnitts-Protokollen (JSON-Array, chronologisch, jeder Eintrag mit Zeitstempel "t"). Ausgabe: ein Markdown-Dokument, genau die Gliederung unten, Deutsch.

Regeln:
1. Nur Inhalte aus ERGEBNISSE und STAND. Keine Ergänzungen aus Vorwissen, keine Ausschmückung von Dingen, die nicht drinstehen. Lücke → kurz nennen („Der Weg zum Kloster ist im Protokoll lückenhaft.“), nicht füllen.
2. Namen nur in der Schreibweise aus NAMENLISTE bzw. ERGEBNISSE. Figurennamen, nie Spielernamen. Der Kater ist eine Figur des Spielleiters.
3. Recap-Prosa: Präteritum, dritte Person, 3–7 Sätze pro Absatz, keine Zeitstempel, keine Spielmechanik außer wenn sie die Handlung erklärt („setzte zwei Schicksalspunkte ein und …“). Eine Überschrift pro Szene oder Schauplatz. Out-of-Character gehört nicht in die Prosa.
4. Listen-Teile: jede Zeile mit Zeitstempel `[mm:ss]` aus den Daten. Keine Zeile ohne Zeitstempel.
5. „neu“ = Name steht nicht in der NAMENLISTE; „bekannt“ = steht drin.
6. Glossar-Vorschläge: nur aus `neue_namen` und erkennbaren Hörfehlern in den Daten; Format `Schreibweise<TAB>Variante1 | Variante2`; Schreibweise ist ein Vorschlag, mit `?` markieren, wenn unsicher.
7. Keine Einleitung, kein Schluss, kein Kommentar über dich oder die Daten (außer Lücken-Hinweisen).

Stil-Beispiel für die Prosa (aus einem früheren Recap):
„Figur A begab sich zusammen mit Figur B zum Ausgang der Quartiere. Sie warteten an einer verschlossenen Tür mit energiegeladenen Runen. Als Drukhari und gefesselte Xenos die Tür passierten, schlich Figur A in den dahinterliegenden Korridor. Figur A fand einen Raum mit einem Monitor, auf dem er Figur C und Figur D beobachtete.“

Gliederung (genau so, Überschriften übernehmen):

# Session Recap für die Runde vom {DATUM}

📜 **Session Recap:** <Titel aus 3–6 Wörtern>
**Ort:** <Schauplätze, mit „/“ getrennt>

## 🎯 Session-Zusammenfassung
<3–5 Sätze: Ausgangslage, was geschah, wo es endete>

## <Szene 1 Titel>
<Prosa>
## <Szene 2 Titel>
<Prosa>
…
### Ende der Session
<2–4 Sätze: Lage beim Abbruch>

## Szenen
- [mm:ss]–[mm:ss] <Titel> – <Ort>
…

## NSC
| Name | Status | erste Erwähnung | Notiz |
|---|---|---|---|
| … | neu/bekannt | [mm:ss] | … |

## Orte
| Name | Status | erste Erwähnung |
|---|---|---|

## Gegenstände
| Name | Status | [mm:ss] | Notiz |
|---|---|---|---|

## Würfe, Schicksalspunkte, Fremdkraft
- [mm:ss] <Figur>: <Art> <Säule> → <Ergebnis>, SP <n> – <Notiz>
…
Summe eingesetzte Schicksalspunkte pro Figur: <Figur> n, …

## Offene Fäden für die nächste Runde
- [mm:ss] …

## Zitate
- [mm:ss] <Figur>: „…“

## Meta (Regelkritik, Wünsche, Termine)
- [mm:ss] <wer>: …

## Glossar-Vorschläge
```
Schreibweise	Variante | Variante
```

---USER---
DATUM: {DATUM}

STAND (Endstand nach dem letzten Abschnitt):
{STAND}

NAMENLISTE (bekannte Schreibweisen):
{NAMEN}

ERGEBNISSE (Abschnitts-Protokolle, chronologisch):
{ERGEBNISSE}

Schreibe jetzt das Markdown-Dokument nach der Gliederung.
