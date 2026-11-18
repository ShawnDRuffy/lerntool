# KaTeX 0.19.1 – lokal vorhanden

Stand: 2026-11-18. Enthalten sind `katex.min.js`, `katex.min.css`, `LICENSE` (MIT) und alle 60 Schriftdateien aus dem Release. Die 63 Dateien wurden aus `teil-t6-claude/arbeit/t5/web/katex/` übernommen; t6 hatte sie mit `katex-holen.ps1` geladen. Alle Dateien stimmen per SHA-256 mit t6 überein; Nachweis: `../../tests/katex-kopie-sha256.json`.

JS und CSS wurden erneut gegen die festen SHA-384-Werte der offiziellen Browser-Anleitung geprüft (Abruf 2026-11-18). `../../testlauf.txt` belegt Rendering und lokale Schriftabrufe in Chrome bei 320, 390 und 1280 Pixeln. Keine CDN-Nachladung. Safari auf einem echten iPhone ist noch ungetestet.

Offizielle Quelle: https://github.com/KaTeX/KaTeX/releases/download/v0.19.1/katex.zip · Prüfsummen: https://katex.org/docs/browser. Der gescheiterte Downloadversuch vom 2026-11-17 bleibt unter `../../tests/katex-download.txt` als Verlauf erhalten. Simon muss nichts installieren.
