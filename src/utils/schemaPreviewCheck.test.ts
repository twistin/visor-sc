import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSceneStructure } from './schemaPreviewCheck';

test('accepts the prompt example scene', () => {
  const sample = {
    layers: [
      {
        shape: 'spiral',
        params: { turns: 5, points: 800 },
        mappings: [
          { signal: 'amp', to: 'radius', range: [0.2, 1.0], smooth: 0.15 },
          { signal: 'pitch', to: 'hue', range: [200, 340], curve: 'log' },
          { signal: 'onset', to: 'pulse', decay: 0.3 },
        ],
      },
    ],
  };
  const result = validateSceneStructure(sample);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('rejects unknown shapes and executable/extra fields', () => {
  const invalid = {
    layers: [
      {
        shape: 'customCode',
        params: { turns: 5 },
        mappings: [],
        evalScript: 'alert(1)',
      },
    ],
  };
  const result = validateSceneStructure(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('evalScript')));
  assert.ok(result.errors.some((e) => e.includes('shape')));
});
