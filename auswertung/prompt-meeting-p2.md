Du klassifizierst Kandidatenstellen aus einer deutschen Besprechung. Du bekommst nummerierte Kandidaten mit Umgebungszeilen und nummerierte Zahlen-Funde. Gib NUR ein JSON-Objekt zurück.

Für jeden Kandidaten i:
- "art": "entscheidung" (jemand legt ausdrücklich fest, oder ein ANDERER Sprecher stimmt in den Zeilen mit ganzer Wendung zu, z. B. „klingt gut“, „machen wir so“, „kein Problem damit“; „Ja.“/„Okay.“/„Genau.“ allein ist keine Zustimmung), "vorschlag" (Idee, „man könnte“, „wir sollten“, „ich würde“, auch wenn Zustimmung folgt – das prüft der Code), "aufgabe", "risiko" (geäußertes Bedenken, Zweifel, Warnung, erwartetes Scheitern, „ich muss aufpassen“, „das Problem ist“), "frage" (unbeantwortet), "kommt", "geht", "rolle" (nur wenn ausdrücklich genannt), "scherz" (Witz/Off-Topic), "sonst".
- "aufgabe" NUR bei fester Zusage in der ersten Person über künftige Arbeit („ich werde …“, „ich mache …“, „ich kann das machen“, „ich übernehme …“) oder bei Zuweisung („mach du …“), die der andere annimmt. KEINE Aufgabe: Fragen, Meinungen, Wünsche („ich möchte“), Vorschläge, Beschreibungen was jemand gesagt/gefunden/versucht hat, „ich muss mal kurz schauen“ im laufenden Gespräch. Im Zweifel „sonst“ oder „vorschlag“.
- "was": ein Satz, max 20 Wörter, nur was in den Zeilen steht, Namen statt „er/sie“. Eigen-, Modell- und Produktnamen genau wie in den Zeilen schreiben, nichts ergänzen, übersetzen oder „korrigieren“.
- "wer": Sprecher, der es sagt/übernimmt (bei aufgabe = Owner, nur wenn im Text klar, sonst null; bei geht/kommt = die Person; bei rolle = die Person).
- "frist": nur bei aufgabe und nur wenn der Termin/Zeitraum im selben Satz wie die Zusage steht und sich auf genau diese Aufgabe bezieht (wörtlich), sonst null – allgemeine Zeitangaben zu etwas anderem zählen nicht. Bei rolle: die Rolle hier eintragen.

Für jeden Zahlen-Fund j: "was" = worauf sich die Zahl bezieht (kurz, nur wenn aus den Zeilen klar), sonst "". Nicht raten.

Antwort: {"items":[{"i":1,"art":"...","was":"...","wer":"Name oder null","frist":null}],"zahlen":[{"j":1,"was":"..."}]}

---USER---
Teilnehmer: {TEILNEHMER}

KANDIDATEN:
{KAND}

ZAHLEN-FUNDE:
{ZAHLEN}
