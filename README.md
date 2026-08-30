# Guided Face Capture

A browser prototype that guides through **twelve standardised facial
expressions**, detects the moment of strongest movement itself, and saves one
still per position at full camera resolution — plus a video of the whole
sequence and a manifest recording the conditions.

**Everything stays on the device.** MediaPipe runs locally, the model and WASM
runtime sit next to the application rather than on a CDN, and no request leaves
the page after load. There is no server.

*(Deutsche Fassung weiter unten.)*

## Start

```bash
npm install && npm run assets && npm run dev
```

`npm run assets` fetches the WASM runtime and the model into `public/mediapipe/`.

For testing on a phone use `npm run dev:lan`, which serves over HTTPS — the
camera is only released in a secure context, and a LAN address does not count as
one without a certificate. Open the `Network:` address shown and accept the
warning.

## The twelve positions

| # | English | Deutsch |
|---|---|---|
| 1 | Face at rest | Gesicht in Ruhe |
| 2 | Wrinkle the forehead | Stirn runzeln |
| 3 | Gentle eye closure | Sanfter Augenschluss |
| 4 | Forced eye closure | Fester Augenschluss |
| 5 | Wrinkle the nose | Nase rümpfen |
| 6 | Smile with the mouth closed | Lächeln mit geschlossenem Mund |
| 7 | Smile showing the teeth | Lächeln mit Zähne zeigen |
| 8 | Purse the lips | Mund spitzen |
| 9 | Puff the cheeks | Wangen aufblasen |
| 10 | Bare the teeth | Zähne fletschen |
| 11 | Pull the mouth corners down | Mundwinkel nach unten ziehen |
| 12 | Natural smile | Natürliches Lächeln |

Trigger thresholds can be adjusted per position in the **Thresholds** tab and
take effect immediately. The code stays the source: “Copy as text” hands the
calibrated values back for `src/protocol/positions.ts`. Sessions recorded with
changed thresholds are marked as such, in the image and in the manifest.

## Sides

The preview is mirrored, the saved image is not. Both carry **L/R markers after
the fashion of a radiograph**, naming the side of the person — so the letters sit
in opposite corners in preview and file. That is correct, not a bug.

## Output

One ZIP: the video, one JPEG per position at full camera resolution, and
`manifest.json` with camera capabilities, head pose, quality figures, the
blendshape vector at the apex and the thresholds each position was measured
under.

The camera is opened at the largest resolution on offer, up to 4096 px on the
long edge. Detection runs on a downscaled copy so the loop keeps up; the stills
come from the full frame.

## Languages

English is the default, German is complete. The switch sits in the settings
sheet and the choice is remembered; the browser language is not consulted. To add a language,
copy `src/i18n/en.ts`, translate, and register it in `src/i18n/index.ts` — every
locale is typed against English, so the compiler names any missing key.

The manifest is language-independent: English labels throughout, with the
session language recorded under `session.locale`.

## Limits

- **Prototype.** The thresholds are calibration values, not validated limits.
- **Blendshapes are trained on unimpaired faces.** What is derived from them is
  an indication, not a measurement.
- **Not a medical device**, and not intended as one.

## Third-party components and licence

Shipped with the page: **MediaPipe Tasks Vision** including WASM runtime and the
face landmark model (Apache 2.0). Details in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md), full texts in
[`licenses/`](licenses/). The build copies both into `dist/`, so they travel
with a self-hosted copy.

Own code: [Apache License 2.0](LICENSE).

---

# Geführte Gesichtsaufnahme

Ein Browser-Prototyp, der durch **zwölf standardisierte Gesichtsausdrücke**
führt, den Moment der stärksten Auslenkung selbst erkennt und je Position ein
Standbild in voller Kameraauflösung sichert — dazu das Video der ganzen Sequenz
und ein Manifest mit den Aufnahmebedingungen.

**Alles bleibt auf dem Gerät.** MediaPipe läuft lokal, Modell und WASM-Laufzeit
liegen neben der Anwendung statt bei einem CDN, nach dem Laden geht keine
Anfrage mehr hinaus. Es gibt keinen Server.

## Start

```bash
npm install && npm run assets && npm run dev
```

Für den Test am Smartphone `npm run dev:lan` — der Unterschied ist HTTPS. Die
Kamera gibt der Browser nur in einem sicheren Kontext frei, und eine LAN-Adresse
gilt ohne Zertifikat nicht als sicher.

## Die zwölf Positionen

Siehe Tabelle oben. Die Auslöseschwellen sind je Position im Reiter *Schwellen*
am Gerät einstellbar und wirken sofort; über „Als Text kopieren" gehen
kalibrierte Werte zurück nach `src/protocol/positions.ts`. Aufnahmen mit
veränderten Schwellen sind im Bild und im Manifest gekennzeichnet.

## Seiten

Die Vorschau ist gespiegelt, das gespeicherte Bild nicht. Beide tragen
**L/R-Marken wie eine Röntgenaufnahme** und benennen die Seite der Person — die
Buchstaben stehen in Vorschau und Datei deshalb in entgegengesetzten Ecken. Das
ist richtig so.

## Ergebnis

Ein ZIP: das Video, je Position ein JPEG in voller Kameraauflösung und
`manifest.json` mit Kamerafähigkeiten, Kopfpose, Qualitätskennzahlen, dem
Blendshape-Vektor im Apex und den Schwellen, unter denen jede Position gemessen
wurde.

Die Kamera wird mit der größten angebotenen Auflösung geöffnet, bis 4096 px
lange Kante. Die Erkennung rechnet auf einer verkleinerten Kopie, die
Standbilder stammen aus dem vollen Bild.

## Sprachen

Englisch ist die Vorgabe, Deutsch vollständig. Umgeschaltet wird im
Einstellungs-Blatt, die Wahl bleibt gespeichert; die Browsersprache wird nicht
ausgewertet. Eine Sprache
dazunehmen: `src/i18n/en.ts` kopieren, übersetzen, in `src/i18n/index.ts`
eintragen.

## Grenzen

- **Prototyp.** Die Schwellwerte sind Kalibrierwerte, keine validierten Grenzen.
- **Blendshapes sind an gesunden Gesichtern trainiert.** Abgeleitetes ist ein
  Hinweis, kein Messwert.
- **Kein Medizinprodukt** und nicht als solches gedacht.
