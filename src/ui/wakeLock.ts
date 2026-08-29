/**
 * Bildschirmsperre.
 *
 * Without it the screen light is gone after the usual timeout - exactly when
 * the person holds still and touches nothing.
 */

interface WakeLockLike {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

let held: WakeLockLike | null = null;

export async function setWakeLock(wanted: boolean): Promise<void> {
  const api = (
    navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockLike> } }
  ).wakeLock;
  if (!api) return;

  if (wanted && !held) {
    try {
      held = await api.request("screen");
      held.addEventListener("release", () => {
        held = null;
      });
    } catch {
      // No reason to fail the recording over this.
    }
  } else if (!wanted && held) {
    const lock = held;
    held = null;
    void lock.release().catch(() => undefined);
  }
}

/**
 * The lock is dropped when the tab goes to the background - reacquire on
 * return. `wanted()` is asked again, because the state may have moved on.
 */
export function watchVisibility(wanted: () => boolean): void {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void setWakeLock(wanted());
  });
}
