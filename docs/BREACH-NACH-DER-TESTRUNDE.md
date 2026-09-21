# BREACH: Plan nach eurer ersten Testrunde

Stand: 20. September 2026, nach eurem ersten Feedback. Die folgenden Tabellen bleiben
ein Vorschlagskatalog; der aktuelle Umsetzungsstand steht direkt darunter.

**In der zweiten Version umgesetzt:** Fehler bei kurzen Feuertipps und beim Loslassen
eines zweiten Fingers behoben; Auto-Reload; zehn unterschiedliche Waffen mit Auswahl
während der Runde; größere Querformat-Tasten und schwebender Stick; speicherbare
Empfindlichkeit und Linkshänder-Modus; optionale Zielhilfe ausschließlich im Koop;
leichtere Bots und Erholung im Modus Entspannt; überarbeitete Station, Waffenmodelle,
Treffereffekte und Sounds. Damit sind Teile von K1/K3/K6 sowie K2/K8 und die
Waffen-/Zielhilfe-Themen C1/C6 umgesetzt. Y-Invertierung, frei einstellbare Totzone,
HUD-Größenregler und Vibration gehören weiterhin zu den Vorschlägen. Die alten
Prioritätsempfehlungen unten wurden durch euren ausdrücklichen Waffenwunsch ergänzt.

**Weitere Qualitätsrunde:** K4 ist jetzt umgesetzt: Ziel-/Abbruchhinweise und ein
Fortschrittsbalken beim Legen und Entschärfen. Für K5 gibt es nun einen Signalwächter
(nach 1,8 Sekunden ohne Bildschirm-Update Eingaben pausieren; klare Anzeige und
saubere Rückkehr), jedoch noch keine Ping-Messung oder Wiederaufnahme einer getrennten
Spielfigur. Dazu kommen Startschutz und getrennte Wiedereinstiegspunkte im Deathmatch,
korrigierte Bot-Statistiken und die Anbindung an den Ton-Schalter des Laptops.

## 1. Ausgangspunkt: Was ihr bereits spielen könnt

Euer Hauptaufbau ist **ein Laptop als Bildschirm und zwei Handys als Controller**.
Beide Handys öffnen den vorhandenen Party-Hub-Link im selben WLAN. Im Spiel ist die
Ansicht von Spieler 1 oben, die von Spieler 2 unten. Ihr spielt gemeinsam gegen Bots.

Bereits vorhanden:

- Eigene 3D-Map **Station NEXUS**, zwei Bombenplätze A/B, Deckung und mehrere Laufwege.
- Links bewegen, rechts wischen zum Zielen, FEUER halten; Ziehen auf FEUER erlaubt
  gleichzeitiges Schießen und Zielen mit dem rechten Daumen.
- Nachladen, Rauchgranaten und Bombenlegen auf beiden Handy-Controllern.
- Taktische Runden und ein Team-Deathmatch mit Wiedereinstiegen.
- Zehn Waffen zur kostenlosen Auswahl jederzeit; automatisches Nachladen, Magazine,
  Reservemunition, Kopf- und Körpertreffer, Rüstung und Trefferanzeige.
- Bots mit Wegsuche, Deckungsprüfung, Rauch als Sichtblockade und Bombenaktionen.
- Rundenzähler, Radar, Lebenspunkte, Munition, Zuschaueransicht und Host-Revanche.
- Ein separater Browser-Modus mit privaten Räumen, Einladungscode/-link, Teamwahl,
  optionalen Bots, bis zu acht Menschen und serverseitiger Spielsimulation.
- Maus/WASD, Rechtsklick zum Anvisieren, leises Gehen, Springen und eine Statistik
  für das Spiel auf einem eigenen PC-Bildschirm; Touch-Steuerung für eigene Mobilansichten.

Die bestehenden Spiele bleiben erhalten. Alle Assets des neuen Spiels sind lokal;
die Station, Figuren und Sounds sind prozedural erzeugt.

**Wichtige Grenzen der ersten Version:** Die Browser-Tests ersetzen keinen Test auf
euren physischen Handys. Internet-Räume brauchen einen öffentlich erreichbaren
Spielserver; ein solcher ist noch nicht bereitgestellt. Ein laufender Online-Raum
kann angesehen werden, neue Spieler steigen aber erst beim nächsten Match ein.
Vollständiges Wiederaufnehmen einer Figur nach Handy-Abbruch, frei verschiebbare
Controller-Tasten, Kaufwirtschaft, weitere Maps und Matchmaking sind noch nicht vorhanden.
Der bestehende Netzwerktransport versucht Verbindungen wiederherzustellen; das ist
noch keine garantierte Fortsetzung derselben Spielfigur nach einem Abbruch.

## 2. Eure erste Runde: 20–30 Minuten, wenig Aufwand

### Vorbereitung

1. Laptop und beide Handys ins gleiche WLAN bringen. Auf dem Laptop `/screen.html`
   öffnen; auf beiden Handys den QR-Code scannen, verschiedene Namen eingeben.
2. Auf dem Host-Handy **BREACH · Station NEXUS**, **Entspannt** und zunächst einen
   Rundensieg auswählen. Laptop möglichst groß oder im Vollbild anzeigen.
3. Notieren: Handy-Modelle, Browser, Hoch-/Querformat, Laptop-Auflösung, ungefährer
   Abstand zum Laptop und ob beide Geräte im selben WLAN sind.

### Ablauf

| Abschnitt | Dauer | Aufgabe | Worauf achten? |
|---|---:|---|---|
| Beitritt | 2 Min. | Beide ohne Hilfe vom Link bis zur eigenen Ansicht | Wo muss jemand erklären oder übernehmen? |
| Grundgefühl | 3 Min. | Bewegen, um Ecken schauen, gleichzeitig laufen und feuern | Daumenwege, ungewollte Drehungen, hängende Tasten |
| Orientierung | 3 Min. | Jeder sucht einmal A und einmal B | Verständliche Wege, Landmarks, eigene Bildschirmhälfte |
| Gemeinsamer Einsatz | 6–10 Min. | Einer legt die Bombe, der andere sichert | Rollen, Verständlichkeit des Ziels, Frust nach einem Tod |
| Revanche/Deathmatch | 4 Min. | Rollen tauschen; dann einen schnellen Modus spielen | Wiederholbarkeit, Wartezeiten, Freude an beiden Waffen/Modi |
| Unterbrechung | 2 Min. | Nach der Runde ein Handy sperren und erneut öffnen | Verständlicher Verbindungszustand; kein unerwartetes Dauerfeuer |
| Feedback | 3 Min. | Jeder gibt unabhängig seine drei wichtigsten Punkte an | Erst individuelle Aussagen, dann gemeinsame Priorität |

Nicht alle Probleme während des Spielens diskutieren. Ein kurzes Stichwort reicht;
sonst bewertet ihr eher die Unterbrechungen als das Spielgefühl.

### Kompakte Feedback-Checkliste zum Kopieren

```text
Geräte/Browser:
Handy-Ausrichtung und Abstand zum Laptop:
Beitritt bis spielbereit: ungefähr ___ Sekunden
Steuerung: ___ / 5     Zielgenauigkeit: ___ / 5
Lesbarkeit: ___ / 5    Orientierung: ___ / 5
Spielspaß: ___ / 5     Würde ich sofort eine weitere Runde spielen? Ja / Nein

[ ] Beide Ansichten sofort zugeordnet
[ ] Gleichzeitig bewegen, zielen und feuern funktioniert angenehm
[ ] Keine Taste bleibt nach dem Loslassen aktiv
[ ] Leben und Munition vom Sitzplatz lesbar
[ ] A/B und aktuelles Ziel ohne Erklärung gefunden
[ ] Bombenaktion und Rundenergebnis verstanden
[ ] Kein auffälliges Ruckeln / Verbindungsproblem
[ ] Revanche ohne neues Verbinden gestartet

Nervigster Moment:
Bester Moment:
Genau ein Feature, das ich als Nächstes möchte:
Fehler: Was gemacht? Was erwartet? Was passiert? Welches Gerät?
```

## 3. So priorisieren wir danach

**P0:** Spielabbruch, nicht funktionierende Eingaben, falsche Treffer/Rundenergebnisse,
unlesbares Kern-HUD oder ein Gerät kann nicht beitreten. Zuerst beheben.

**P1:** Häufig spürbare Verbesserungen für eure Zwei-Handy-Runden. Vorrang vor mehr Inhalt.

**P2:** Mehr Abwechslung und taktische Tiefe, sobald die erste Runde angenehm läuft.

**P3:** Größere Online- und Komfortfunktionen, deren Bedarf ihr erst bestätigen solltet.

Aufwandsschätzungen gelten für eine fokussierte Umsetzung inklusive passender Tests:
**S** = ungefähr 2–6 Stunden, **M** = 1–3 Tage, **L** = 4–8 Tage, **XL** = mehr als
8 Tage oder noch nicht verlässlich schätzbar. Es sind Größenordnungen, keine Termine.
Wir nehmen pro Ausbaustufe höchstens drei größere Themen auf.

Bei gleicher Priorität gewinnt das Thema, das häufiger auftritt, beide Spieler betrifft
und schneller überprüfbar ist. Ein spontaner Wunsch nach einer neuen Waffe überholt
keinen reproduzierbaren Steuerungsfehler.

## 4. Kleine Verbesserungen für die nächste Runde

Alle folgenden Bedürfnisse sind Vorschläge, bis ihr sie bestätigt. Reproduzierbare
Fehler aus eurer Checkliste können einzelne Einträge auf P0 hochstufen.

| ID | Priorität / Vorschlag | Nutzen | Aufwand | Abhängigkeit | Überprüfbares Erfolgskriterium |
|---|---|---|---|---|---|
| K1 | P1 · Empfindlichkeit, Y-Achse und Totzone pro Handy einstellen | Beide können präzise zielen, auch bei unterschiedlichen Displays | S | Eure Angaben „zu schnell/zu langsam“ | Beide treffen im gleichen Zielparcours nach Einstellung mehr Ziele; Werte bleiben nach Reload erhalten |
| K2 | P1 · Links-/Rechtshänder-Layout und größere Tasten | Weniger verrenkte Daumen und versehentliche Aktionen | M | K1; echte Handgrößen/Orientierungen | Keine Überlappung bei 360×640 und 844×390; 20 Aktionen ohne unbeabsichtigtes Nachladen/Abbrechen |
| K3 | P1 · HUD-Größe und deutlichere Zuordnung OBEN/UNTEN | Leben, Munition und eigene Ansicht vom Sofa schneller erfassen | S | Euer Sitzabstand | Beide nennen Leben, Munition und Runde innerhalb von 2 Sekunden korrekt |
| K4 | P1 · Zielhinweise auf dem Handy mit Fortschrittsbalken | Klar, warum Legen/Entschärfen beginnt, abbricht oder nicht möglich ist | S | Vorhandene Bombenlogik | Neue Spieler legen eine Bombe ohne mündliche Erklärung; Abbruch ist sofort sichtbar |
| K5 | P1 · Controller-Status „verbunden / Signal schwach / getrennt“ | WLAN-Aussetzer sind vom verlorenen Leben zu unterscheiden | S–M | Messung von Ping/letztem Paket im Party-Modus | WLAN kurz trennen: Meldung spätestens nach 2 Sekunden; keine weitere Bewegung oder Schüsse |
| K6 | P1 · Deutlicheres Treffer-/Schadensfeedback, optionale Vibration | Schüsse fühlen sich nachvollziehbar an, ohne ständig das Handy anzusehen | S | Bestehende Trefferereignisse; Browser unterstützt Vibration optional | Spieler unterscheiden Treffer, eingehenden Schaden und leeres Magazin in 9 von 10 Versuchen |
| K7 | P1 · Kurzes gemeinsames Match-Fazit mit „Nochmal“ und „Modus wechseln“ | Weniger Leerlauf zwischen zwei Runden | S–M | Bestehende Ergebnisse und Host-Revanche | Eine Revanche mit denselben Handys ist mit höchstens zwei bewussten Aktionen gestartet |
| K8 | P2 · Wiedererkennbare Labor-/Reaktormarkierungen und Wegweiser | Die vorhandene Map leichter lernen | S | Erste Laufwege beobachten | Beide finden A und B beim zweiten Versuch ohne Nachfrage; Markierungen auch ohne Farbe verständlich |
| K9 | P2 · Getrennte Regler für Schüsse, Schritte und UI | Angenehmes Spielen über Laptop-Lautsprecher | S | Bestehende Soundengine | Einstellungen bleiben gespeichert; wichtige Hinweise bleiben auch bei leisen Schüssen hörbar |
| K10 | P2 · Kurze optionale Einführung mit drei Aufgaben | Freunde ohne Erklärung einsteigen lassen | M | K1/K4; grundlegendes Layout steht fest | Unvorbereiteter Gast bewegt sich, lädt nach und bedient das Ziel in unter 3 Minuten |

**Empfohlener erster kleiner Umfang:** K1 + K3 + K4. Falls Verbindungsprobleme auftreten,
wird K5 vorgezogen. K2 ist wichtiger als neue Waffen, wenn der rechte Daumen ständig
zwischen Zielen und Aktionen wechseln muss. Das bereits vorhandene Ziehen auf FEUER
bleibt dabei erhalten und wird nicht als neues Feature gezählt.

## 5. Größere Ausbaustufen

### A. Verlässlichere gemeinsame Spielabende

| ID | Priorität / Vorschlag | Nutzen | Aufwand | Abhängigkeit | Erfolgskriterium |
|---|---|---|---|---|---|
| A1 | P1 · Echte Wiederaufnahme nach Handy-Sperre/WLAN-Abbruch | Kein verlorener Matchplatz durch einen kurzen Aussetzer | L | Stabile Spieleridentität, K5, klare Regeln für Bot-Übernahme | 5 Sekunden unterbrechen: derselbe Spieler kommt ohne zweiten Eintrag mit konsistentem Zustand zurück |
| A2 | P1 · Messbare Grafikprofile „Leicht / Standard / Schön“ | Ruhiger Splitscreen auf schwächeren Laptops | M | FPS-/Framezeit-Messung auf eurem echten Laptop | Im leichten Profil bei 2 Ansichten p95-Framezeit höchstens 33 ms über 10 Minuten; keine dauerhaft steigende Speichernutzung |
| A3 | P1 bei Internetspiel · Vorhersage der eigenen Bewegung und kontrollierter Zustandsabgleich | Weniger verzögerte Bewegung außerhalb des WLANs | L | Zeit-/Sequenznummern, reproduzierbare Netzwerksimulation | Bei 80 ms RTT fühlt sich die eigene Bewegung unmittelbar an; Korrekturen erzeugen keine Wanddurchquerung |
| A4 | P2 · Betreten eines laufenden Matches ab nächster Runde | Freunde warten nicht auf ein ganzes Match | M | Teamlimits, Zuschauerstatus, A1 | Später Gast sieht klare Warteanzeige und erhält genau eine Figur beim nächsten Rundenstart |
| A5 | P2 · Wahl zwischen gemeinsamem Team und lokalem Gegeneinander | Mit zwei Handys auch Duelle spielen | M | Team-/Spawn-Regeln im Party-Adapter, lesbare Teamfarben | Zwei Handys steuern gegnerische Teams; Sieg, Statistik und Revanche stimmen in beiden Modi |
| A6 | P3 · Zwei Laptop-/Handy-Gruppen in demselben Internetraum | Vier Freunde in zwei Wohnungen spielen gemeinsam | XL | A1/A3, gemeinsame Raumautorität, sichere Zuordnung mehrerer Controller | Zwei Laptops mit je zwei Handys spielen 20 Minuten; kein Controller steuert die falsche Figur |

**A6 ist eine neue Architektur-Erweiterung.** Der aktuelle Party-Hub-Modus und die
Online-Räume sind getrennte Spielwege. Ihre Kombination wird nicht stillschweigend
als schon vorhanden angenommen.

Für A1 muss vorab feststehen: Wie lange wird ein Platz reserviert? Soll ein Bot in der
Zwischenzeit übernehmen? Kann ein Spieler nach seinem Tod zurückkehren, ohne sich
dadurch einen zusätzlichen Spawn zu verschaffen? Vorschlag: 30 Sekunden Reservierung,
kein neuer Lebensvorrat, eindeutige Rückgabe der Steuerung.

### B. Bessere Karten und taktische Entscheidungen

| ID | Priorität / Vorschlag | Nutzen | Aufwand | Abhängigkeit | Erfolgskriterium |
|---|---|---|---|---|---|
| B1 | P2 · NEXUS anhand eurer Wege nachbalancieren | Weniger Sackgassen und dominante Schusslinien | M | Beobachtungen aus mindestens 10 kurzen Runden | Alle Spawns erreichen beide Ziele; kein direkter Spawn-Treffer; beide Ziele werden tatsächlich genutzt |
| B2 | P2 · Zweite Map „ORBITAL“: Andockring und Kontrollraum | Mehr Abwechslung bei ähnlicher Orientierung | L | Stabiles Kartenschema, B1 als Referenz | Zwei Hauptwege + eine Flanke je Ziel; gleiche Kollisions-/Wegfindungsprüfungen; Leistung im Zielprofil |
| B3 | P2 · Koop-Auftrag „Datenkern bergen“ | Gemeinsames Ziel mit weniger Wartezeit nach einem Fehler | M–L | Zielsystem, Bot-Zustände, Regeln für Wiederbelebung | Ein vollständiger Auftrag dauert 3–5 Minuten; beide Spieler haben unterwegs sinnvolle Aufgaben |
| B4 | P2 · Automatischer Seitenwechsel und Match-Varianten | Faire Vergleiche und mehr Wiederholbarkeit | M | Team-/Spawn-Logik, A5 bei lokalem PvP | Beide Teams spielen gleich oft Angriff/Verteidigung; Seitenwechsel erhält Namen/Statistik korrekt |
| B5 | P3 · Höhenwege, Leitern oder bewegliche Türen | Neue taktische Routen | L–XL | Vertikale Kollision, Bot-Navigation und zuverlässige Trefferprüfung | Bots und Menschen nutzen dieselben erreichbaren Wege; Türen blockieren Sicht, Bewegung und Treffer konsistent |

NEXUS zuerst verbessern, bevor weitere Maps dieselben Probleme vervielfachen. Eine
zweite Map sollte sich durch Raumaufteilung und Entscheidungen unterscheiden; ein
anderes Farbschema allein bietet wenig neue Spieltiefe.

### C. Waffen und Mechaniken mit klaren Rollen

| ID | Priorität / Vorschlag | Nutzen | Aufwand | Abhängigkeit | Erfolgskriterium |
|---|---|---|---|---|---|
| C1 | P2 · Bestehende drei Waffen deutlicher unterscheiden | Auswahl hängt von Spielstil und Distanz ab | M | Treffer-/Munitionsdaten, K1, Zielparcours | Jede Waffe hat eine nachvollziehbare Stärke; keine gewinnt alle Vergleichsszenarien |
| C2 | P2 · Markieren/Pingen mit dem Handy | Gemeinsam einen Gegner, Weg oder Bombenplatz benennen | M | Touch-Layout K2, Teamfilter | Ping ist für Team sichtbar, verrät Gegnern nichts und verschwindet nach festgelegter Zeit |
| C3 | P2 · Ein zusätzlicher Granatentyp: Blendgranate | Gezielte Vorstöße über die bestehende Rauchmechanik hinaus | M | Sichtprüfung und gut bedienbare Auswahl | Deckung und Blickrichtung beeinflussen Wirkung; klare Rückmeldung; keine unbegrenzte Blendkette |
| C4 | P2 · Koop-Wiederbelebung mit Risiko | Ausgeschiedene Freunde können sinnvoll zurück ins Spiel | M–L | B3 oder eigener Koop-Modus, Unterbrechungsregeln | Rettung dauert einen klaren Zeitraum, bricht unter definierten Bedingungen ab und kann nicht doppelt ausgelöst werden |
| C5 | P3 · Einfache Kaufphase mit Team-Budget | Entscheidungen zwischen Ausrüstung und Risiko | L | C1, klare Bedienung auf Handy, stabile Runden | Kauf passt in die Vorbereitung; ungültige Käufe werden serverseitig abgelehnt; Rückstand wird nicht automatisch aussichtslos |
| C6 | P3 · Optionale leichte Zielhilfe für Handy-Spieler | Einstieg erleichtern, wenn kleine Korrekturen zu schwierig bleiben | M–L | K1/K2 ausgeschöpft, Bedarf bestätigt | Kein Zielen durch Wände, keine ungewollten Zielwechsel; im PvP klar erkennbare und einheitliche Raumregel |

**Nicht sofort planen:** zehn ähnliche Waffen, komplexe Aufsätze oder permanente
Charakterwerte. Drei angenehm spielbare Waffen helfen euch mehr als viele schlecht
unterscheidbare. Eine Kaufphase lohnt sich erst, wenn ihr längere, ernstere Matches wollt.

### D. Wiederholbarkeit und Internetbetrieb

| ID | Priorität / Vorschlag | Nutzen | Aufwand | Abhängigkeit | Erfolgskriterium |
|---|---|---|---|---|---|
| D1 | P2 · Kleine Spielabend-Serie mit Map-/Moduswahl | Mehrere Matches ohne neue Raumorganisation | M | Match-Fazit K7, zweite Map optional | Drei Matches nacheinander mit denselben Handys; klare Gesamtauswertung; Host kann sauber beenden |
| D2 | P2 bei Bedarf · Dauerhaft erreichbarer privater Spielserver | Freunde können aus anderen Netzwerken beitreten | M, Betrieb zusätzlich | Hosting-Ziel/Budget, HTTPS/WSS, A3 sinnvoll | Zwei reale Anschlüsse können 30 Minuten spielen; Neustart und Kosten sind dokumentiert |
| D3 | P3 · Übungsparcours mit persönlicher Bestzeit | Zielgefühl und Waffen vergleichen, ohne Gegnerdruck | M | K1, stabile Bewegung | Feste Aufgaben, gleiche Bedingungen, nachvollziehbare Zeit-/Trefferwertung |
| D4 | P3 · Kosmetische Farbschemata und Abzeichen | Eigene Crew wiedererkennen | S–M | Gute Teamsichtbarkeit | Kosmetik verändert weder Schaden noch Tarnvorteil; Gegner und Freunde bleiben eindeutig |
| D5 | P3 · Öffentliche Raumsuche/Matchmaking | Ohne feste Gruppe Mitspieler finden | XL plus Betrieb | D2, Nutzer-/Moderationskonzept, Schutz vor Missbrauch | Erst sinnvoll definierbar, wenn ihr öffentliches Spielen tatsächlich wollt |

Die aktuelle Rang-/Matchstatistik ist flüchtig. Konten, Cloud-Speicherung oder ein
öffentliches Profil wären eigenständige Entscheidungen. Für eure privaten Spielabende
ist das zunächst keine Voraussetzung.

## 6. Empfohlene Reihenfolge mit Entscheidungspunkten

**Nach der ersten Runde:** Fehler mit Gerät und Reproduktion sammeln. Höchstens drei
P0/P1-Punkte auswählen. Wenn beide die Steuerung mit weniger als 3/5 bewerten, bleiben
neue Waffen und Maps vorerst zurückgestellt.

**Ausbaustufe 1 – angenehmer spielen:** K1, K3, K4; gegebenenfalls K2/K5 statt eines
weniger dringenden Themas. Ergebnis: beide können ohne Erklärung spielen und haben
nach drei Runden keine unangenehme Daumenhaltung.

**Ausbaustufe 2 – zuverlässig wiederkommen:** A1 und A2, dann K7. Ergebnis: Unterbrechungen
sind verständlich, die Leistung bleibt über einen Spielabend stabil, und eine Revanche
geht ohne Neuorganisation. A3/D2 vorziehen, falls ihr hauptsächlich aus verschiedenen
Wohnungen spielen wollt.

**Ausbaustufe 3 – gezielt mehr Inhalt:** Zwischen B2 (zweite Map), B3 (Koop-Auftrag)
und A5 (lokale Duelle) anhand eurer Lieblingsmomente wählen. Dazu höchstens eine
Mechanik aus C1–C4, um ihre Wirkung noch einzeln beurteilen zu können.

**Ausbaustufe 4 – nur bei bestätigtem Wunsch:** gemischte Online-/Couch-Gruppen,
Kaufwirtschaft, dauerhafte Profile oder öffentliche Raumsuche. Dafür separat Umfang,
Betriebskosten und Fertigkriterien vereinbaren.

## 7. Technische Leitplanken für jede Ausbaustufe

- Simulation und Darstellung nutzen dieselbe Map-Geometrie. Neue Deckung muss
  Bewegung, Treffer, Rauch/Sichtprüfung und Bot-Wege konsistent beeinflussen.
- Online bleibt der Server für Schaden, Munition, Ziele und Spielstände zuständig.
  Schnellere Darstellung darf keine beliebigen Client-Positionen vertrauenswürdig machen.
- Der Party-Hub-Controller bleibt leichtgewichtig: Die Handys brauchen für diesen
  Modus keine 3D-Berechnung und keine zusätzliche App.
- Ein Touch-Abbruch, Fokusverlust oder Verbindungsabbruch darf keine gehaltene
  Bewegungs-/Feueraktion dauerhaft aktiv lassen.
- Die bestehenden Spiele bleiben Teil der Regressionstests. Am gemeinsamen
  Nachrichtenprotokoll nur ändern, was eine konkrete Spielanforderung braucht.
- Jede neue Mechanik bekommt gezielte Regeln für Tod, Rundenwechsel, Revanche und
  Verbindungsabbruch. Besonders wichtig bei Wiederbelebung und Kaufphase.
- Leistung auf eurem echten Laptop messen. Browser-Emulation allein liefert keine
  belastbare Aussage über WLAN-Latenz, Handwärme oder Daumenkomfort.
- Verbesserungen am öffentlichen Internetbetrieb sind getrennt von lokalem Spiel
  zu prüfen; ein lokal bestandener Zwei-Client-Test ist kein Internet-Lasttest.

## 8. Fertigkriterium für die nächste Version

Die nächste Version ist für euch besser, wenn beide nach ungefähr 20 Minuten sagen
können: **„Wir mussten weniger auf die Bedienung achten und wollten weiterzocken.“**
Zusätzlich müssen die konkret ausgewählten Erfolgskriterien oben bestanden sein,
es darf kein offener P0-Fehler existieren, und mindestens eine vollständige Runde
muss erneut auf euren beiden tatsächlichen Handys und dem Laptop gespielt worden sein.

Die technische Basis und Startanleitung stehen in [BREACH.md](BREACH.md).
