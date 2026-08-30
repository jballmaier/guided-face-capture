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
  "stage.captured": "triggered, Next when ready",
  "stage.wouldTrigger": "would trigger now (dev mode)",

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
  "poslist.jump": "Jump to this position - the recording keeps running",

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
  "debug.clippingDark": "Crushed blacks",
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
  "btn.next": "Next position",
  "btn.skip": "Skip",
  "btn.export": "Save as ZIP",
  "flow.auto": "Auto-advance",
  "flow.auto.title":
    "Advance automatically on trigger or timeout. Off: the sequence holds each position until Next - room to adjust thresholds against the live signal.",
  "flow.dev": "Dev mode",
  "flow.dev.title":
    "Calibration mode: the sequence holds each position, and the trigger is shown but never fires - watch when it would fire while adjusting thresholds. Runs are marked in the manifest.",
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
  "status.cropSaving":
    "a face crop would have saved {percent} % of the stills ({full} to {cropped} MB)",
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

  // ------------------------------------------------- Guided video (basic page)
  "app.basicTitle": "Guided video",
  "app.basicNote":
    "Aligned once, then guided by sound while the frame is watched. Everything stays on this device.",
  "nav.full": "Live analysis",
  "nav.basic": "Guided video",

  "btn.checkFraming": "Check framing",
  "btn.backToAlign": "Back to alignment",
  "btn.abort": "Stop",
  "btn.again": "New recording",

  "basic.statusReady": "Ready. Start the camera.",
  "basic.aligning": "Hold still and look into the camera.",
  "basic.aligned": "Alignment is good - check the framing.",
  "basic.framing": "Crop {w}x{h} out of {sw}x{sh} at {fps}/s. Stay inside this frame.",
  "basic.recording": "Recording - follow the sound.",
  "basic.stopped": "Recording stopped - what was recorded can still be saved.",
  "basic.framingTitle": "This is what gets recorded",
  "basic.framingHint":
    "Stay inside this frame for the whole recording - nothing follows you.",
  "basic.soundHint": "Sound guides you: check the volume, on iPhone also the silent switch.",
  "basic.announceSuffix": "Three times, one second each.",
  "basic.announceHold": "Hold still.",
  "basic.holdNow": "Hold",
  "basic.releaseNow": "Relax",
  "basic.repOf": "{rep} of {count}",
  "basic.noVoice": "No on-device voice available - guiding by tones and text.",
  "basic.outOfFrame": "Please move back into the frame",
  "basic.noFaceWatch": "Face not visible - please move back into the frame",
  "basic.watchSummary": "{seconds} s outside the frame ({percent} % of the recording)",
  "basic.watchClean": "face inside the frame throughout",
  "basic.loopFps": "video {video} fps, detection {detect} fps",
  "basic.voiceReady": "Voice: {name}.",
  "btn.guide": "Start guidance",
  "btn.repeat": "Repeat: {name}",
  "btn.repeatPlain": "Repeat position",
  "basic.armed": "press to record",
  "basic.discarded": "Face was outside the frame - this position is repeated.",
  "basic.discardedCount": "{count} discarded",
  "basic.savedSession": "{clips} clips, {total} MB, {seconds} s recorded ({fps} fps)",
  "basic.savedZip": "Saved: {clips} clips, {total} MB",
  "basic.autoDiscard": "Discard on frame loss",
  "basic.autoDiscard.title":
    "Stops and discards the clip while the face is outside the frame, and repeats that position from the start. Off, the clip runs on and only the samples in the manifest say what happened.",
  "basic.recFps": "recording {fps} fps",
  "basic.noData": "The browser delivered no video data - recording stopped.",
  "basic.size": "Video size",
  "basic.sizeSource": "Source",
  "basic.rate": "Bitrate",
  "basic.rateFormula": "standard",
  "basic.fullFrame": "Full frame",
  "basic.fullFrame.title":
    "Records the uncropped camera image. Fallback if cropped recording fails on this device - the crop rectangle is still written to the manifest.",

  // ---------------------------------------------------------- Settings sheet
  "settings.open": "Settings",
  "settings.title": "Settings",
  "settings.close": "Close",
  "announce.mode": "Announcements",
  "announce.mode.title":
    "How much is spoken before each clip. The tones always mark the seconds; the instruction is always on screen.",
  "announce.verbose": "Detailed",
  "announce.brief": "Brief",
  "announce.tones": "Tones only",

  // ---------------------------------------------- Video only (plain page)
  "app.plainTitle": "Video only",
  "app.plainNote":
    "Cued by sound, recorded straight from the camera. No face analysis - everything stays on this device.",
  "nav.plain": "Video only",
  "plain.framingHint":
    "Frame yourself: the whole face in the image, eyes at about the upper third. Nothing follows or checks you.",
  "plain.previewFps": "preview {fps} fps",
  "plain.sizeMax": "Maximum",
  "plain.size.title":
    "Long edge of the camera mode. Smaller modes are true video modes and record more smoothly.",
  "plain.savedSession": "{clips} clips, {total} MB, {seconds} s recorded",
  "plainBundle.intro":
    "One clip per expression, cued acoustically and recorded straight from the camera stream. No analysis ran and no crop was applied.",
  "plainBundle.clips": "one video file per position, named 01_... to 12_..., uncropped",
  "plainBundle.manifest":
    "manifest.json - camera, device and, per clip, when each hold was asked for",

  // ----------------------------------------------- Guided video ZIP read-me
  "videoBundle.title": "Guided video capture",
  "videoBundle.intro":
    "One video of twelve expressions, cued acoustically. No analysis ran while recording - the single frames are extracted afterwards.",
  "videoBundle.contents": "Contents",
  "videoBundle.clips": "one video file per position, named 01_... to 12_..., already cropped to the face",
  "videoBundle.rest": "rest_full.jpg - the resting face at full camera resolution",
  "videoBundle.manifest":
    "manifest.json - crop rectangle, camera, rest baseline and, per clip, when each hold was asked for",
  "videoBundle.howto": "Extracting the positions",
  "videoBundle.howto1":
    "Each clip holds one position. Its holds are listed with start and end in milliseconds from the start of that clip.",
  "videoBundle.howto2":
    "Run a landmarker over each window and keep the frame with the strongest movement.",
  "videoBundle.howto3":
    "Without a landmarker: start + 0.6 x duration lands close to the peak, before the movement is released.",
} as const;

export type TranslationKey = keyof typeof en;
export type Dictionary = Record<TranslationKey, string>;
