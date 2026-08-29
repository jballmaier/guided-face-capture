import type { HeadPose } from "../types";

/**
 * Head pose from MediaPipe's 4x4 transformation matrix (row-major, 16 numbers).
 * Upper-left 3x3 is the rotation; Tait-Bryan angles in XYZ order.
 *
 * Signs are convention and unverified against a camera. Only the magnitude is
 * used for the tolerance check.
 */
export function poseFromMatrix(m: readonly number[]): HeadPose | null {
  if (m.length < 16) return null;

  // Row-major: mRC = m[row * 4 + col]
  const m00 = m[0]!;
  const m10 = m[4]!;
  const m12 = m[6]!;
  const m11 = m[5]!;
  const m20 = m[8]!;
  const m21 = m[9]!;
  const m22 = m[10]!;

  const sy = Math.hypot(m00, m10);
  const singular = sy < 1e-6;

  const x = singular ? Math.atan2(-m12, m11) : Math.atan2(m21, m22);
  const y = Math.atan2(-m20, sy);
  const z = singular ? 0 : Math.atan2(m10, m00);

  const deg = (r: number) => (r * 180) / Math.PI;
  return { pitch: deg(x), yaw: deg(y), roll: deg(z) };
}

/** Alignment tolerances in degrees. Calibration values. */
export const POSE_TOLERANCE = {
  yaw: 7,
  pitch: 7,
  roll: 5,
} as const;

/**
 * Deviation from a reference pose, component-wise.
 *
 * Gating absolutely against the camera axis failed in practice: a camera
 * mounted off eye level puts the resting head near the limit, and expressions
 * tilt the head along - well-performed movements timed out (measured
 * 2026-08-28). Measured against the rest pose, the same tolerances hold.
 */
export function poseDelta(pose: HeadPose, reference: HeadPose): HeadPose {
  return {
    yaw: pose.yaw - reference.yaw,
    pitch: pose.pitch - reference.pitch,
    roll: pose.roll - reference.roll,
  };
}

export function poseWithinTolerance(
  pose: HeadPose,
  tol: { yaw: number; pitch: number; roll: number } = POSE_TOLERANCE,
): boolean {
  return (
    Math.abs(pose.yaw) <= tol.yaw && Math.abs(pose.pitch) <= tol.pitch && Math.abs(pose.roll) <= tol.roll
  );
}
