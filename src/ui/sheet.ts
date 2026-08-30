/**
 * Einstellungs-Blatt.
 *
 * Alles Konfigurierende wandert aus der Fussleiste in einen Dialog: waehrend
 * einer Sitzung sind diese Regler ohnehin gesperrt, und auf einem Smartphone
 * hat die Dauerleiste sonst mehr Hoehe als die Buehne (gemessen 2026-08-30:
 * 50 px Buehne auf 375x812). Die Felder behalten ihre IDs - die Seitenlogik
 * merkt nicht, wo sie stehen.
 */
export function initSettingsSheet(
  button: HTMLButtonElement,
  dialog: HTMLDialogElement,
  closeButton: HTMLButtonElement,
): void {
  button.addEventListener("click", () => dialog.showModal());
  closeButton.addEventListener("click", () => dialog.close());

  // Klick auf den Hintergrund schliesst. Der Dialog selbst ist das Ziel nur,
  // wenn der Klick neben dem Inhalt landet - dem ::backdrop gehoert kein
  // eigenes Ereignis.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}
