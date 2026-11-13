import {
  ActiveVoice,
  AnalysisTuple,
  FFT_BAND_COUNT,
  MAX_ACTIVE_VOICES,
  NormalizedSignalFrame,
  WsNoteMessage,
  WsNoteOffMessage,
  WsTelemetryMessage,
} from '../types/protocol';
import {
  OSC_SIGNAL_KEYS,
  SignalKey,
  getBandSignalKey,
} from '../types/signals';

export type SignalBufferKey = SignalKey | 'pitch' | 'centroid' | 'voiceCount' | 'voiceAmp' | 'voicePitch' | (string & {});

export interface AttackReleaseConfig {
  /** Time constant in milliseconds for rising edges (0 = instant). */
  attackMs: number;
  /** Time constant in milliseconds for falling edges (0 = instant). */
  releaseMs: number;
}

export interface SignalBufferOptions {
  /** Per-signal attack/release configuration keyed by signal name. */
  signals?: Record<string, Partial<AttackReleaseConfig>>;
  /** Fallback smoothing for any signal without an explicit config. */
  defaultSmoothing?: AttackReleaseConfig;
  /** Minimum pitch confidence (0..1) required to update `pitch`. */
  minPitchConfidence?: number;
  /** Reference maximum sones mapped to 1.0 (default 40 sones). */
  loudnessMaxSones?: number;
  /** Minimum/maximum frequency (Hz) for log pitch normalization. */
  pitchRangeHz?: [number, number];
  /** Minimum/maximum frequency (Hz) for log centroid normalization. */
  centroidRangeHz?: [number, number];
}

export const DEFAULT_SMOOTHING: AttackReleaseConfig = {
  attackMs: 15,
  releaseMs: 140,
};

export const DEFAULT_SIGNAL_CONFIGS: Partial<Record<SignalBufferKey, AttackReleaseConfig>> = {
  amp: { attackMs: 12, releaseMs: 140 },
  loudness: { attackMs: 25, releaseMs: 180 },
  pitch: { attackMs: 20, releaseMs: 90 },
  pitchHz: { attackMs: 20, releaseMs: 90 },
  pitchConf: { attackMs: 20, releaseMs: 90 },
  centroid: { attackMs: 25, releaseMs: 160 },
  centroidHz: { attackMs: 25, releaseMs: 160 },
  flatness: { attackMs: 30, releaseMs: 180 },
  onset: { attackMs: 2, releaseMs: 220 },
  voiceCount: { attackMs: 10, releaseMs: 120 },
  voiceAmp: { attackMs: 10, releaseMs: 140 },
  voicePitch: { attackMs: 15, releaseMs: 100 },
};

const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function normalizeFreqLog(
  hz: number,
  minHz: number,
  maxHz: number,
): number {
  if (!Number.isFinite(hz) || hz <= 0 || minHz <= 0 || maxHz <= minHz) {
    return 0;
  }
  const clamped = Math.min(Math.max(hz, minHz), maxHz);
  const logMin = Math.log2(minHz);
  const logMax = Math.log2(maxHz);
  return clamp01((Math.log2(clamped) - logMin) / (logMax - logMin));
}

export function freqToNoteInfo(hz: number): {
  noteName: string;
  centsOffset: number;
} {
  if (!Number.isFinite(hz) || hz <= 0) {
    return { noteName: '--', centsOffset: 0 };
  }
  const midiFloat = 69 + 12 * Math.log2(hz / 440);
  const midiNearest = Math.round(midiFloat);
  const centsOffset = Math.round((midiFloat - midiNearest) * 100);
  const noteIdx = ((midiNearest % 12) + 12) % 12;
  const octave = Math.floor(midiNearest / 12) - 1;
  return {
    noteName: `${NOTE_NAMES[noteIdx]}${octave}`,
    centsOffset,
  };
}

/**
 * Frame-rate-independent asymmetric exponential moving average (EMA):
 * alpha = 1 - exp(-dtMs / tauMs)
 * Uses attackMs when target >= current, releaseMs when target < current.
 */
export function stepEma(
  current: number,
  target: number,
  dtMs: number,
  attackMs: number,
  releaseMs: number,
): number {
  const safeTarget = Number.isFinite(target) ? target : current;
  const safeCurrent = Number.isFinite(current) ? current : 0;
  if (dtMs <= 0) return safeCurrent;

  const tauMs = safeTarget >= safeCurrent ? attackMs : releaseMs;
  if (tauMs <= 0.001) {
    return safeTarget;
  }
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return safeCurrent + alpha * (safeTarget - safeCurrent);
}

/**
 * Stores a map of signal names to normalized [0, 1] values smoothed via an
 * asymmetric exponential moving average (EMA) with per-signal attack and
 * release times, plus OSC/WebSocket telemetry ingestion and voice tracking.
 */
export class SignalBuffer {
  private readonly values = new Map<string, number>();
  private readonly targets = new Map<string, number>();
  private readonly configs = new Map<string, AttackReleaseConfig>();

  private defaultSmoothing: AttackReleaseConfig;
  private minPitchConfidence: number;
  private loudnessMaxSones: number;
  private pitchRangeHz: [number, number];
  private centroidRangeHz: [number, number];

  // Raw physical readouts for meters
  private rawAmp = 0;
  private rawLoudnessSones = 0;
  private rawPitchHz = 0;
  private rawCentroidHz = 0;
  private rawOnsetPulse = false;
  private lastPacketMs = 0;
  private lastStepMs: number | null = null;

  // Active note voices tracked from /sc/note & /sc/note/off
  private voices: ActiveVoice[] = [];
  private syntheticVoiceSeq = -1;

  constructor(options: SignalBufferOptions = {}) {
    this.defaultSmoothing = {
      attackMs: Math.max(0, options.defaultSmoothing?.attackMs ?? DEFAULT_SMOOTHING.attackMs),
      releaseMs: Math.max(0, options.defaultSmoothing?.releaseMs ?? DEFAULT_SMOOTHING.releaseMs),
    };
    this.minPitchConfidence = clamp01(options.minPitchConfidence ?? 0.45);
    this.loudnessMaxSones = Math.max(1, options.loudnessMaxSones ?? 40);
    this.pitchRangeHz = options.pitchRangeHz ?? [32.7032, 4186.01];
    this.centroidRangeHz = options.centroidRangeHz ?? [80, 12000];

    // Seed all canonical OSC signals, normalized aliases, and voice signals
    for (const key of OSC_SIGNAL_KEYS) {
      const cfg = DEFAULT_SIGNAL_CONFIGS[key] ?? { attackMs: 15, releaseMs: 130 };
      this.configs.set(key, { ...cfg });
      this.values.set(key, 0);
      this.targets.set(key, 0);
    }
    for (const [name, cfg] of Object.entries(DEFAULT_SIGNAL_CONFIGS)) {
      if (cfg && !this.configs.has(name)) {
        this.configs.set(name, { ...cfg });
        this.values.set(name, 0);
        this.targets.set(name, 0);
      }
    }

    // Apply user-provided per-signal overrides
    if (options.signals) {
      for (const [name, partial] of Object.entries(options.signals)) {
        this.setSignalConfig(name, partial);
      }
    }
  }

  public setSignalConfig(
    name: SignalBufferKey,
    config: Partial<AttackReleaseConfig>,
  ): void {
    const prev = this.configs.get(name) ?? this.defaultSmoothing;
    this.configs.set(name, {
      attackMs: Math.max(0, config.attackMs ?? prev.attackMs),
      releaseMs: Math.max(0, config.releaseMs ?? prev.releaseMs),
    });
    if (!this.values.has(name)) {
      this.values.set(name, 0);
      this.targets.set(name, 0);
    }
  }

  public getSignalConfig(name: SignalBufferKey): AttackReleaseConfig {
    const cfg = this.configs.get(name) ?? this.defaultSmoothing;
    return { ...cfg };
  }

  /**
   * Updates a single named signal (clamped to [0, 1]) and advances its EMA
   * smoothing using that signal's configured attack/release times.
   */
  public updateSignal(name: SignalBufferKey, rawValue: number, dtMs = 16.667): number {
    const clampedTarget = clamp01(rawValue);
    this.targets.set(name, clampedTarget);

    const current = this.values.get(name) ?? 0;
    const { attackMs, releaseMs } = this.configs.get(name) ?? this.defaultSmoothing;
    const smoothed = clamp01(
      stepEma(current, clampedTarget, dtMs, attackMs, releaseMs),
    );
    this.values.set(name, smoothed);
    return smoothed;
  }

  /**
   * Batch-updates multiple named signals and advances their EMA state.
   */
  public updateSignals(
    batch: Partial<Record<SignalBufferKey, number>> | ReadonlyMap<string, number>,
    dtMs = 16.667,
  ): void {
    const entries =
      batch instanceof Map
        ? batch.entries()
        : Object.entries(batch as Record<string, number>);
    for (const [name, value] of entries) {
      if (typeof value === 'number') {
        this.updateSignal(name, value, dtMs);
      }
    }
  }

  /**
   * Sets target without immediately stepping EMA (used by network/OSC listeners
   * when the 60 fps requestAnimationFrame loop drives `step()`).
   */
  public setTarget(name: SignalBufferKey, rawValue: number): void {
    const clamped = clamp01(rawValue);
    this.targets.set(name, clamped);
    if (!this.values.has(name)) {
      this.values.set(name, 0);
    }
  }

  /**
   * Reads the current smoothed [0, 1] value for a signal name.
   */
  public get(name: SignalBufferKey): number {
    return this.values.get(name) ?? 0;
  }

  /**
   * Returns a plain-object snapshot of all smoothed [0, 1] signals.
   */
  public getAll(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, val] of this.values.entries()) {
      out[key] = val;
    }
    return out;
  }

  /**
   * Returns a shallow copy of the internal Map<string, number> of smoothed values.
   */
  public getMap(): Map<string, number> {
    return new Map(this.values);
  }

  /**
   * Resets all stored smoothed values, targets, raw readouts, and active voices.
   */
  public reset(): void {
    for (const key of this.values.keys()) {
      this.values.set(key, 0);
    }
    for (const key of this.targets.keys()) {
      this.targets.set(key, 0);
    }
    this.rawAmp = 0;
    this.rawLoudnessSones = 0;
    this.rawPitchHz = 0;
    this.rawCentroidHz = 0;
    this.rawOnsetPulse = false;
    this.lastPacketMs = 0;
    this.lastStepMs = null;
    this.voices = [];
  }

  /**
   * Ingests a compact WebSocket message from Django Channels.
   */
  public pushTelemetry(msg: WsTelemetryMessage): void {
    if (msg.t === 'a') {
      this.pushAnalysis(msg.d, msg.ts);
    } else if (msg.t === 'n') {
      this.pushNoteOn(msg);
    } else if (msg.t === 'o') {
      this.pushNoteOff(msg);
    }
  }

  /**
   * Ingests the 23-float OSC `/sc/analysis` payload into signal targets.
   */
  public pushAnalysis(
    tuple: AnalysisTuple | readonly number[],
    timestampMs = Date.now(),
  ): void {
    const rawAmp = Number.isFinite(tuple[0]) ? Math.max(0, tuple[0]) : 0;
    const rawLoudness = Number.isFinite(tuple[1]) ? Math.max(0, tuple[1]) : 0;
    const rawPitchHz = Number.isFinite(tuple[2]) ? Math.max(0, tuple[2]) : 0;
    const rawPitchConf = clamp01(tuple[3] ?? 0);
    const rawCentroidHz = Number.isFinite(tuple[4]) ? Math.max(0, tuple[4]) : 0;
    const rawFlatness = clamp01(tuple[5] ?? 0);
    const rawOnset = clamp01(tuple[6] ?? 0);

    this.rawAmp = rawAmp;
    this.rawLoudnessSones = rawLoudness;
    this.rawCentroidHz = rawCentroidHz;
    this.lastPacketMs = timestampMs;

    this.setTarget('amp', rawAmp);
    this.setTarget('loudness', rawLoudness / this.loudnessMaxSones);
    this.setTarget('pitchConf', rawPitchConf);

    if (rawPitchConf >= this.minPitchConfidence && rawPitchHz > 0) {
      this.rawPitchHz = rawPitchHz;
      const pitchNorm = normalizeFreqLog(
        rawPitchHz,
        this.pitchRangeHz[0],
        this.pitchRangeHz[1],
      );
      this.setTarget('pitch', pitchNorm);
      this.setTarget('pitchHz', pitchNorm);
    }

    const centroidNorm = normalizeFreqLog(
      rawCentroidHz,
      this.centroidRangeHz[0],
      this.centroidRangeHz[1],
    );
    this.setTarget('centroid', centroidNorm);
    this.setTarget('centroidHz', centroidNorm);
    this.setTarget('flatness', rawFlatness);

    if (rawOnset >= 0.5) {
      this.setTarget('onset', 1);
      this.values.set('onset', Math.max(this.values.get('onset') ?? 0, 1));
      this.rawOnsetPulse = true;
    } else {
      this.setTarget('onset', 0);
      this.rawOnsetPulse = false;
    }

    for (let i = 0; i < FFT_BAND_COUNT; i++) {
      this.setTarget(getBandSignalKey(i), tuple[7 + i] ?? 0);
    }
  }

  public pushNoteOn(msg: WsNoteMessage): void {
    const id = msg.id >= 0 ? msg.id : this.syntheticVoiceSeq--;
    const freqHz = Number.isFinite(msg.f) ? Math.max(0, msg.f) : 0;
    const initialAmp = clamp01(msg.a);
    const durSec =
      Number.isFinite(msg.dur) && msg.dur > 0.01 ? msg.dur : 0.25;
    const pan = Number.isFinite(msg.pan)
      ? Math.max(-1, Math.min(1, msg.pan))
      : 0;

    const voice: ActiveVoice = {
      id,
      instrument: msg.inst || 'synth',
      freqHz,
      pitchNorm: normalizeFreqLog(
        freqHz,
        this.pitchRangeHz[0],
        this.pitchRangeHz[1],
      ),
      amp: initialAmp,
      initialAmp,
      durSec,
      pan,
      startedAtMs: msg.ts,
    };

    const existingIdx = this.voices.findIndex((v) => v.id === id && id >= 0);
    if (existingIdx >= 0) {
      this.voices[existingIdx] = voice;
    } else {
      this.voices.unshift(voice);
      if (this.voices.length > MAX_ACTIVE_VOICES) {
        this.voices.length = MAX_ACTIVE_VOICES;
      }
    }
  }

  public pushNoteOff(msg: WsNoteOffMessage): void {
    if (msg.id < 0) return;
    this.voices = this.voices.filter((v) => v.id !== msg.id);
  }

  /**
   * Advances EMA smoothing for all signals in the map and updates active voice
   * envelopes to `nowMs`. Designed for a decoupled 60 fps requestAnimationFrame loop.
   */
  public step(nowMs = Date.now()): NormalizedSignalFrame {
    const dtMs =
      this.lastStepMs === null
        ? 16.667
        : Math.max(0, Math.min(250, nowMs - this.lastStepMs));
    this.lastStepMs = nowMs;

    // Update voice envelopes first so voiceCount/voiceAmp/voicePitch targets reflect active voices
    const remainingVoices: ActiveVoice[] = [];
    for (const v of this.voices) {
      const elapsedSec = Math.max(0, (nowMs - v.startedAtMs) / 1000);
      if (elapsedSec <= v.durSec) {
        const env = Math.max(0, 1 - elapsedSec / v.durSec);
        remainingVoices.push({
          ...v,
          amp: clamp01(v.initialAmp * env),
        });
      }
    }
    this.voices = remainingVoices;

    this.setTarget('voiceCount', this.voices.length / MAX_ACTIVE_VOICES);
    this.setTarget('voiceAmp', this.voices[0]?.amp ?? 0);
    this.setTarget('voicePitch', this.voices[0]?.pitchNorm ?? 0);

    // Step EMA for every registered signal in the map
    for (const [name, target] of this.targets.entries()) {
      const current = this.values.get(name) ?? 0;
      const { attackMs, releaseMs } =
        this.configs.get(name) ?? this.defaultSmoothing;
      const next = clamp01(stepEma(current, target, dtMs, attackMs, releaseMs));
      this.values.set(name, next);
    }

    // Clear latched onset impulse after step
    if ((this.targets.get('onset') ?? 0) > 0) {
      this.targets.set('onset', 0);
    }

    return this.getFrame();
  }

  public getFrame(): NormalizedSignalFrame {
    const bands: number[] = [];
    for (let i = 0; i < FFT_BAND_COUNT; i++) {
      bands.push(this.get(getBandSignalKey(i)));
    }

    const ampDb =
      this.rawAmp > 1e-6 ? Math.max(-96, 20 * Math.log10(this.rawAmp)) : -96;
    const { noteName, centsOffset } = freqToNoteInfo(this.rawPitchHz);

    const onset = this.get('onset');

    return {
      amp: this.get('amp'),
      loudness: this.get('loudness'),
      pitch: this.get('pitch'),
      pitchConf: this.get('pitchConf'),
      centroid: this.get('centroid'),
      flatness: this.get('flatness'),
      onset,
      bands,
      voices: this.voices.map((v) => ({ ...v })),
      raw: {
        ampDb,
        loudnessSones: this.rawLoudnessSones,
        pitchHz: this.rawPitchHz,
        noteName,
        centsOffset,
        centroidHz: this.rawCentroidHz,
        onsetPulse: this.rawOnsetPulse || onset > 0.65,
        timestampMs: this.lastPacketMs,
      },
    };
  }
}
