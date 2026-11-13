export type ShapeType =
  | 'spiral'
  | 'polygon'
  | 'lissajous'
  | 'rings'
  | 'particles'
  | 'grid';

export type SignalType =
  | 'amp'
  | 'loudness'
  | 'pitch'
  | 'pitchConf'
  | 'centroid'
  | 'flatness'
  | 'onset'
  | 'band'
  | 'voiceAmp'
  | 'voicePitch'
  | 'voiceCount';

export type VisualTarget =
  | 'radius'
  | 'scale'
  | 'rotationX'
  | 'rotationY'
  | 'rotationZ'
  | 'hue'
  | 'saturation'
  | 'lightness'
  | 'opacity'
  | 'pulse'
  | 'turns'
  | 'twist'
  | 'spread'
  | 'zDepth'
  | 'thickness'
  | 'pointSize'
  | 'freqX'
  | 'freqY'
  | 'phase'
  | 'sides'
  | 'displacement';

export type CurveType = 'lin' | 'log' | 'exp';
export type BlendMode = 'normal' | 'additive';

export interface LayerParams {
  points?: number;
  turns?: number;
  sides?: number;
  count?: number;
  ringCount?: number;
  rows?: number;
  cols?: number;
  freqX?: number;
  freqY?: number;
  phase?: number;
  radius?: number;
  innerRadius?: number;
  scale?: number;
  spread?: number;
  zDepth?: number;
  twist?: number;
  thickness?: number;
  pointSize?: number;
  hue?: number;
  saturation?: number;
  lightness?: number;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  displacement?: number;
  wireframe?: boolean;
  closed?: boolean;
}

export interface MappingConfig {
  id?: string;
  signal: SignalType;
  bandIndex?: number;
  voiceIndex?: number;
  to: VisualTarget;
  range?: [number, number];
  curve?: CurveType;
  smooth?: number;
  attack?: number;
  decay?: number;
  invert?: boolean;
  clamp?: boolean;
}

export interface LayerConfig {
  id?: string;
  name?: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  shape: ShapeType;
  params: LayerParams;
  mappings: MappingConfig[];
}

export interface SceneBackground {
  color?: string;
  trail?: number;
  fogDensity?: number;
}

export interface SceneCamera {
  distance?: number;
  fov?: number;
  autoOrbit?: boolean;
  orbitSpeed?: number;
}

export interface SceneConfig {
  version?: '1.0';
  name?: string;
  description?: string;
  background?: SceneBackground;
  camera?: SceneCamera;
  layers: LayerConfig[];
}

export interface ScenePresetRecord {
  id: string;
  name: string;
  description: string;
  scene: SceneConfig;
  createdAt: string;
  updatedAt: string;
}
