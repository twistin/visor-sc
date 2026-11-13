import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SignalBuffer,
  clamp01,
  freqToNoteInfo,
  normalizeFreqLog,
  stepEma,
} from './signalBuffer';
import {
  OSC_SIGNAL_KEYS,
  getBandSignalKey,
  isSignalKey,
} from '../types/signals';
import type { AnalysisTuple } from '../types/protocol';

function makeAnalysis(overrides: Partial<Record<number, number>> = {}): AnalysisTuple {
  const arr = new Array<number>(23).fill(0);
  for (const [k, v] of Object.entries(overrides)) {
    arr[Number(k)] = v as number;
  }
  return arr as AnalysisTuple;
}

test('clamp01 and normalizeFreqLog bound values to [0, 1] safely', () => {
  assert.equal(clamp01(-0.5), 0);
  assert.equal(clamp01(1.8), 1);
  assert.equal(clamp01(Number.NaN), 0);
  assert.equal(normalizeFreqLog(440, 32.7032, 4186.01) > 0.4, true);
  assert.equal(normalizeFreqLog(10, 32.7032, 4186.01), 0);
  assert.equal(normalizeFreqLog(10000, 32.7032, 4186.01), 1);
});

test('freqToNoteInfo identifies A4 and C4 accurately', () => {
  assert.deepEqual(freqToNoteInfo(440), { noteName: 'A4', centsOffset: 0 });
  assert.deepEqual(freqToNoteInfo(261.6256), { noteName: 'C4', centsOffset: 0 });
  assert.deepEqual(freqToNoteInfo(0), { noteName: '--', centsOffset: 0 });
});

test('asymmetric EMA rises fast on short attack and decays slowly on long release', () => {
  const afterAttack = stepEma(0, 1, 20, 5, 200);
  assert.ok(afterAttack > 0.95, `expected fast attack > 0.95, got ${afterAttack}`);

  const afterRelease = stepEma(1, 0, 20, 5, 200);
  assert.ok(
    afterRelease > 0.85 && afterRelease < 0.95,
    `expected slow release ~0.90, got ${afterRelease}`,
  );
});

test('SignalBuffer map API supports per-signal attack/release, batch updates, reading, and reset', () => {
  const buf = new SignalBuffer({
    signals: {
      amp: { attackMs: 5, releaseMs: 250 },
      customGlow: { attackMs: 100, releaseMs: 10 },
    },
  });

  // Update individual and batch signals with clamping
  const ampVal = buf.updateSignal('amp', 1.5, 20);
  const glowVal = buf.updateSignal('customGlow', 1.0, 20);
  assert.ok(ampVal > 0.95 && ampVal <= 1);
  assert.ok(glowVal > 0.1 && glowVal < 0.3);

  buf.updateSignals({ centroid: 0.75, customGlow: 0.0 }, 20);
  assert.equal(buf.get('amp'), ampVal);
  assert.ok(buf.get('customGlow') < glowVal);
  assert.ok(buf.get('centroid') > 0);

  const mapSnapshot = buf.getMap();
  assert.ok(mapSnapshot instanceof Map);
  assert.equal(mapSnapshot.get('amp'), ampVal);

  const recordSnapshot = buf.getAll();
  assert.equal(recordSnapshot.amp, ampVal);
  assert.equal(recordSnapshot.customGlow, buf.get('customGlow'));

  // Dynamic reconfiguration + reset
  buf.setSignalConfig('customGlow', { attackMs: 1, releaseMs: 500 });
  assert.deepEqual(buf.getSignalConfig('customGlow'), {
    attackMs: 1,
    releaseMs: 500,
  });

  buf.reset();
  assert.equal(buf.get('amp'), 0);
  assert.equal(buf.get('customGlow'), 0);
  assert.equal(buf.get('centroid'), 0);
});

test('SignalBuffer smooths incoming /sc/analysis, holds low-confidence pitch, and decays onset', () => {
  const buf = new SignalBuffer({
    minPitchConfidence: 0.5,
    signals: {
      amp: { attackMs: 10, releaseMs: 200 },
      onset: { attackMs: 0, releaseMs: 100 },
      pitch: { attackMs: 0, releaseMs: 0 },
    },
  });

  buf.pushAnalysis(
    makeAnalysis({
      0: 0.8,
      1: 20,
      2: 440,
      3: 0.95,
      4: 2000,
      5: 0.25,
      6: 1.0,
      7: 0.6,
    }),
    1000,
  );
  const f1 = buf.step(1016);
  assert.ok(f1.amp > 0.5 && f1.amp <= 0.8);
  assert.equal(f1.onset, 1);
  assert.equal(f1.raw.noteName, 'A4');
  assert.ok(f1.bands[0] > 0.3);

  // Drop signal & send unreliable pitch (conf=0.1) — pitch holds near A4
  buf.pushAnalysis(
    makeAnalysis({
      0: 0,
      2: 80,
      3: 0.1,
      6: 0,
    }),
    1032,
  );
  const f2 = buf.step(1066);
  assert.ok(f2.amp < f1.amp);
  assert.ok(f2.onset < 0.7 && f2.onset > 0.4);
  assert.equal(f2.raw.noteName, 'A4');
});

test('SignalBuffer tracks active voices from note-on/off and expires by duration', () => {
  const buf = new SignalBuffer();
  buf.pushTelemetry({
    t: 'n',
    ts: 1000,
    id: 1001,
    inst: 'acidLead',
    f: 440,
    a: 0.8,
    dur: 1.0,
    pan: -0.5,
  });

  const mid = buf.step(1500);
  assert.equal(mid.voices.length, 1);
  assert.equal(mid.voices[0].instrument, 'acidLead');
  assert.ok(Math.abs(mid.voices[0].amp - 0.4) < 0.05);
  assert.ok(buf.get('voiceCount') > 0);

  const expired = buf.step(2100);
  assert.equal(expired.voices.length, 0);

  buf.pushTelemetry({
    t: 'n',
    ts: 2200,
    id: 1002,
    inst: 'pad',
    f: 220,
    a: 0.9,
    dur: 5.0,
    pan: 0.2,
  });
  assert.equal(buf.step(2300).voices.length, 1);
  buf.pushTelemetry({ t: 'o', ts: 2350, id: 1002 });
  assert.equal(buf.step(2360).voices.length, 0);
});

test('OSC_SIGNAL_KEYS defines all 23 valid OSC keys and isSignalKey validates them', () => {
  assert.equal(OSC_SIGNAL_KEYS.length, 23);
  assert.equal(OSC_SIGNAL_KEYS[0], 'amp');
  assert.equal(OSC_SIGNAL_KEYS[2], 'pitchHz');
  assert.equal(OSC_SIGNAL_KEYS[4], 'centroidHz');
  assert.equal(OSC_SIGNAL_KEYS[7], 'band0');
  assert.equal(OSC_SIGNAL_KEYS[22], 'band15');
  assert.equal(isSignalKey('flatness'), true);
  assert.equal(isSignalKey('band15'), true);
  assert.equal(isSignalKey('band16'), false);
  assert.equal(getBandSignalKey(99), 'band15');
});
