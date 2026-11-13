export const FFT_BAND_COUNT = 16 as const;
export const MAX_ACTIVE_VOICES = 16 as const;

export const OSC_ADDRESSES = {
  ANALYSIS: '/sc/analysis',
  NOTE_ON: '/sc/note',
  NOTE_OFF: '/sc/note/off',
} as const;

/**
 * Exact positional float32 payload of OSC `/sc/analysis` (23 floats total):
 * [0]  amp         - Master RMS/peak amplitude (linear, ~0.0..1.0+)
 * [1]  loudness    - Perceptual loudness in sones (0.0..64.0)
 * [2]  pitchHz     - Detected fundamental frequency in Hz (20.0..20000.0)
 * [3]  pitchConf   - Pitch tracker confidence (0.0..1.0)
 * [4]  centroidHz  - Spectral centroid in Hz (20.0..20000.0)
 * [5]  flatness    - Spectral flatness (0.0 tonal .. 1.0 noise)
 * [6]  onset       - Transient trigger (1.0 on onset frame, 0.0 otherwise)
 * [7..22] bands    - 16 logarithmic FFT band energies (~30 Hz .. 16 kHz)
 */
export type AnalysisTuple = [
  number, // 0: amp
  number, // 1: loudness
  number, // 2: pitchHz
  number, // 3: pitchConf
  number, // 4: centroidHz
  number, // 5: flatness
  number, // 6: onset
  number, // 7: band0
  number, // 8: band1
  number, // 9: band2
  number, // 10: band3
  number, // 11: band4
  number, // 12: band5
  number, // 13: band6
  number, // 14: band7
  number, // 15: band8
  number, // 16: band9
  number, // 17: band10
  number, // 18: band11
  number, // 19: band12
  number, // 20: band13
  number, // 21: band14
  number, // 22: band15
];

/**
 * Compact WebSocket messages broadcast by Django Channels on `/ws/telemetry/`.
 */
export interface WsAnalysisMessage {
  t: 'a';
  ts: number; // Unix epoch milliseconds
  d: AnalysisTuple;
}

export interface WsNoteMessage {
  t: 'n';
  ts: number;
  id: number; // SC nodeID (or -1 if triggered at pattern level)
  inst: string; // SynthDef / instrument name
  f: number; // Frequency in Hz
  a: number; // Amplitude (0..1+)
  dur: number; // Duration in seconds
  pan: number; // Stereo pan (-1..1)
}

export interface WsNoteOffMessage {
  t: 'o';
  ts: number;
  id: number; // SC nodeID
}

export interface WsStatusMessage {
  t: 's';
  ts: number;
  osc: boolean; // Whether OSC packets were received recently
  rate: number; // Measured OSC analysis packets/sec
}

export type WsTelemetryMessage =
  | WsAnalysisMessage
  | WsNoteMessage
  | WsNoteOffMessage
  | WsStatusMessage;

export interface ActiveVoice {
  id: number;
  instrument: string;
  freqHz: number;
  pitchNorm: number; // 0..1 log-mapped MIDI 24..108
  amp: number; // 0..1 current decayed amplitude
  initialAmp: number;
  durSec: number;
  pan: number; // -1..1
  startedAtMs: number;
}

export interface NormalizedSignalFrame {
  // Normalized 0..1 signals used by declarative layer mappings
  amp: number;
  loudness: number;
  pitch: number;
  pitchConf: number;
  centroid: number;
  flatness: number;
  onset: number;
  bands: number[]; // length 16, each 0..1
  voices: ActiveVoice[];

  // Raw physical readouts for the live meter panel
  raw: {
    ampDb: number;
    loudnessSones: number;
    pitchHz: number;
    noteName: string;
    centsOffset: number;
    centroidHz: number;
    onsetPulse: boolean;
    timestampMs: number;
  };
}
