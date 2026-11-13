/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo, useState } from 'react';
import sceneSchema from '../shared/scene.schema.json';
import {
  VALID_CURVES,
  VALID_SHAPES,
  VALID_SIGNALS,
  VALID_TARGETS,
  validateSceneStructure,
} from './utils/schemaPreviewCheck';

type TabId = 'architecture' | 'schema' | 'protocol' | 'validator';

const PROMPT_EXAMPLE_JSON = JSON.stringify(
  {
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
  },
  null,
  2,
);

const FOLDER_TREE = `sc-viz-studio/
├── index.html                 # Entrada HTML de Vite
├── metadata.json              # Metadatos de la app
├── package.json               # Dependencias frontend
├── shared/
│   └── scene.schema.json      # JSON Schema Draft-07
├── docs/
│   └── architecture-phase1.md # Arquitectura y protocolos
├── src/
│   ├── types/
│   │   ├── scene.ts           # Tipos TS del esquema
│   │   └── protocol.ts        # Contratos OSC, WS y 0..1
│   ├── engine/                # [F2] Señales, simulador, Ajv
│   ├── renderer/              # [F2] WebGL Three.js @ 60fps
│   └── components/            # [F2] Medidores y editor
├── backend/                   # [F3] Django + Channels + OSC
├── supercollider/             # [F4] SynthDef, Pbind, OSCdef
└── tests/                     # [F5] Unitarias + OSC sintético`;

const OSC_ANALYSIS_ROWS = [
  { idx: '0', name: 'amp', type: 'float32', range: '0.0 .. 1.0+', ugen: 'Amplitude.kr(mix, 0.01, 0.08)' },
  { idx: '1', name: 'loudness', type: 'float32', range: '0.0 .. 64.0 sones', ugen: 'Loudness.kr(fftChain)' },
  { idx: '2', name: 'pitchHz', type: 'float32', range: '20.0 .. 20000.0 Hz', ugen: 'Pitch.kr(mix)[0]' },
  { idx: '3', name: 'pitchConf', type: 'float32', range: '0.0 .. 1.0', ugen: 'Pitch.kr(mix)[1]' },
  { idx: '4', name: 'centroidHz', type: 'float32', range: '20.0 .. 20000.0 Hz', ugen: 'SpecCentroid.kr(fftChain)' },
  { idx: '5', name: 'flatness', type: 'float32', range: '0.0 .. 1.0', ugen: 'SpecFlatness.kr(fftChain)' },
  { idx: '6', name: 'onset', type: 'float32', range: '0.0 o 1.0', ugen: 'Onsets.kr(fftChain, 0.5, \\rcomplex)' },
  { idx: '7..22', name: 'band0..band15', type: '16 x float32', range: '0.0 .. 1.0+', ugen: '16 bandas logarítmicas FFT (30 Hz - 16 kHz)' },
];

const WS_FRAMES = [
  {
    type: 'Análisis (t: "a")',
    freq: '30 - 60 Hz',
    sample: '{"t":"a","ts":1731490000123,"d":[0.42,12.4,440.0,0.96,1850.5,0.12,1.0,0.71,0.65,...]}',
  },
  {
    type: 'Nota On (t: "n")',
    freq: 'Por evento Pbind / Synth',
    sample: '{"t":"n","ts":1731490000140,"id":1004,"inst":"fmBell","f":523.25,"a":0.65,"dur":1.2,"pan":-0.25}',
  },
  {
    type: 'Nota Off (t: "o")',
    freq: 'Al liberar nodo sostenido',
    sample: '{"t":"o","ts":1731490001340,"id":1004}',
  },
  {
    type: 'Estado (t: "s")',
    freq: '1 Hz heartbeat',
    sample: '{"t":"s","ts":1731490005000,"osc":true,"rate":60}',
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('architecture');
  const [jsonDraft, setJsonDraft] = useState<string>(PROMPT_EXAMPLE_JSON);

  const validation = useMemo(() => {
    try {
      const parsed = JSON.parse(jsonDraft);
      return { parseError: null, ...validateSceneStructure(parsed) };
    } catch (err) {
      return {
        parseError: err instanceof Error ? err.message : 'JSON inválido',
        valid: false,
        errors: [] as string[],
        scene: undefined,
      };
    }
  }, [jsonDraft]);

  const loadInvalidSample = () => {
    setActiveTab('validator');
    setJsonDraft(
      JSON.stringify(
        {
          layers: [
            {
              shape: 'cube',
              params: { turns: 5 },
              mappings: [{ signal: 'amp', to: 'radius' }],
              executableCode: 'console.log(1)',
            },
          ],
        },
        null,
        2,
      ),
    );
  };

  const restoreExample = () => {
    setActiveTab('validator');
    setJsonDraft(PROMPT_EXAMPLE_JSON);
  };

  return (
    <div className="min-h-screen bg-[#0b0d12] text-slate-200 flex flex-col">
      <header className="border-b border-slate-800/80 bg-[#0f131b]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-8">
          <span className="text-lg font-semibold tracking-tight text-white whitespace-nowrap shrink-0">
            SC-Viz Studio
          </span>

          <nav className="flex items-center gap-1 bg-[#0b0d12] p-1 rounded-lg border border-slate-800/80" aria-label="Secciones de Fase 1">
            {(
              [
                { id: 'architecture', label: 'Arquitectura' },
                { id: 'schema', label: 'Esquema JSON' },
                { id: 'protocol', label: 'Protocolo OSC / WS' },
                { id: 'validator', label: 'Validador' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <button
            type="button"
            onClick={restoreExample}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            Probar ejemplo en validador
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-8">
        <section className="border-b border-slate-800/80 pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <p className="text-xs font-mono text-amber-400">
              Fase 1 de 5 · Contrato de arquitectura, esquema y protocolo
            </p>
            <h1 className="text-2xl md:text-3xl font-semibold text-white tracking-tight">
              Especificación base para visualización WebGL en tiempo real desde SuperCollider
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Esta vista muestra los contratos reales de la Fase 1 ya creados en el repositorio. La interfaz completa con motor WebGL y simulador se construirá en la Fase 2 tras tu confirmación.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-6 text-right font-mono tabular-nums shrink-0">
            <div>
              <div className="text-xs text-slate-400">Formas</div>
              <div className="text-xl font-semibold text-white">{VALID_SHAPES.length}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Señales</div>
              <div className="text-xl font-semibold text-white">{VALID_SIGNALS.length}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Floats OSC</div>
              <div className="text-xl font-semibold text-white">23</div>
            </div>
          </div>
        </section>

        {activeTab === 'architecture' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <section className="lg:col-span-7 bg-[#121620] border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">
                  Árbol de carpetas completo
                </h2>
                <span className="text-xs font-mono text-slate-400">
                  Root Vite + shared + backend + supercollider
                </span>
              </div>
              <pre className="text-xs font-mono leading-6 text-slate-300 bg-[#0b0d12] border border-slate-800/80 rounded-lg p-4 overflow-x-auto">
                {FOLDER_TREE}
              </pre>
            </section>

            <section className="lg:col-span-5 bg-[#121620] border border-slate-800 rounded-xl p-5 space-y-4">
              <h2 className="text-base font-semibold text-white">
                Plan por fases y estado actual
              </h2>
              <ol className="space-y-3 text-sm">
                <li className="p-3 rounded-lg bg-[#0b0d12] border border-amber-500/40">
                  <div className="font-medium text-amber-300">
                    01. Contratos y protocolo (Activa)
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Árbol de carpetas, <span className="font-mono">shared/scene.schema.json</span>, tipos TS y especificación OSC/WebSocket.
                  </div>
                </li>
                <li className="p-3 rounded-lg bg-[#0b0d12] border border-slate-800">
                  <div className="font-medium text-slate-200">
                    02. Frontend WebGL en modo simulado (Pendiente)
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Almacén de señales 0..1, bucle 60 fps, medidores en vivo, editor de mapeos y generador simulado.
                  </div>
                </li>
                <li className="p-3 rounded-lg bg-[#0b0d12] border border-slate-800">
                  <div className="font-medium text-slate-200">
                    03. Backend Django + Channels + OSC (Pendiente)
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Listener UDP asíncrono, API REST de presets y endpoint <span className="font-mono">/api/scene/generate</span>.
                  </div>
                </li>
                <li className="p-3 rounded-lg bg-[#0b0d12] border border-slate-800">
                  <div className="font-medium text-slate-200">
                    04. SuperCollider e instrucciones macOS (Pendiente)
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    SynthDef maestro, captura de notas en Pbind, OSCdef y guía paso a paso.
                  </div>
                </li>
                <li className="p-3 rounded-lg bg-[#0b0d12] border border-slate-800">
                  <div className="font-medium text-slate-200">
                    05. Pruebas unitarias y puente sintético (Pendiente)
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Tests del validador, evaluación de mapeos y flujo OSC UDP sintético.
                  </div>
                </li>
              </ol>
            </section>
          </div>
        )}

        {activeTab === 'schema' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <section className="lg:col-span-4 bg-[#121620] border border-slate-800 rounded-xl p-5 space-y-5">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Vocabulario declarativo permitido
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  El esquema bloquea propiedades desconocidas (<span className="font-mono">additionalProperties: false</span>) para impedir código ejecutable.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-300">Formas ({VALID_SHAPES.length})</div>
                <div className="text-xs font-mono text-amber-300 leading-relaxed">
                  {VALID_SHAPES.join(' · ')}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-300">Señales 0..1 ({VALID_SIGNALS.length})</div>
                <div className="text-xs font-mono text-slate-300 leading-relaxed">
                  {VALID_SIGNALS.join(' · ')}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-300">Destinos visuales ({VALID_TARGETS.length})</div>
                <div className="text-xs font-mono text-slate-300 leading-relaxed">
                  {VALID_TARGETS.join(' · ')}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-300">Curvas ({VALID_CURVES.length})</div>
                <div className="text-xs font-mono text-slate-300">
                  {VALID_CURVES.join(' · ')}
                </div>
              </div>
            </section>

            <section className="lg:col-span-8 bg-[#121620] border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white font-mono">
                  shared/scene.schema.json
                </h2>
                <span className="text-xs font-mono text-slate-400">Draft-07</span>
              </div>
              <pre className="text-xs font-mono leading-5 text-slate-300 bg-[#0b0d12] border border-slate-800/80 rounded-lg p-4 max-h-[540px] overflow-auto">
                {JSON.stringify(sceneSchema, null, 2)}
              </pre>
            </section>
          </div>
        )}

        {activeTab === 'protocol' && (
          <div className="space-y-6">
            <section className="bg-[#121620] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-white">
                  OSC <span className="font-mono text-amber-400">/sc/analysis</span> (SuperCollider → Django UDP :57121)
                </h2>
                <span className="text-xs font-mono text-slate-400">23 argumentos float32 · 30–60 Hz</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 pr-4">Índice</th>
                      <th className="py-2.5 pr-4">Campo</th>
                      <th className="py-2.5 pr-4">Tipo</th>
                      <th className="py-2.5 pr-4">Rango / Unidad</th>
                      <th className="py-2.5">Origen UGen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-slate-200">
                    {OSC_ANALYSIS_ROWS.map((row) => (
                      <tr key={row.idx} className="hover:bg-slate-800/30">
                        <td className="py-2.5 pr-4 text-amber-300">[{row.idx}]</td>
                        <td className="py-2.5 pr-4 font-semibold">{row.name}</td>
                        <td className="py-2.5 pr-4 text-slate-400">{row.type}</td>
                        <td className="py-2.5 pr-4">{row.range}</td>
                        <td className="py-2.5 text-slate-400">{row.ugen}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-[#121620] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-white">
                  WebSocket <span className="font-mono text-amber-400">/ws/telemetry/</span> (Django Channels → Navegador)
                </h2>
                <span className="text-xs font-mono text-slate-400">JSON compacto sin ORM ni DRF</span>
              </div>

              <div className="space-y-3">
                {WS_FRAMES.map((frame) => (
                  <div
                    key={frame.type}
                    className="bg-[#0b0d12] border border-slate-800/80 rounded-lg p-3.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200">{frame.type}</span>
                      <span className="font-mono text-slate-400">{frame.freq}</span>
                    </div>
                    <pre className="text-xs font-mono text-amber-300 overflow-x-auto">
                      {frame.sample}
                    </pre>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'validator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <section className="lg:col-span-7 bg-[#121620] border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label htmlFor="scene-json-input" className="text-base font-semibold text-white">
                  JSON de escena para validar
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={restoreExample}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                  >
                    Restaurar ejemplo
                  </button>
                  <button
                    type="button"
                    onClick={loadInvalidSample}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                  >
                    Probar JSON inválido
                  </button>
                </div>
              </div>
              <textarea
                id="scene-json-input"
                value={jsonDraft}
                onChange={(e) => setJsonDraft(e.target.value)}
                rows={16}
                spellCheck={false}
                className="w-full font-mono text-xs leading-6 bg-[#0b0d12] text-slate-200 border border-slate-800 rounded-lg p-4 focus:outline-none focus:border-amber-500"
              />
            </section>

            <section className="lg:col-span-5 bg-[#121620] border border-slate-800 rounded-xl p-5 space-y-4">
              <h2 className="text-base font-semibold text-white">Resultado de validación</h2>

              {validation.parseError ? (
                <div className="p-4 rounded-lg bg-red-950/40 border border-red-800/70 text-xs font-mono text-red-300 space-y-1">
                  <div className="font-semibold text-red-200">Error de sintaxis JSON</div>
                  <div>{validation.parseError}</div>
                </div>
              ) : validation.valid ? (
                <div className="p-4 rounded-lg bg-emerald-950/30 border border-emerald-800/60 text-sm text-emerald-200 space-y-2">
                  <div className="font-semibold">Escena válida contra el esquema</div>
                  <div className="text-xs font-mono text-emerald-300/90">
                    Capas: {validation.scene?.layers.length ?? 0} · Mapeos totales:{' '}
                    {validation.scene?.layers.reduce((acc, l) => acc + l.mappings.length, 0) ?? 0}
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-red-950/40 border border-red-800/70 space-y-2">
                  <div className="text-sm font-semibold text-red-200">
                    Escena rechazada ({validation.errors.length})
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-xs font-mono text-red-300">
                    {validation.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-xs text-slate-400 leading-relaxed">
                Cualquier salida generada por el LLM en la Fase 3 que contenga formas no registradas, propiedades extra o código ejecutable es rechazada automáticamente antes de cargarse en el motor.
              </p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
