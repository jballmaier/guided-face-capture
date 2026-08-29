import type { Dictionary } from "./en";

/**
 * German.
 *
 * `Dictionary` comes from the English file: a missing or surplus key is a
 * compile error rather than an untranslated string somebody runs into.
 */
export const de: Dictionary = {
  // ----------------------------------------------------------------- Frame
  "app.title": "Gesichtsaufnahme",
  "app.tag": "Prototyp",
  "app.note": "Alles bleibt auf diesem Gerät. Keine Übertragung, kein Server.",
  "app.language": "Sprache",

  // -------------------------------------------------------------- View options
  "view.mesh": "Netz",
  "view.mesh.points": "Punkte",
  "view.mesh.wire": "Punkte + Netz",
  "view.mesh.off": "aus",
  "view.anon": "Anonym",
  "view.anon.title":
    "Blendet nur die Anzeige aus. Video und Standbilder werden unverändert aufgezeichnet.",
  "view.light": "Bildschirmlicht",
  "view.light.title":
    "Macht den Bildschirm hell, damit er das Gesicht ausleuchtet. Verhindert außerdem, dass der Bildschirm abdunkelt.",

  // ----------------------------------------------------------- Side markers
  "side.left": "L",
  "side.right": "R",

  // ------------------------------------------------------------------ Stage
  "stage.empty": "Kamera ist noch nicht gestartet.",
  "stage.anonBadge": "Anonyme Anzeige — Aufnahme läuft unverändert weiter",
  "stage.tunedBadge": "Schwellen verändert — keine protokollkonforme Aufnahme",
  "stage.step": "Position {number} von {count}",
  "stage.soon": "Gleich: {instruction}",
  "stage.captured": "ausgelöst, „Weiter“ wenn bereit",
  "stage.wouldTrigger": "würde jetzt auslösen (Dev-Modus)",

  // ---------------------------------------------------------------- Review
  "review.title": "Aufnahmen prüfen",
  "review.summary": "{captured} von {total} Positionen aufgenommen.",
  "review.none": "keine Aufnahme",
  "review.hidden": "Aufnahme vorhanden (anonyme Anzeige)",
  "review.redo": "Wiederholen",
  "review.note": "Einzelne Positionen lassen sich wiederholen – die Aufzeichnung läuft weiter.",
  "review.auto": "automatisch",
  "review.manual": "manuell",
  "review.timeout": "Zeitablauf",

  // ----------------------------------------------------------------- Tabs
  "tab.positions": "Positionen",
  "tab.debug": "Messwerte",
  "tab.tuning": "Schwellen",
  "poslist.jump": "Zu dieser Position springen – die Aufzeichnung läuft weiter",

  // --------------------------------------------------------------- Thresholds
  "tuning.note":
    "Auslöseschwellen je Position, direkt am Gerät einstellbar. Die Werte gelten sofort — bei der laufenden Position beginnt das Haltefenster von vorn. Der Code bleibt die Quelle: Was hier eingestellt wird, gilt für dieses Gerät und diese Sitzung. Der Weg zurück in positions.ts führt über „Als Text kopieren“.",
  "tuning.copy": "Als Text kopieren",
  "tuning.resetAll": "Alle zurücksetzen",
  "tuning.reset": "zurück",
  "tuning.reset.title": "Auf die Werte aus positions.ts zurücksetzen",
  "tuning.default": "Vorgabe: {value}",
  "tuning.minDrive": "Auslenkung ab",
  "tuning.maxSuppress": "Störbewegung bis",
  "tuning.holdMs": "Halten (ms)",
  "tuning.copied": "Schwellen in die Zwischenablage kopiert",
  "tuning.copyFailed": "Zwischenablage nicht verfügbar — Werte stehen in der Konsole",
  "tuning.resetDone": "Schwellen auf die Werte aus dem Code zurückgesetzt",
  "tuning.codeHeader": "Kalibrierte Auslöseschwellen, in positions.ts zu übernehmen",
  "tuning.codeDevice": "Gerät: {agent}",
  "tuning.codeTime": "Zeitpunkt: {time}",
  "tuning.codeNone": "Keine Schwelle verändert — die Werte aus positions.ts gelten unverändert.",

  // --------------------------------------------------------------- Measurements
  "debug.drive": "Auslenkung",
  "debug.noPosition": "– keine Position aktiv",
  "debug.sequenceDone": "– Sequenz beendet",
  "debug.suppress": "Störbewegung",
  "debug.threshold": "Schwelle",
  "debug.sideCompare": "Seitenvergleich",
  "debug.noSideMeasure": "Für diese Position ist keine seitengetrennte Größe definiert.",
  "debug.sideNote":
    "„Left“/„Right“ folgen der MediaPipe-Konvention und meinen die Seite der aufgenommenen Person. Das gehört auf die Prüfliste – zusammen mit dem Spiegelungstest.",
  "debug.readout": "Messwerte",
  "debug.blendshapes": "Blendshapes",
  "debug.blendshapesMost": "(aktivste)",
  "debug.analysis": "Analyse",
  "debug.faces": "Gesichter",
  "debug.sharpness": "Schärfe",
  "debug.luminance": "Helligkeit",
  "debug.clipping": "Clipping",
  "debug.clippingDark": "Schwarzanteil",
  "debug.interocular": "Augenabstand",
  "debug.interlabial": "Lippenspalt",
  "debug.position": "Position",
  "debug.eyeOpening": "Lidspalte (gemessen)",
  "debug.philtrum": "Filtrum–Mundwinkel (gemessen)",

  // ------------------------------------------------------------------ Camera
  "camera.heading": "Kamera",
  "camera.note":
    "Was der Videostrom liefert, gegen das, was das Gerät anbietet. Der Fotopfad ist nicht überall zugänglich – fehlt er, steht der Grund dort.",
  "camera.none": "keine geöffnet",
  "camera.source": "Quelle",
  "camera.delivered": "Geliefert",
  "camera.resize": "Skalierung",
  "camera.videoOffers": "Videopfad bietet",
  "camera.videoUnknown": "keine Auskunft (getCapabilities fehlt)",
  "camera.photoOffers": "Fotopfad bietet",
  "camera.photoNoSize": "vorhanden, ohne Größenangabe",
  "camera.photoLabel": "Fotopfad",
  "camera.photoMissing": "nicht verfügbar",

  // --------------------------------------------------------------- Controls
  "btn.start": "Kamera starten",
  "btn.switch": "Kamera wechseln",
  "btn.run": "Aufnahme starten",
  "btn.shutter": "Jetzt auslösen",
  "btn.next": "Weiter",
  "btn.skip": "Überspringen",
  "btn.export": "Als ZIP speichern",
  "flow.auto": "Automatisch weiter",
  "flow.auto.title":
    "Bei Auslösung oder Zeitablauf automatisch zur nächsten Position. Aus: Die Sequenz bleibt auf jeder Position stehen, bis „Weiter“ gedrückt wird – Raum, die Schwellen am laufenden Signal einzustellen.",
  "flow.dev": "Dev-Modus",
  "flow.dev.title":
    "Kalibriermodus: Die Sequenz bleibt auf jeder Position stehen, und der Auslöser wird nur angezeigt, löst aber nie aus – beim Schwellenjustieren sehen, wann er greifen würde. Läufe sind im Manifest markiert.",
  "field.camera": "Kamera",
  "field.file": "Videodatei",
  "field.file.title":
    "Entwicklungshilfe: dieselbe Erkennungskette gegen eine Datei laufen lassen, reproduzierbar und ohne Kamera",

  // ------------------------------------------------------------- Status line
  "status.ready": "bereit – {count} Positionen",
  "status.loadingModel": "Modell wird geladen …",
  "status.openingCamera": "Kamera wird geöffnet …",
  "status.cameraOpen": "{width}×{height} @ {fps} fps – {label}",
  "status.file": "Datei: {name} – Aufzeichnung möglich",
  "status.recording": "Aufzeichnung läuft",
  "status.noSource": "Keine aufzeichenbare Quelle – Sequenz nicht startbar",
  "status.finishing": "Aufzeichnung wird abgeschlossen …",
  "status.packing": "Paket wird geschnürt …",
  "status.saved": "Gespeichert: {total} MB gesamt, davon {video} MB Video ({seconds} s)",
  "status.cropSaving":
    "ein Gesichts-Zuschnitt hätte {percent} % der Standbilder gespart ({full} → {cropped} MB)",
  "status.repeat": "Wiederholung",
  "status.error": "Fehler: {message}",

  // ---------------------------------------------------------------- Hints
  "issue.no-face": "Kein Gesicht erkannt",
  "issue.multiple-faces": "Mehr als ein Gesicht im Bild",
  "issue.too-far": "Bitte näher an die Kamera",
  "issue.off-center": "Gesicht mittig ausrichten",
  "issue.too-dark": "Zu dunkel – mehr Licht von vorn",
  "issue.too-bright": "Zu hell",
  "issue.overexposed": "Überstrahlt – Licht nicht von hinten",
  "issue.blurry": "Unscharf – bitte still halten",
  "issue.head-tilted": "Kopf gerade halten, direkt in die Kamera",

  // ------------------------------------------------------------------ Errors
  "error.noVideoTrack": "Kamera lieferte keine Videospur",
  "error.streamFailed": "Videostream konnte nicht geladen werden",
  "error.noStillContext": "2D-Kontext für die Standbildaufnahme nicht verfügbar",
  "error.noQualityContext": "2D-Kontext für die Qualitätsmessung nicht verfügbar",
  "error.stillEncode": "Standbild konnte nicht kodiert werden",
  "error.noFrameYet": "Videoelement liefert noch keine Bilddaten",
  "error.recorderRunning": "Aufzeichnung läuft bereits",
  "error.recorderIdle": "Es läuft keine Aufzeichnung",
  "error.recorderUnsupported": "Dieser Browser unterstützt keine Videoaufzeichnung",
  "error.recorderStart": "Videoaufzeichnung konnte nicht gestartet werden",

  // --------------------------------------------------------------- Positions
  "position.neutral.label": "Gesicht in Ruhe",
  "position.neutral.instruction": "Gesicht entspannen. Nicht lächeln, nicht sprechen.",
  "position.forehead_wrinkle.label": "Stirn runzeln",
  "position.forehead_wrinkle.instruction":
    "Augenbrauen hochziehen, bis sich die Stirn in Falten legt.",
  "position.eye_closure_gentle.label": "Sanfter Augenschluss",
  "position.eye_closure_gentle.instruction":
    "Augen locker schließen, wie beim Einschlafen. Nicht zukneifen.",
  "position.eye_closure_forced.label": "Fester Augenschluss",
  "position.eye_closure_forced.instruction": "Augen fest zukneifen, so kräftig wie möglich.",
  "position.nose_wrinkle.label": "Nase rümpfen",
  "position.nose_wrinkle.instruction": "Nase rümpfen, als röche es unangenehm.",
  "position.smile_closed.label": "Lächeln mit geschlossenem Mund",
  "position.smile_closed.instruction":
    "Lächeln, ohne die Zähne zu zeigen. Lippen bleiben geschlossen.",
  "position.smile_teeth.label": "Lächeln mit Zähne zeigen",
  "position.smile_teeth.instruction": "Breit lächeln, sodass die Zähne zu sehen sind.",
  "position.lip_pucker.label": "Mund spitzen",
  "position.lip_pucker.instruction": "Lippen spitzen, als wollten Sie pfeifen.",
  "position.cheek_puff.label": "Wangen aufblasen",
  "position.cheek_puff.instruction": "Beide Wangen aufblasen und den Mund geschlossen halten.",
  "position.teeth_bared.label": "Zähne fletschen",
  "position.teeth_bared.instruction":
    "Lippen auseinanderziehen, sodass obere und untere Zähne zu sehen sind.",
  "position.mouth_corners_down.label": "Mundwinkel nach unten ziehen",
  "position.mouth_corners_down.instruction":
    "Mundwinkel nach unten ziehen, wie bei einem traurigen Gesicht.",
  "position.smile_natural.label": "Natürliches Lächeln",
  "position.smile_natural.instruction": "Lächeln Sie, wie Sie es sonst auch tun. Nichts Gestelltes.",

  // ---------------------------------------------------------- ZIP read-me
  "bundle.title": "Gesichtsaufnahme nach dem 12-Foto-Schema",
  "bundle.recorded": "Aufgenommen: {time}",
  "bundle.duration": "Dauer: {seconds} s",
  "bundle.contents": "Inhalt",
  "bundle.manifest": "manifest.json — Bedingungen, Messwerte und Schwellen dieser Sitzung",
  "bundle.video": "{file} — Video der gesamten Sequenz",
  "bundle.stills": "stills/ — je Position ein Bild in voller Kameraauflösung",
  "bundle.sides": "Hinweis zur Seitenzuordnung",
  "bundle.mirrorField":
    "Ob beim Speichern gespiegelt wurde, steht in manifest.json unter capture.mirrorApplied.",
  "bundle.prototype": "Prototyp - nicht fuer die Verwendung mit Patientendaten.",
  "bundle.mirrorNote":
    "Die Standbilder sind NICHT gespiegelt: Links und rechts sind die Seite der aufgenommenen Person.",
};
