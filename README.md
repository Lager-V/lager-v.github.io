# San-Lager DLRG

Lagerbestand für den San-Bereich: Verbrauch per QR-Code buchen, Bestand in Lager und Rucksäcken, Nachbestellliste, Verbrauch nach Jahreszeit.

- Läuft über GitHub Pages, Daten in einer Firebase Realtime Database (Pfad `sanlager`).
- Buchen geht für alle ohne Anmeldung. Die Verwaltung (Artikel, Bestückung, Etiketten) kann mit einer PIN gesperrt werden.
- Beim ersten Start wird die Materialliste automatisch angelegt. Alle Bestände stehen auf 0, deshalb einmal Inventur im Lager und in jedem Rucksack machen.

## Firebase einrichten

1. https://console.firebase.google.com → Projekt anlegen (Google Analytics nicht nötig).
2. Build → Realtime Database → Datenbank erstellen → Standort Belgien (europe-west1) → im gesperrten Modus starten.
3. Reiter „Regeln“, ersetzen durch:

```json
{
  "rules": {
    "sanlager": { ".read": true, ".write": true }
  }
}
```

4. Die Datenbank-Adresse (z. B. `https://projektname-default-rtdb.europe-west1.firebasedatabase.app`) in `index.html` bei `DB_URL` eintragen.

## Sicherheit

Wer die Adresse der Seite kennt, kann lesen und buchen. Die PIN schützt die Verwaltung nur in der Oberfläche; technisch Versierte könnten die Datenbank trotzdem direkt ändern. Keine Patientendaten eintragen.
