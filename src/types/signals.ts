export const BAND_SIGNAL_KEYS = [
  'band0',
  'band1',
  'band2',
  'band3',
  'band4',
  'band5',
  'band6',
  'band7',
  'band8',
  'band9',
  'band10',
  'band11',
  'band12',
  'band13',
  'band14',
  'band15',
] as const;

export type BandSignalKey = (typeof BAND_SIGNAL_KEYS)[number];

export const CORE_OSC_SIGNAL_KEYS = [
  'amp',
  'loudness',
  'pitchHz',
  'pitchConf',
  'centroidHz',
  'flatness',
  'onset',
] as const;

export type CoreOscSignalKey = (typeof CORE_OSC_SIGNAL_KEYS)[number];

/**
 * Full list of valid OSC `/sc/analysis` signal keys in positional payload order
 * (indices 0..22): amp, loudness, pitchHz, pitchConf, centroidHz, flatness,
 * onset, and band0..band15.
 */
export const OSC_SIGNAL_KEYS = [
  ...CORE_OSC_SIGNAL_KEYS,
  ...BAND_SIGNAL_KEYS,
] as const;

export type SignalKey = (typeof OSC_SIGNAL_KEYS)[number];

const SIGNAL_KEY_SET: ReadonlySet<string> = new Set<string>(OSC_SIGNAL_KEYS);

export function isSignalKey(value: string): value is SignalKey {
  return SIGNAL_KEY_SET.has(value);
}

export function getBandSignalKey(index: number): BandSignalKey {
  const clamped = Math.max(0, Math.min(BAND_SIGNAL_KEYS.length - 1, Math.trunc(index)));
  return BAND_SIGNAL_KEYS[clamped];
}
