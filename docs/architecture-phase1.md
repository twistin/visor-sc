# Phase 1: Architecture, Folder Tree, Scene Schema & OSC/WebSocket Protocol

## 1. Repository Folder Tree

```text
sc-viz-studio/
├── index.html                        # Vite HTML entry point
├── metadata.json                     # App metadata
├── package.json                      # Frontend dependencies & scripts (Vite, React, TS, Three.js, Ajv)
├── tsconfig.json                     # TypeScript configuration
├── vite.config.ts                    # Vite dev/build config + /api & /ws proxy to Django
├── shared/
│   └── scene.schema.json             # Canonical JSON Schema (Draft-07) for declarative scenes
├── src/
│   ├── main.tsx                      # React bootstrap
│   ├── App.tsx                       # Studio workspace shell
│   ├── index.css                     # Tailwind CSS v4 entry
│   ├── types/
│   │   ├── scene.ts                  # TypeScript types matching shared/scene.schema.json
│   │   └── protocol.ts               # OSC tuple, WebSocket messages & NormalizedSignalFrame
│   ├── engine/
│   │   ├── signalStore.ts            # 0..1 normalizer, attack/decay smoothing, voice envelope tracker
│   │   ├── simulator.ts              # Deterministic/interactive client-side fake SC audio generator
│   │   ├── mappingEvaluator.ts       # Pure curve (lin/log/exp), range & smoothing evaluation
│   │   ├── sceneValidator.ts         # Ajv validator against shared/scene.schema.json
│   │   ├── presets.ts                # Built-in curated presets (spiral, polygon, lissajous, etc.)
│   │   └── localNlFallback.ts        # Optional offline prompt-to-scene helper when backend is disconnected
│   ├── renderer/
│   │   ├── WebGLStage.tsx            # Mounted Three.js WebGLRenderer + decoupled 60fps RAF loop
│   │   └── layerBuilders.ts          # Procedural geometry builders (spiral, polygon, lissajous, rings, particles, grid)
│   └── components/
│       ├── LiveMeters.tsx            # RMS dB, 16-band spectrum, Hz + musical note, onset LED, active voices
│       ├── MappingEditor.tsx         # Layer & mapping inspector (signal, target, range, curve, attack/decay)
│       ├── PromptBar.tsx             # Natural language prompt -> /api/scene/generate
│       └── PresetDrawer.tsx          # Save / load presets & JSON import/export
├── backend/
│   ├── manage.py
│   ├── requirements.txt              # django, channels, daphne, python-osc, jsonschema, google-genai
│   ├── .env.example                  # LLM_PROVIDER, GEMINI_API_KEY, OSC_PORT, DJANGO_SECRET_KEY
│   ├── config/
│   │   ├── __init__.py
│   │   ├── settings.py
│   │   ├── urls.py
│   │   ├── asgi.py                   # ASGI lifespan starts async python-osc UDP listener
│   │   └── routing.py                # WebSocket route ws/telemetry/
│   ├── realtime/
│   │   ├── __init__.py
│   │   ├── osc_listener.py           # AsyncIOOSCUDPServer dispatching /sc/analysis & /sc/note -> channel layer
│   │   └── consumers.py              # AsyncWebsocketConsumer broadcasting compact JSON frames
│   └── scenes/
│       ├── __init__.py
│       ├── models.py                 # ScenePreset ORM model
│       ├── serializers.py            # REST serializers + JSON Schema validation
│       ├── views.py                  # GET/POST/DELETE presets + POST /api/scene/generate
│       ├── urls.py
│       ├── schema_validator.py       # Validates LLM output against shared/scene.schema.json
│       └── llm/
│           ├── base.py               # Abstract SceneGeneratorProvider interface
│           └── gemini_provider.py    # Structured-output LLM provider reading API key from env
├── supercollider/
│   ├── 01_analyzer.scd               # Master bus SynthDef with SendReply.kr @ 60 Hz
│   ├── 02_note_bridge.scd            # Pbind event type / helper sending /sc/note & /sc/note/off
│   ├── 03_osc_forwarder.scd          # OSCdef forwarding internal SC replies to Django UDP port
│   └── 04_demo_test.scd              # Self-contained musical test pattern
└── tests/
    ├── sceneValidator.test.ts        # Unit tests for JSON Schema validation
    ├── mappingEvaluator.test.ts      # Unit tests for curves, clamping, attack/decay smoothing
    └── backend_osc_bridge_test.py    # Synthetic OSC UDP -> ASGI consumer integration test
```

## 2. OSC Message Specification (SuperCollider -> Django UDP)

Default target: `127.0.0.1:57121` (configurable via `OSC_HOST` / `OSC_PORT` env vars).

### A. `/sc/analysis` (30–60 Hz continuous master bus stream)
Sent via `SendReply.kr(Impulse.kr(60), '/sc/analysis/internal', [...])` and forwarded by `OSCdef` with `NetAddr` as **23 `float32` arguments**:

| Index | Name | Range / Units | SuperCollider UGen |
|---:|---|---|---|
| `0` | `amp` | `0.0 .. 1.0+` (linear) | `Amplitude.kr(mix, 0.01, 0.08)` |
| `1` | `loudness` | `0.0 .. 64.0` (sones) | `Loudness.kr(fftChain)` |
| `2` | `pitchHz` | `20.0 .. 20000.0` (Hz) | `Pitch.kr(mix)[0]` |
| `3` | `pitchConf` | `0.0 .. 1.0` | `Pitch.kr(mix)[1]` |
| `4` | `centroidHz` | `20.0 .. 20000.0` (Hz) | `SpecCentroid.kr(fftChain)` |
| `5` | `flatness` | `0.0 .. 1.0` | `SpecFlatness.kr(fftChain)` |
| `6` | `onset` | `0.0` or `1.0` | `Onsets.kr(fftChain, 0.5, \rcomplex)` |
| `7..22` | `band0..band15` | `0.0 .. 1.0+` (16 log FFT bands) | Custom 16-band `FFT` / `BPF` bank energy |

### B. `/sc/note` (Event-driven per-note telemetry)
Sent from `Pbind` (custom `\note` / `finish` hook) or `Synth` trigger:

| Index | Name | OSC Type | Value |
|---:|---|---|---|
| `0` | `nodeId` | `int32` (`i`) | SC `nodeID` (or `-1` if pattern-level) |
| `1` | `instrument` | `string` (`s`) | SynthDef name (e.g. `"acidLead"`) |
| `2` | `freq` | `float32` (`f`) | Note frequency in Hz |
| `3` | `amp` | `float32` (`f`) | Note linear amplitude (`0..1+`) |
| `4` | `dur` | `float32` (`f`) | Note duration in seconds |
| `5` | `pan` | `float32` (`f`) | Stereo pan (`-1.0 .. 1.0`) |

### C. `/sc/note/off` (Optional early voice release)
| Index | Name | OSC Type | Value |
|---:|---|---|---|
| `0` | `nodeId` | `int32` (`i`) | SC `nodeID` |

## 3. WebSocket Message Specification (Django Channels -> Browser)

Endpoint: `ws://<host>:8000/ws/telemetry/` (group: `sc_telemetry`).
Messages are compact single-line JSON (`separators=(",", ":")`) without ORM or DRF overhead.

- **Analysis (`t: "a"`)**:
  `{"t":"a","ts":1731490000123,"d":[amp,loudness,pitchHz,pitchConf,centroidHz,flatness,onset,b0,...,b15]}`
- **Note On (`t: "n"`)**:
  `{"t":"n","ts":1731490000140,"id":1004,"inst":"fmBell","f":523.25,"a":0.65,"dur":1.2,"pan":-0.25}`
- **Note Off (`t: "o"`)**:
  `{"t":"o","ts":1731490001340,"id":1004}`
- **Stream Status (`t: "s"`, 1 Hz heartbeat)**:
  `{"t":"s","ts":1731490005000,"osc":true,"rate":60}`
