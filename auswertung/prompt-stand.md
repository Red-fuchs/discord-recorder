Du führst den STAND einer Pen&Paper-Runde fort: eine kurze Merkliste, die dem nächsten Abschnitt als Kontext dient. Du bekommst den alten STAND und das Protokoll-JSON des gerade ausgewerteten Abschnitts.

Regeln:
1. Nur Inhalte aus altem STAND und ERGEBNIS. Nichts erfinden, nichts dazuerklären.
2. Festes Format, genau diese fünf Blöcke, sonst nichts:
   Ort: <ein Satzteil>
   Ziel: <ein Satz, aktuelles Vorhaben der Gruppe>
   Figuren: <eine Zeile, Zustand der Spielfiguren und des Katers, nur wenn bekannt>
   Verlauf: max 8 Zeilen `- [mm:ss] Satz` – die wichtigsten Wendungen der ganzen Runde, chronologisch, Zeitstempel aus dem ERGEBNIS/alten STAND übernehmen
   Offen: max 5 Zeilen `- [mm:ss] Satz` – unerledigte Aufgaben, Drohungen, Rätsel
   Gesehen: NSC und Orte als Namensliste mit Komma, jeder Name einmal, ohne Zeitstempel
3. Wird der Platz knapp: ältere Verlauf-Zeilen zu einer Zeile zusammenfassen (mit Zeitstempel der ersten), nie löschen, was für das Ziel noch wichtig ist. Erledigtes aus „Offen“ streichen.
4. Jede Zeile max 20 Wörter, Präteritum, Figurennamen in der Schreibweise des ERGEBNIS. Ganzer STAND max 1500 Zeichen.
5. Antwort = nur der STAND, kein Kommentar, kein Markdown außer den Bindestrichen.

Beispiel-Ausgabe:
Ort: Kapelle in Grams am Moor, Krypta-Treppe
Ziel: Durch die Krypta ins Kloster der Spinner, die Nadel aus dem Reliquienschrein holen
Figuren: Irmeltrud (alt, stolpert), Karl (Nekromant), Don (Langfinger); Kater begleitet; Jin fehlt
Verlauf:
- [25:51] Jin Mu-Won opferte sich der Weberin, damit das Schicksal ruhig blieb; die Weberin verschwand.
- [41:52] Die Gruppe gab sich in Grams als Steuereintreiber des Fürsten aus.
Offen:
- [26:28] Weitere Schreine der Weberin finden, wo der Faden dünn ist.
Gesehen: Die Weberin, Hinrich Vosskamp, Grams am Moor, Taverne

---USER---
ALTER STAND:
{STAND}

ERGEBNIS (Abschnitt-JSON):
{ERGEBNIS}

Gib den neuen STAND.
