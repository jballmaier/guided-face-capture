/**
 * Hell oder dunkel.
 *
 * Die Vorgabe kommt vom System - wer den Rechner auf hell gestellt hat, will
 * die Seite selten dunkel. Der Schalter oben rechts hat trotzdem Vorrang und
 * bleibt erhalten: Auf dem Smartphone ist die helle Ansicht kein Geschmack,
 * sondern die Lichtquelle fuer das Gesicht, und die will man nicht bei jedem
 * Laden neu einschalten.
 *
 * Solange nichts von Hand gewaehlt wurde, folgt die Seite dem System auch
 * waehrend sie offen ist.
 */

export type Theme = "light" | "dark";

const STORAGE_KEY = "guided-face-capture.theme";

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    // Ohne Speicher gilt eben das System.
    return null;
  }
}

function remember(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Die Wahl gilt dann nur fuer diese Sitzung.
  }
}

export function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export interface ThemeControl {
  isLight(): boolean;
}

/**
 * Verbindet den Schalter mit der Seite.
 *
 * `onChange` bekommt jeden Wechsel - die Hauptseite braucht ihn fuer die
 * Bildschirmsperre und fuer die Farben des Overlays, die nicht ueber CSS
 * laufen.
 */
export function initTheme(
  toggle: HTMLInputElement,
  onChange: (light: boolean) => void,
): ThemeControl {
  let light = (stored() ?? systemTheme()) === "light";

  const apply = (): void => {
    document.body.classList.toggle("lightmode", light);
    // Ausdruecklich setzen: Browser stellen den Haken beim Neuladen von sich
    // aus wieder her, und dann zeigte der Schalter etwas anderes an als die
    // Seite tat.
    toggle.checked = light;
    onChange(light);
  };

  toggle.addEventListener("change", () => {
    light = toggle.checked;
    remember(light ? "light" : "dark");
    apply();
  });

  // Systemwechsel nur uebernehmen, solange nichts von Hand gewaehlt wurde.
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener("change", (event) => {
    if (stored() !== null) return;
    light = event.matches;
    apply();
  });

  apply();
  return { isLight: () => light };
}
