import type { Locale } from "../i18n";

/**
 * Ton der Anleitung: Sprache fuer die Bedeutung, Toene fuer den Takt.
 *
 * Both are needed. Two of the twelve positions close the eyes, so the screen
 * cannot carry the guidance alone; and speech takes an unpredictable amount of
 * time, so it cannot carry the timing. Speech names the movement, tones mark
 * the seconds.
 *
 * Speech uses on-device voices only. The remote voices some browsers offer
 * synthesise on a server, which would break the promise that nothing leaves
 * the device after loading. Without a local voice the page falls back to tones
 * and text.
 */

export type Tone = "go" | "release" | "next" | "done" | "warn";

export interface VoiceInfo {
  available: boolean;
  name: string | null;
  lang: string | null;
  localService: boolean;
}

const TONES: Record<Tone, { freq: number[]; stepMs: number }> = {
  go: { freq: [880], stepMs: 0 },
  release: { freq: [440], stepMs: 0 },
  next: { freq: [660, 660], stepMs: 170 },
  done: { freq: [523, 659, 784], stepMs: 150 },
  // Tief und doppelt, damit die Warnung nicht mit dem Takt zu verwechseln ist.
  warn: { freq: [300, 300], stepMs: 200 },
};

const TONE_MS = 120;

/**
 * Stimmenliste frueh anwaermen.
 *
 * `getVoices()` ist beim ersten Aufruf haeufig leer und fuellt sich erst mit
 * `voiceschanged` - wer die Liste erst im Klick-Handler abfragt, findet nichts
 * und faellt stillschweigend auf reine Toene zurueck (so geschehen, Firefox
 * unter Windows, gemessen 2026-08-29). Deshalb wird sie beim Laden der Seite
 * angestossen und danach nachgefuehrt.
 */
let cachedVoices: SpeechSynthesisVoice[] = [];

function refreshVoices(): void {
  if (typeof speechSynthesis === "undefined") return;
  const list = speechSynthesis.getVoices();
  if (list.length > 0) cachedVoices = list;
}

if (typeof speechSynthesis !== "undefined") {
  refreshVoices();
  speechSynthesis.addEventListener("voiceschanged", refreshVoices);
}

/**
 * Laufende Aeusserung festhalten.
 *
 * Firefox sammelt eine nur lokal referenzierte `SpeechSynthesisUtterance`
 * mitunter ein, bevor sie zu Ende gesprochen ist - dann bleibt `end` aus. Eine
 * Referenz ausserhalb der Funktion verhindert das.
 */
let speaking: SpeechSynthesisUtterance | null = null;

export class Voice {
  private ctx: AudioContext | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private speech: SpeechSynthesis | null = null;
  private readonly lang: string;

  private constructor(locale: Locale) {
    this.lang = locale === "de" ? "de-DE" : "en-US";
  }

  /**
   * Muss synchron aus einer Nutzergeste heraus laufen: iOS gibt weder
   * AudioContext noch Sprachausgabe ausserhalb einer Geste frei, und ein
   * `await` davor verbraucht sie.
   */
  static unlock(locale: Locale): Voice {
    const v = new Voice(locale);

    try {
      const Ctor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        v.ctx = new Ctor();
        void v.ctx.resume().catch(() => undefined);
      }
    } catch {
      v.ctx = null;
    }

    if (typeof speechSynthesis !== "undefined") {
      v.speech = speechSynthesis;
      v.pickVoice();
      // Erstes `speak()` in der Geste: iOS wertet es als Freischaltung.
      if (v.voice) {
        // Kurzer echter Laut statt eines Leerzeichens: eine leere Aeusserung
        // beendet sich auf manchen Engines nie und blockiert die Schlange.
        const warmup = new SpeechSynthesisUtterance(".");
        warmup.voice = v.voice;
        warmup.volume = 0;
        try {
          v.speech.speak(warmup);
        } catch {
          // Freischaltung fehlgeschlagen - dann bleibt es bei Toenen.
        }
      }
    }
    return v;
  }

  /**
   * Welche Stimme diese Sprache bekaeme - ohne etwas freizuschalten.
   *
   * Damit laesst sich vor der Aufnahme anzeigen, ob gesprochen wird. Sonst
   * merkt man erst hinterher am Manifest, dass hundert Sekunden lang nur
   * Toene liefen.
   */
  static describe(locale: Locale): VoiceInfo {
    const probe = new Voice(locale);
    probe.speech = typeof speechSynthesis === "undefined" ? null : speechSynthesis;
    probe.pickVoice();
    return probe.info;
  }

  get info(): VoiceInfo {
    return {
      available: this.voice !== null,
      name: this.voice?.name ?? null,
      lang: this.voice?.lang ?? null,
      localService: this.voice?.localService ?? false,
    };
  }

  /** Kurzer Piep. Nicht abwarten - der Takt haengt an der eigenen Uhr. */
  tone(kind: Tone): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const spec = TONES[kind];
    spec.freq.forEach((freq, i) => {
      const at = ctx.currentTime + (i * spec.stepMs) / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // Anstieg und Abfall gegen das Knacken harter Kanten.
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.25, at + 0.008);
      gain.gain.linearRampToValueAtTime(0, at + TONE_MS / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + TONE_MS / 1000 + 0.02);
    });
  }

  /**
   * Loest auf, wenn die Ansage zu Ende ist.
   *
   * Drei Wege, weil das `end`-Ereignis nicht ueberall verlaesslich kommt: das
   * Ereignis selbst, ein Blick auf `speaking` (schlaegt an, sobald die Engine
   * fertig ist, auch ohne Ereignis) und zuletzt ein Wachhund. Der Wachhund
   * richtet sich nach der Textlaenge - ein fester Wert von acht Sekunden hat
   * jede Ansage auf acht Sekunden gedehnt (gemessen 2026-08-29).
   */
  speak(text: string): Promise<void> {
    const speech = this.speech;
    const voice = this.voice;
    if (!speech || !voice) return Promise.resolve();

    return new Promise<void>((resolve) => {
      // Nur raeumen, wenn wirklich eine eigene Ansage aussteht - sonst steht
      // die neue hinter einer haengenden in der Warteschlange.
      //
      // Vorsichtsmassnahme, keine belegte Ursache: das `cancel()` vor der
      // ersten Ansage traf die Warmlauf-Aeusserung aus `unlock()` und damit
      // eine gerade anlaufende Engine. Im warmen Zustand ist das nachweislich
      // harmlos (gemessen 2026-08-29), im kalten liess es sich nicht pruefen -
      // und gebraucht wird es dort ohnehin nicht.
      if (speaking) {
        try {
          speech.cancel();
        } catch {
          // Nichts zu retten.
        }
      }

      const utter = new SpeechSynthesisUtterance(text);
      utter.voice = voice;
      utter.lang = voice.lang;
      // Leicht ueber Normal: die Systemstimmen lesen behaebig, und die Ansage
      // steht ohnehin auch auf dem Bildschirm.
      utter.rate = 1.1;
      speaking = utter;

      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(timer);
        if (speaking === utter) speaking = null;
        resolve();
      };

      /*
       * Notbremse, kein Taktgeber.
       *
       * Sie darf nur greifen, wenn `end` und die Zustandsabfrage beide
       * ausbleiben - deshalb grosszuegig. Ein knappes Budget schneidet sonst
       * die Ansage ab: gemessen wurden bis zu 120 ms je Zeichen (erste
       * Aeusserung nach dem Laden, danach rund 72 ms), ein Budget von 110 ms
       * je Zeichen kappte genau dort (2026-08-29).
       */
      const budget = Math.min(20_000, Math.max(4000, text.length * 250));
      const timer = setTimeout(done, budget);

      /*
       * Die Zustandsabfrage darf erst zaehlen, wenn die Engine begonnen hat.
       *
       * Vor dem ersten Wort steht `speaking` auf false - die Abfrage erklaerte
       * die Ansage dann fuer beendet, bevor sie lief. Genau so verschwand die
       * erste Ansage einer Sitzung: eine feste Anlaufzeit von 400 ms, Ticks
       * alle 150 ms, aufgeloest beim Tick auf 450 - gemessen wurden 485 ms fuer
       * einen Text von sechs Sekunden (2026-08-29). Warm beginnt dieselbe
       * Engine nach 16 bis 32 ms; kalt braucht sie erkennbar laenger.
       *
       * `start` sagt es genau, statt es zu raten. Die zweite Bedingung faengt
       * den anderen Fall ab: eine Aeusserung, die gar nicht erst in die
       * Warteschlange kam. Dann meldet die Engine weder `speaking` noch
       * `pending` - und ohne diesen Ausgang stuende die Sitzung bis zum
       * Wachhund, also deutlich laenger als die verlorene Ansage gedauert
       * haette. Die Frist ist grosszuegig, weil sie nur diesen Fall trennen
       * muss und nicht mehr das Ende der Sprache.
       */
      const DROPPED_AFTER_MS = 2500;
      let begun = false;
      utter.addEventListener("start", () => {
        begun = true;
      });
      const queuedAt = performance.now();
      const poll = setInterval(() => {
        if (!begun && performance.now() - queuedAt < DROPPED_AFTER_MS) return;
        if (!speech.speaking && !speech.pending) done();
      }, 150);

      utter.addEventListener("end", done);
      utter.addEventListener("error", done);
      try {
        speech.speak(utter);
      } catch {
        done();
      }
    });
  }

  cancel(): void {
    try {
      this.speech?.cancel();
    } catch {
      // Nichts zu retten.
    }
  }

  close(): void {
    this.cancel();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private pickVoice(): void {
    if (!this.speech) return;
    refreshVoices();
    const all = cachedVoices;
    const base = this.lang.slice(0, 2);
    // Nur geraeteeigene Stimmen - siehe Kopf der Datei.
    const local = all.filter((v) => v.localService);
    this.voice =
      local.find((v) => v.lang.replace("_", "-") === this.lang) ??
      local.find((v) => v.lang.slice(0, 2) === base) ??
      null;
  }
}
