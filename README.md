# Park-Core

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Cannon-es](https://img.shields.io/badge/Cannon--es-9B59B6)](https://pmndrs.github.io/cannon-es/)
[![License: MIT](https://img.shields.io/badge/License-MIT-9B59B6)](LICENSE)

Park-Core is a browser-based 3D parking simulator prototype for practicing
low-speed maneuvers and spatial awareness. Its learner-facing interface is in
Vietnamese.

![Park-Core lesson and vehicle selection screen](docs/images/park-core-main.png)

## What it includes

- Five guided parking lessons with measured outcomes, attempt recaps, and
  success-only stage progression.
- A separate free-drive sandbox, Sedan and CUV prototypes, and roadside and
  garage environments.
- First- and third-person views, mirrors, an overhead view, and proximity
  sensors.
- Keyboard and calibrated Gamepad API / simulation-wheel input.
- Progress, settings, and completed-attempt history saved locally in the
  browser.

## Run locally

**Prerequisite:** Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`.

```powershell
npm ci
npm run dev
```

Open the local URL printed by Vite. To run checks:

```powershell
npm test
npm run typecheck
npm run build
```

Browser acceptance tests run in Chromium and Firefox. Install their browsers
once if needed, then run the suite:

```powershell
npx playwright install chromium firefox
npm run test:browser
```

## Controls

Keyboard is selected by default:

- `W` / `Up`: throttle; `S` / `Down`: brake.
- `A` / `D` or `Left` / `Right`: steer; mouse: look around.
- Hold the brake and press `1` / `2` / `3` / `4` to select `P` / `R` / `N` /
  `D`.
- `Space`: parking brake; `Q` / `E`: indicators; `Escape`: pause.

For a gamepad or simulation wheel, select the Gamepad input source and complete
the in-app calibration before starting or resuming a session.

## Prototype limits

The simulator, scenarios, and generated 3D assets are prototypes. Software
acceptance does not establish instructor approval, supported-hardware
compatibility, learner competence, or training readiness. The simulator is
not a substitute for qualified instruction or supervised real-world practice.

## Project documentation

- [Technical design](docs/tech-design.md)
- [Detailed design](docs/detail-design.md)
- [Implementation roadmap](docs/implementation-plan.md)
- [Phase 5 design](docs/phase-5-detail-design.md) ·
  [Phase 5 implementation plan](docs/phase-5-implementation-plan.md)
- [Phase 6 design](docs/phase-6-detail-design.md) ·
  [Phase 6 implementation plan](docs/phase-6-implementation-plan.md)
- [Prototype asset pipeline and provenance](docs/asset-pipeline.md)

## License

Project-owned source, original prototype assets, and documentation are
available under the [MIT License](LICENSE). Third-party dependencies and tools
remain under their respective licenses.
