/**
 * English is the canonical dictionary.
 *
 * Every other locale is typed against this object, so a missing or misspelled
 * key is a compile error rather than a blank label at runtime. English is also
 * the fallback: a locale that cannot be resolved falls back here, never to an
 * empty string.
 *
 * Placeholders are written as `{name}` and filled by `t()`.
 */
export const en = {
  // ------------------------------------------------------------------ Frame
  "app.title": "Face Capture",
  "app.tag": "Prototype",
  "app.note": "Everything stays on this device. No transfer, no server.",
  "app.language": "Language",

  // -------------------------------------------------------------- View options
  "view.mesh": "Mesh",
  "view.mesh.points": "Points",
  "view.mesh.wire": "Points + mesh",
  "view.mesh.off": "off",
  "view.anon": "Anonymous",
  "view.anon.title": "Hides the preview only. Video and stills are recorded unchanged.",
  "view.light": "Screen light",
  "view.light.title":
    "Brightens the screen so it lights the face. Also keeps the display from dimming.",

  // ----------------------------------------------------------- Side markers
  // Single letters, as on a radiograph. They name the side of the person
  // recorded, never the side of the image.
  "side.left": "L",
  "side.right": "R",

  // ------------------------------------------------------------------ Stage
  "stage.empty": "Camera not started yet.",
  "stage.anonBadge": "Anonymous view - recording continues unchanged",
  "stage.tunedBadge": "Thresholds changed - not a protocol-conforming capture",
  "stage.step": "Position {number} of {count}",
  "stage.soon": "Next: {instruction}",

  // ----------------------------------------------------------------- Review
  "review.title": "Check captures",
  "review.summary": "{captured} of {total} positions captured.",
  "review.none": "no capture",
  "review.hidden": "capture present (anonymous view)",
  "review.redo": "Repeat",
  "review.note": "Single positions can be repeated - the recording keeps running.",
  "review.auto": "automatic",
  "review.manual": "manual",
  "review.timeout": "timed out",

  // ------------------------------------------------------------------- Tabs
  "tab.positions": "Positions",
  "tab.debug": "Measurements",
  "tab.tuning": "Thresholds",

  // ------------------------------------------------------------- Thresholds
  "tuning.note":
    "Trigger thresholds per position, adjustable on the device. Values take effect immediately - for the position in progress the hold window starts over. The code stays the source: what you set here applies to this device and this session. The way back into positions.ts is via Copy as text.",
  "tuning.copy": "Copy as text",
  "tuning.resetAll": "Reset all",
  "tuning.reset": "reset",
  "tuning.reset.title": "Back to the values from positions.ts",
  "tuning.default": "Default: {value}",
  "tuning.minDrive": "Movement from",
  "tuning.maxSuppress": "Interfering up to",
  "tuning.holdMs": "Hold (ms)",
  "tuning.copied": "Thresholds copied to the clipboard",
  "tuning.copyFailed": "Clipboard unavailable - values are in the console",
  "tuning.resetDone": "Thresholds reset to the values from the code",
  "tuning.codeHeader": "Calibrated trigger thresholds, to be moved into positions.ts",
  "tuning.codeDevice": "Device: {agent}",
  "tuning.codeTime": "Time: {time}",
  "tuning.codeNone": "No threshold changed - the values from positions.ts apply unchanged.",

  // ----------------------------------------------------------- Measurements
  "debug.drive": "Movement",
  "debug.noPosition": "- no position active",
  "debug.sequenceDone": "- sequence finished",
  "debug.suppress": "Interfering movement",
  "debug.threshold": "Threshold",
  "debug.sideCompare": "Side comparison",
  "debug.noSideMeasure": "No per-side measure is defined for this position.",
  "debug.sideNote":
    "Left and Right follow the MediaPipe convention and mean the side of the person recorded. That belongs on the checklist - together with the mirroring test.",
  "debug.readout": "Measurements",
  "debug.blendshapes": "Blendshapes",
  "debug.blendshapesMost": "(most active)",
  "debug.analysis": "Analysis",
  "debug.faces": "Faces",
  "debug.sharpness": "Sharpness",
  "debug.luminance": "Brightness",
  "debug.clipping": "Clipping",
  "debug.interocular": "Eye distance",
  "debug.interlabial": "Lip gap",
  "debug.position": "Position",
  "debug.eyeOpening": "Eyelid gap (measured)",
  "debug.philtrum": "Philtrum to mouth corner (measured)",

  // ----------------------------------------------------------------- Camera
  "camera.heading": "Camera",
  "camera.note":
    "What the video stream delivers, against what the device offers. The photo path is not reachable everywhere - if it is missing, the reason is shown here.",
  "camera.none": "none open",
  "camera.source": "Source",
  "camera.delivered": "Delivered",
  "camera.resize": "Scaling",
  "camera.videoOffers": "Video path offers",
  "camera.videoUnknown": "no information (getCapabilities missing)",
  "camera.photoOffers": "Photo path offers",
  "camera.photoNoSize": "present, without size information",
  "camera.photoLabel": "Photo path",
  "camera.photoMissing": "not available",

  // --------------------------------------------------------------- Controls
  "btn.start": "Start camera",
  "btn.switch": "Switch camera",
  "btn.run": "Start recording",
  "btn.shutter": "Capture now",
  "btn.skip": "Skip",
  "btn.export": "Save as ZIP",
  "field.camera": "Camera",
  "field.file": "Video file",
  "field.file.title":
    "Development aid: run the same detection chain against a file, reproducible and without a camera",

  // ------------------------------------------------------------ Status line
  "status.ready": "ready - {count} positions",
  "status.loadingModel": "Loading model ...",
  "status.openingCamera": "Opening camera ...",
  "status.cameraOpen": "{width}x{height} @ {fps} fps - {label}",
  "status.file": "File: {name} - recording possible",
  "status.recording": "Recording",
  "status.noSource": "No recordable source - cannot start the sequence",
  "status.finishing": "Finishing the recording ...",
  "status.packing": "Packing ...",
  "status.saved": "Saved: {total} MB total, of which {video} MB video ({seconds} s)",
  "status.repeat": "Repeat",
  "status.error": "Error: {message}",

  // ------------------------------------------------------------------ Hints
  "issue.no-face": "No face detected",
  "issue.multiple-faces": "More than one face in the image",
  "issue.too-far": "Please move closer to the camera",
  "issue.off-center": "Center the face",
  "issue.too-dark": "Too dark - more light from the front",
  "issue.too-bright": "Too bright",
  "issue.overexposed": "Overexposed - no light from behind",
  "issue.blurry": "Blurred - please hold still",
  "issue.head-tilted": "Hold the head straight, look into the camera",

  // ----------------------------------------------------------------- Errors
  "error.noVideoTrack": "Camera returned no video track",
  "error.streamFailed": "Video stream could not be loaded",
  "error.noStillContext": "2D context for the still capture unavailable",
  "error.noQualityContext": "2D context for the quality measurement unavailable",
  "error.stillEncode": "Still could not be encoded",
  "error.noFrameYet": "Video element is not delivering image data yet",
  "error.recorderRunning": "Recording already in progress",
  "error.recorderIdle": "No recording is running",
  "error.recorderUnsupported": "This browser does not support video recording",
  "error.recorderStart": "Video recording could not be started",

  // -------------------------------------------------------------- Positions
  "position.neutral.label": "Face at rest",
  "position.neutral.instruction": "Relax the face. Do not smile, do not speak.",
  "position.forehead_wrinkle.label": "Wrinkle the forehead",
  "position.forehead_wrinkle.instruction": "Raise the eyebrows until the forehead wrinkles.",
  "position.eye_closure_gentle.label": "Gentle eye closure",
  "position.eye_closure_gentle.instruction":
    "Close the eyes loosely, as when falling asleep. Do not squeeze.",
  "position.eye_closure_forced.label": "Forced eye closure",
  "position.eye_closure_forced.instruction": "Squeeze the eyes shut as firmly as possible.",
  "position.nose_wrinkle.label": "Wrinkle the nose",
  "position.nose_wrinkle.instruction": "Wrinkle the nose as if something smelled unpleasant.",
  "position.smile_closed.label": "Smile with the mouth closed",
  "position.smile_closed.instruction":
    "Smile without showing the teeth. The lips stay closed.",
  "position.smile_teeth.label": "Smile showing the teeth",
  "position.smile_teeth.instruction": "Smile broadly so that the teeth are visible.",
  "position.lip_pucker.label": "Purse the lips",
  "position.lip_pucker.instruction": "Purse the lips as if to whistle.",
  "position.cheek_puff.label": "Puff the cheeks",
  "position.cheek_puff.instruction": "Puff up both cheeks and keep the mouth closed.",
  "position.teeth_bared.label": "Bare the teeth",
  "position.teeth_bared.instruction":
    "Pull the lips apart so that upper and lower teeth show.",
  "position.mouth_corners_down.label": "Pull the mouth corners down",
  "position.mouth_corners_down.instruction":
    "Pull the corners of the mouth down, as with a sad face.",
  "position.smile_natural.label": "Natural smile",
  "position.smile_natural.instruction": "Smile as you normally would. Nothing forced.",

  // ------------------------------------------------------------ ZIP read-me
  "bundle.title": "Face capture using the 12-expression set",
  "bundle.recorded": "Recorded: {time}",
  "bundle.duration": "Duration: {seconds} s",
  "bundle.contents": "Contents",
  "bundle.manifest": "manifest.json - conditions, measurements and thresholds of this session",
  "bundle.video": "{file} - video of the whole sequence",
  "bundle.stills": "stills/ - one image per position, in full camera resolution",
  "bundle.sides": "Note on side assignment",
  "bundle.mirrorField":
    "Whether mirroring was applied on saving is recorded in manifest.json under capture.mirrorApplied.",
  "bundle.prototype": "Prototype - not for use with patient data.",
  "bundle.mirrorNote":
    "The stills are NOT mirrored: left and right are the side of the person recorded.",
} as const;

export type TranslationKey = keyof typeof en;
export type Dictionary = Record<TranslationKey, string>;
