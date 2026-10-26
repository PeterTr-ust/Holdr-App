<p align="center">
  <img src="docs/images/logo.png" width="96" height="96" alt="Holdr-Logo">
</p>

<h1 align="center">Holdr</h1>

<p align="center">
  <strong>Dein Depot. Auf deinem Rechner.</strong><br>
  Private Übersicht über Aktien und ETFs für Windows und macOS – ohne Konto, ohne Cloud, ohne Telemetrie.
</p>

<p align="center">
  <a href="../../releases/latest"><strong>Download</strong></a> ·
  <a href="#funktionen">Funktionen</a> ·
  <a href="#datenschutz">Datenschutz</a> ·
  <a href="README.md">English</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/overview-dark.png">
    <img src="docs/images/overview-light.png" width="860" alt="Holdr-Übersicht mit Gesamtvermögen, Wertverlauf und Positionen (Beispieldaten)">
  </picture>
</p>

## Funktionen

- **Vermögen auf einen Blick** – Gesamtwert, Ergebnis seit Kauf, heutige Veränderung und Wertverlauf von 1 Monat bis 5 Jahre.
- **Käufe, Verkäufe, Dividenden und Splits** – beliebig viele Buchungen pro Aktie, Gebühren und Steuern getrennt, auch Bruchstücke.
- **Dividenden und Splits werden erkannt** – Holdr findet Ausschüttungen und Splits deiner Aktien, die noch nicht gebucht sind; du prüfst sie und übernimmst sie mit einem Klick.
- **Ehrliche Statistik** – realisierte Gewinne und Verluste (FIFO), Dividenden, Gebühren und Steuern, gesamt, pro Jahr und pro Position.
- **Wie breit bin ich gestreut?** – dein Depot nach Branche und Land; ETFs werden nach ihren Branchenanteilen aufgeteilt.
- **Nächste Termine** – nächster Ex-Tag, Zahltag und Quartalszahlen für jede Position.
- **Merkliste** – Aktien beobachten, die du noch nicht besitzt, mit Entwicklung seit der Aufnahme.
- **Aktien und ETFs weltweit** – Suche nach Name, Kürzel oder ISIN, z. B. XETRA, Wiener Börse, NASDAQ oder NYSE.
- **Euro oder US-Dollar** – andere Währungen werden automatisch umgerechnet.
- **Backup mit einem Klick** – alle Daten in eine Datei sichern und wieder einspielen, auch zwischen Windows und Mac.
- **Funktioniert offline** – zeigt die zuletzt geladenen Kurse; hell und dunkel; Deutsch und Englisch.

<table>
  <tr>
    <td width="33%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/position-dark.png">
        <img src="docs/images/position-light.png" alt="Position mit Kennzahlen, Kursverlauf und Buchungen">
      </picture>
      <p align="center"><sub>Positionsdetail</sub></p>
    </td>
    <td width="33%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/statistics-dark.png">
        <img src="docs/images/statistics-light.png" alt="Statistik mit Gewinnen, Verlusten, Dividenden, Gebühren und Steuern">
      </picture>
      <p align="center"><sub>Statistik</sub></p>
    </td>
    <td width="33%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/watchlist-dark.png">
        <img src="docs/images/watchlist-light.png" alt="Merkliste mit Kurs, Tagesveränderung und Entwicklung seit Aufnahme">
      </picture>
      <p align="center"><sub>Merkliste</sub></p>
    </td>
  </tr>
</table>

<sub>Alle Screenshots zeigen erfundene Beispieldaten. Die Bilder zeigen die englische Oberfläche; Holdr gibt es auch auf Deutsch.</sub>

## Download

Die aktuelle Version gibt es auf der **[Release-Seite](../../releases/latest)**:

| System | Datei | Voraussetzung |
| --- | --- | --- |
| Windows | `Holdr-Windows-Setup.exe` (oder `Holdr-Windows.msi`) | Windows 10 oder 11, 64 Bit |
| macOS | `Holdr-macOS.dmg` (Apple Silicon und Intel) | macOS 11 Big Sur oder neuer |

Holdr ist noch nicht signiert, deshalb warnt dein System beim ersten Start:

- **Windows:** Bei „Der Computer wurde durch Windows geschützt“ auf **Weitere Informationen → Trotzdem ausführen** klicken.
- **macOS:** Rechtsklick auf Holdr im Ordner „Programme“ → **Öffnen → Öffnen**, oder unter
  Systemeinstellungen → Datenschutz & Sicherheit → **Dennoch öffnen**.

## Datenschutz

Holdr ist so gebaut, dass deine Finanzdaten bei dir bleiben.

- Positionen, Buchungen, Merkliste und Einstellungen liegen **nur auf deinem Rechner** in einer
  SQLite-Datei. Es gibt kein Konto, keinen Server und keine Telemetrie.
- Für Kurse, Dividenden, Splits, Branchen und Termine fragt Holdr Daten bei **Yahoo Finance** ab.
  Übertragen werden nur deine Suchbegriffe und die Börsenkürzel deiner Positionen, Merkliste und der
  nötigen Wechselkurse – nie Stückzahlen, Kaufkurse oder Beträge. Wie bei jedem Abruf im Internet sieht
  Yahoo dabei deine IP-Adresse. Für Branchen und Termine verlangt Yahoo ein Sitzungs-Cookie; Holdr hält
  es nur im Arbeitsspeicher und verwirft es beim Beenden.
- Unter Windows nutzt Holdr die WebView2-Laufzeit von Microsoft zur Darstellung; ob diese Diagnosedaten
  an Microsoft sendet, hängt von deinen Windows-Einstellungen ab.

**Wo liegen meine Daten?** Windows: `%APPDATA%\app.holdr.desktop\holdr.db` ·
macOS: `~/Library/Application Support/app.holdr.desktop/holdr.db`.
Unter **Einstellungen → Datensicherung** speicherst du eine Kopie oder ziehst auf einen anderen Rechner um.

## Gut zu wissen

- Realisierte Gewinne werden nach der **FIFO-Methode** berechnet. Steuerlich gelten je nach Land andere
  Regeln (in Österreich z. B. der gleitende Durchschnittspreis); maßgeblich sind die Abrechnungen deiner Bank.
- Fremdwährungen werden zum aktuellen Wechselkurs umgerechnet.
- Kurse können je nach Börse etwa 15 Minuten verzögert sein.
- Holdr ist ein Werkzeug für deine eigene Übersicht und **keine Anlageberatung**.

## Selbst bauen

Du brauchst Node.js 22+, Rust und die [Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/).

```bash
cd app
npm ci
npm run desktop:dev            # App starten
npm run desktop:build:windows  # oder desktop:build:mac
```

Beiträge sind willkommen.

## Über Holdr

Holdr wurde mit Unterstützung von [Claude](https://claude.com) entwickelt, einem KI-Assistenten von Anthropic.

## Lizenz

Holdr ist freie Software unter der [GNU General Public License v3.0](LICENSE) und wird ohne jede
Gewährleistung bereitgestellt. Fremdkomponenten und ihre Lizenzen stehen in der App unter
Einstellungen → Open-Source-Lizenzen.

Die Kursdaten stammen von Yahoo Finance, dessen Bedingungen keine kommerzielle Nutzung erlauben. Holdr
wird deshalb ausschließlich kostenlos angeboten.
