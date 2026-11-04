# GitHub Copilot Instructions for Park-Core

## Project Context & Objectives

- **Project Name:** Park-Core
- **Description:** Web-based 3D parking simulator (1st/3rd person) focused on training and spatial guidance.
- **Tech Stack:** TypeScript, Vite, Three.js (rendering), Cannon-es (physics).
- **Core Constraint:** Extreme token efficiency to remain under GitHub Copilot Pro+ limits. Code generation must avoid complex graphics, dynamic shaders, or heavy architectural abstractions.
- **Additional Context:** See the [technical design](../docs/tech-design.md).

## Token & Code Optimization Rules

- **Zero Fluff:** Provide raw, functional code without verbose explanations, conversational filler, or excessive inline comments.
- **Strict Typing:** Write strict TypeScript. Define interfaces for state, telemetry, and input beforehand. This reduces AI hallucination loops and saves debugging tokens.
- **Micro-Scoping:** Output only the specifically requested function or file. Never rewrite unchanged sections of a file.
- **Fallback Simplicity:** If a mathematical or 3D coordinate problem requires deep reasoning, default to the simplest hardcoded or static alternative to conserve Premium tier requests.

## Technical Implementation Rules

### Rendering (Three.js)

- Prioritize performance (1440p @ 144Hz target).
- **Lighting:** Use static baked lighting, `MeshBasicMaterial`, or simple uncast Ambient/Point lights. No dynamic shadows, weather, or day/night cycles.
- **Mirrors:** Implement rearview and side mirrors using RenderTargets, but cap their update rate to 15 FPS to conserve draw calls.
- **360 Camera:** Simulate via a single high-altitude orthographic camera facing downward, composited on top of the UI.
- **UI:** Use vanilla HTML/CSS DOM overlays. Avoid React/Vue/Svelte to minimize framework overhead.

### Physics (Cannon-es)

- Use `RaycastVehicle` for all vehicle mechanics.
- Implement Ackermann steering geometry.
- Drivetrain is automatic only (P, R, N, D). Simulate idle creep (moving forward slowly without throttle in D).
- Use simple bounding box colliders for environment mapping.
- **Parking Sensors:** Attach raycasters to front/rear bumpers mapped to UI proximity arcs.

### Hardware & Controls

- **Standard Input:** WASD/Arrows for throttle/steering. Mouse for camera look.
- **Gamepad API (Sim Wheels):**
  - `axes[0]` = steering wheel input.
  - `buttons[6]` (L2) = brake pedal.
  - `buttons[7]` (R2) = throttle pedal.
  - `buttons[4]` / `buttons[5]` = explicit gear requests (`buttons[4]` requests R, `buttons[5]` requests D).

## Design Language

- **Aesthetic:** High-contrast minimalist HUD.
- **Accent Color:** Amethyst Purple (`#9B59B6`). Use this for active states, target parking zones, and trajectory lines.
- **Color Restrictions:** Exclude blue, orange, and green from the main UI (except for standard green/yellow/red proximity sensor indicators).

## Development Phases Tracker

When asked to implement a feature, follow this progression. The numbering differs from the technical design, which also includes planning phases.

1. **Phase 1:** Setup Vite, Three.js, Purple CSS theme.
2. **Phase 2:** Cannon-es `RaycastVehicle` & Gamepad API loop.
3. **Phase 3:** Orthographic 360-camera & bumper raycast sensors.
4. **Phase 4:** Asset loading (Sedan, CUV, Urban Roadside, Underground Garage).
5. **Phase 5:** Versioned local progress/settings/calibration, five-stage selection and contiguous unlock foundation; lesson outcomes remain deferred.

Mapping: the technical design's "Phase 2: Design & Scaffolding" corresponds to Phase 1 above, not to this list's Phase 2 (Cannon-es/Gamepad).
The technical design's Phase 5 asset/progression foundation is implemented with prototype GLBs and Stage 1 sandbox entry; its Phase 6 lessons and parking evaluation are not yet implemented. See the [Phase 5 plan](../docs/phase-5-implementation-plan.md).
