/**
 * GENERIERT von scripts/build-mesh-pairs.mjs - nicht von Hand aendern.
 *
 * Links-rechts-Paare des MediaPipe-Gesichtsnetzes (478 Landmarks), abgeleitet
 * aus dem spiegelsymmetrischen kanonischen Modell (canonical_face_model.obj,
 * SHA-256 8bac80443397...). "links"/"rechts" meinen die Seite der Person, wie
 * MediaPipes FACE_LANDMARKS_LEFT_* / _RIGHT_*.
 *
 * 220 Netzpaare (groesster Spiegelfehler 0.00e+0) plus fuenf
 * Irispaare = 225 Paare, wie bei Heinrich et al., Bioengineering 2026, 13:426.
 * Regionen sind eine eigene Naeherung: naechstgelegene MediaPipe-Kontur auf
 * dem Modell innerhalb einer Reichweite (Mund 44, Nase 37,
 * Augen 60, uebrige 84); die 91-Paar-Auswahl des
 * Papers ist nicht veroeffentlicht und hier nicht enthalten.
 */

export const MESH_PAIRS_VERSION = "canonical_face_model.obj@8bac80443397";

/** Alle 28 Punkte der Mittellinie, Stirn bis Kinn. */
export const MIDLINE_ALL: readonly number[] = [
  0, 1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 94, 151, 152, 164, 168, 175, 195, 197, 199, 200,
];

/** Die 20 Mittellinienpunkte fuer die Achsenschaetzung - ohne die Lippen. */
export const MIDLINE_FIT: readonly number[] = [
  1, 2, 4, 5, 6, 8, 9, 10, 18, 19,
  94, 151, 152, 164, 168, 175, 195, 197, 199, 200,
];

export type PairRegion = "eyes" | "nose" | "mouth" | "other";

/** [person-links, person-rechts] je Paar. */
export const MESH_PAIRS: readonly (readonly [number, number])[] = [
  [248, 3], [249, 7], [250, 20], [251, 21], [252, 22], [253, 23],
  [254, 24], [255, 25], [256, 26], [257, 27], [258, 28], [259, 29],
  [260, 30], [261, 31], [262, 32], [263, 33], [264, 34], [265, 35],
  [266, 36], [267, 37], [268, 38], [269, 39], [270, 40], [271, 41],
  [272, 42], [273, 43], [274, 44], [275, 45], [276, 46], [277, 47],
  [278, 48], [279, 49], [280, 50], [281, 51], [282, 52], [283, 53],
  [284, 54], [285, 55], [286, 56], [287, 57], [288, 58], [289, 59],
  [290, 60], [291, 61], [292, 62], [293, 63], [294, 64], [295, 65],
  [296, 66], [297, 67], [298, 68], [299, 69], [300, 70], [301, 71],
  [302, 72], [303, 73], [304, 74], [305, 75], [306, 76], [307, 77],
  [308, 78], [309, 79], [310, 80], [311, 81], [312, 82], [313, 83],
  [314, 84], [315, 85], [316, 86], [317, 87], [318, 88], [319, 89],
  [320, 90], [321, 91], [322, 92], [323, 93], [324, 95], [325, 96],
  [326, 97], [327, 98], [328, 99], [329, 100], [330, 101], [331, 102],
  [332, 103], [333, 104], [334, 105], [335, 106], [336, 107], [337, 108],
  [338, 109], [339, 110], [340, 111], [341, 112], [342, 113], [343, 114],
  [344, 115], [345, 116], [346, 117], [347, 118], [348, 119], [349, 120],
  [350, 121], [351, 122], [352, 123], [353, 124], [354, 125], [355, 126],
  [356, 127], [357, 128], [358, 129], [359, 130], [360, 131], [361, 132],
  [362, 133], [363, 134], [364, 135], [365, 136], [366, 137], [367, 138],
  [368, 139], [369, 140], [370, 141], [371, 142], [372, 143], [373, 144],
  [374, 145], [375, 146], [376, 147], [377, 148], [378, 149], [379, 150],
  [380, 153], [381, 154], [382, 155], [383, 156], [384, 157], [385, 158],
  [386, 159], [387, 160], [388, 161], [389, 162], [390, 163], [391, 165],
  [392, 166], [393, 167], [394, 169], [395, 170], [396, 171], [397, 172],
  [398, 173], [399, 174], [400, 176], [401, 177], [402, 178], [403, 179],
  [404, 180], [405, 181], [406, 182], [407, 183], [408, 184], [409, 185],
  [410, 186], [411, 187], [412, 188], [413, 189], [414, 190], [415, 191],
  [416, 192], [417, 193], [418, 194], [419, 196], [420, 198], [421, 201],
  [422, 202], [423, 203], [424, 204], [425, 205], [426, 206], [427, 207],
  [428, 208], [429, 209], [430, 210], [431, 211], [432, 212], [433, 213],
  [434, 214], [435, 215], [436, 216], [437, 217], [438, 218], [439, 219],
  [440, 220], [441, 221], [442, 222], [443, 223], [444, 224], [445, 225],
  [446, 226], [447, 227], [448, 228], [449, 229], [450, 230], [451, 231],
  [452, 232], [453, 233], [454, 234], [455, 235], [456, 236], [457, 237],
  [458, 238], [459, 239], [460, 240], [461, 241], [462, 242], [463, 243],
  [464, 244], [465, 245], [466, 246], [467, 247], [473, 468], [475, 470],
  [477, 472], [474, 471], [476, 469],
];

/** Region je Paar, gleiche Reihenfolge wie MESH_PAIRS. */
export const PAIR_REGIONS: readonly PairRegion[] = [
  "nose", "eyes", "nose", "other", "eyes", "eyes", "eyes", "eyes",
  "eyes", "eyes", "eyes", "eyes", "eyes", "other", "other", "eyes",
  "other", "other", "other", "mouth", "mouth", "mouth", "mouth", "mouth",
  "mouth", "mouth", "nose", "nose", "eyes", "other", "nose", "nose",
  "other", "nose", "eyes", "eyes", "other", "eyes", "eyes", "mouth",
  "other", "nose", "nose", "mouth", "mouth", "eyes", "nose", "eyes",
  "eyes", "other", "other", "other", "eyes", "other", "mouth", "mouth",
  "mouth", "nose", "mouth", "mouth", "mouth", "nose", "mouth", "mouth",
  "mouth", "mouth", "mouth", "mouth", "mouth", "mouth", "mouth", "mouth",
  "mouth", "mouth", "mouth", "other", "mouth", "mouth", "nose", "nose",
  "nose", "other", "other", "nose", "other", "other", "eyes", "mouth",
  "eyes", "other", "other", "eyes", "other", "eyes", "eyes", "other",
  "nose", "other", "other", "other", "other", "other", "other", "nose",
  "other", "other", "nose", "other", "other", "other", "nose", "eyes",
  "nose", "other", "eyes", "nose", "other", "other", "other", "other",
  "other", "other", "nose", "other", "other", "eyes", "eyes", "mouth",
  "other", "other", "other", "other", "eyes", "eyes", "eyes", "other",
  "eyes", "eyes", "eyes", "eyes", "eyes", "other", "eyes", "mouth",
  "nose", "nose", "other", "other", "other", "other", "eyes", "other",
  "other", "other", "mouth", "mouth", "mouth", "mouth", "mouth", "mouth",
  "mouth", "mouth", "mouth", "other", "other", "eyes", "eyes", "mouth",
  "other", "nose", "other", "nose", "other", "other", "other", "other",
  "other", "other", "other", "other", "other", "other", "other", "other",
  "other", "other", "other", "other", "other", "other", "nose", "nose",
  "nose", "other", "eyes", "eyes", "eyes", "eyes", "eyes", "other",
  "other", "eyes", "eyes", "eyes", "eyes", "eyes", "other", "nose",
  "other", "nose", "nose", "nose", "nose", "nose", "nose", "eyes",
  "eyes", "other", "eyes", "eyes", "eyes", "eyes", "eyes", "eyes",
  "eyes",
];
