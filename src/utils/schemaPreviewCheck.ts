import type { SceneConfig } from '../types/scene';

export const VALID_SHAPES = [
  'spiral',
  'polygon',
  'lissajous',
  'rings',
  'particles',
  'grid',
] as const;

export const VALID_SIGNALS = [
  'amp',
  'loudness',
  'pitch',
  'pitchConf',
  'centroid',
  'flatness',
  'onset',
  'band',
  'voiceAmp',
  'voicePitch',
  'voiceCount',
] as const;

export const VALID_TARGETS = [
  'radius',
  'scale',
  'rotationX',
  'rotationY',
  'rotationZ',
  'hue',
  'saturation',
  'lightness',
  'opacity',
  'pulse',
  'turns',
  'twist',
  'spread',
  'zDepth',
  'thickness',
  'pointSize',
  'freqX',
  'freqY',
  'phase',
  'sides',
  'displacement',
] as const;

export const VALID_CURVES = ['lin', 'log', 'exp'] as const;

const ALLOWED_ROOT_KEYS = new Set([
  'version',
  'name',
  'description',
  'background',
  'camera',
  'layers',
]);

const ALLOWED_LAYER_KEYS = new Set([
  'id',
  'name',
  'visible',
  'opacity',
  'blendMode',
  'shape',
  'params',
  'mappings',
]);

const ALLOWED_PARAM_KEYS = new Set([
  'points',
  'turns',
  'sides',
  'count',
  'ringCount',
  'rows',
  'cols',
  'freqX',
  'freqY',
  'phase',
  'radius',
  'innerRadius',
  'scale',
  'spread',
  'zDepth',
  'twist',
  'thickness',
  'pointSize',
  'hue',
  'saturation',
  'lightness',
  'rotationX',
  'rotationY',
  'rotationZ',
  'displacement',
  'wireframe',
  'closed',
]);

const ALLOWED_MAPPING_KEYS = new Set([
  'id',
  'signal',
  'bandIndex',
  'voiceIndex',
  'to',
  'range',
  'curve',
  'smooth',
  'attack',
  'decay',
  'invert',
  'clamp',
]);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  scene?: SceneConfig;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateSceneStructure(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    return { valid: false, errors: ['Root scene must be a JSON object.'] };
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      errors.push(`Unknown root property "${key}".`);
    }
  }

  if (input.version !== undefined && input.version !== '1.0') {
    errors.push('Root "version" must be "1.0".');
  }

  if (!Array.isArray(input.layers) || input.layers.length === 0) {
    errors.push('"layers" must be a non-empty array.');
    return { valid: false, errors };
  }

  if (input.layers.length > 16) {
    errors.push('"layers" cannot exceed 16 layers.');
  }

  input.layers.forEach((layer, li) => {
    const prefix = `layers[${li}]`;
    if (!isPlainObject(layer)) {
      errors.push(`${prefix} must be an object.`);
      return;
    }

    for (const key of Object.keys(layer)) {
      if (!ALLOWED_LAYER_KEYS.has(key)) {
        errors.push(`${prefix} has unsupported property "${key}".`);
      }
    }

    if (
      typeof layer.shape !== 'string' ||
      !(VALID_SHAPES as readonly string[]).includes(layer.shape)
    ) {
      errors.push(
        `${prefix}.shape must be one of: ${VALID_SHAPES.join(', ')}.`,
      );
    }

    if (!isPlainObject(layer.params)) {
      errors.push(`${prefix}.params must be an object.`);
    } else {
      for (const pKey of Object.keys(layer.params)) {
        if (!ALLOWED_PARAM_KEYS.has(pKey)) {
          errors.push(`${prefix}.params has unknown key "${pKey}".`);
        } else {
          const val = layer.params[pKey];
          if (pKey === 'wireframe' || pKey === 'closed') {
            if (typeof val !== 'boolean') {
              errors.push(`${prefix}.params.${pKey} must be boolean.`);
            }
          } else if (typeof val !== 'number' || !Number.isFinite(val)) {
            errors.push(`${prefix}.params.${pKey} must be a finite number.`);
          }
        }
      }
    }

    if (!Array.isArray(layer.mappings)) {
      errors.push(`${prefix}.mappings must be an array.`);
    } else {
      layer.mappings.forEach((m, mi) => {
        const mp = `${prefix}.mappings[${mi}]`;
        if (!isPlainObject(m)) {
          errors.push(`${mp} must be an object.`);
          return;
        }
        for (const mKey of Object.keys(m)) {
          if (!ALLOWED_MAPPING_KEYS.has(mKey)) {
            errors.push(`${mp} has unsupported property "${mKey}".`);
          }
        }
        if (
          typeof m.signal !== 'string' ||
          !(VALID_SIGNALS as readonly string[]).includes(m.signal)
        ) {
          errors.push(
            `${mp}.signal must be one of: ${VALID_SIGNALS.join(', ')}.`,
          );
        }
        if (
          typeof m.to !== 'string' ||
          !(VALID_TARGETS as readonly string[]).includes(m.to)
        ) {
          errors.push(`${mp}.to must be one of: ${VALID_TARGETS.join(', ')}.`);
        }
        if (m.range !== undefined) {
          if (
            !Array.isArray(m.range) ||
            m.range.length !== 2 ||
            typeof m.range[0] !== 'number' ||
            typeof m.range[1] !== 'number' ||
            !Number.isFinite(m.range[0]) ||
            !Number.isFinite(m.range[1])
          ) {
            errors.push(`${mp}.range must be a [min, max] tuple of numbers.`);
          }
        }
        if (
          m.curve !== undefined &&
          (typeof m.curve !== 'string' ||
            !(VALID_CURVES as readonly string[]).includes(m.curve))
        ) {
          errors.push(`${mp}.curve must be one of: lin, log, exp.`);
        }
        for (const k of ['smooth', 'attack', 'decay'] as const) {
          if (m[k] !== undefined) {
            const v = m[k];
            if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v >= 1) {
              errors.push(`${mp}.${k} must be a number in [0, 1).`);
            }
          }
        }
      });
    }
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    scene: input as unknown as SceneConfig,
  };
}
