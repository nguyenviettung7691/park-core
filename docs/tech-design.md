# Park-Core: Technical Design Document

## 1. Project Overview & Architecture

**Objective:** A web-based 3D first-person/third-person automatic car parking simulator focused on guidance and spatial training, supporting Sim Wheel devices via the HTML5 Gamepad API.
**Development Constraint:** Architected strictly to remain under the GitHub Copilot Pro+ $70/month usage limit by aggressively optimizing 3D physics scope and avoiding complex real-time shader generation.

**Tech Stack:**

* **Core Engine:** Three.js (WebGL rendering), targeting 1440p at 60 Hz (p95 <=17.5 ms, mean >=57 FPS, zero loss; 144 Hz is optional). The target is not yet measured on reference hardware; see the benchmark page `/benchmark.html` and `docs/detail-design.md`.
* **Physics Engine:** Cannon-es (lightweight 3D physics) for rigid body dynamics, raycast vehicle physics, and bounding box collisions.
* **Language & Tooling:** TypeScript and Vite for strict typing and rapid prototyping within VS Code/Cursor AI environments.
* **UI Framework:** Vanilla DOM elements overlaying the WebGL canvas to minimize framework overhead.
* **Design Language:** High-contrast minimalist UI utilizing Amethyst Purple (`#9B59B6`) for active UI states, target parking zones, and trajectory lines.
* **Target Platforms:** Cross-platform browser support, ensuring WebGL compatibility across both Windows 11 and Linux environments.

## 2. Vehicle Profiles & Physics

The simulator restricts the drivetrain to automatic transmissions (P, R, N, D), heavily relying on simulated idle creep to mimic the low-speed maneuvering required for parking. Steering utilizes Ackermann geometry via the Cannon-es `RaycastVehicle`.

**Vehicle Form Factors:**

* **Standard Sedan:** Lower center of gravity, longer wheelbase, and standard turning radius.
* **B-Segment CUV (Crossover):** Elevated driver eye-level, higher ground clearance, and a shorter wheelbase, explicitly modeled around the spatial dimensions of modern urban crossovers like the Toyota Yaris Cross, Mitsubishi Xforce, or Honda HR-V.

## 3. Vision & Support Systems

* **Camera POVs:**
* **1st Person:** Fixed at the driver's head position with mouse-look capability to check blind spots.
* **3rd Person:** Orbit camera with collision detection against environmental walls.


* **Mirrors:** Low-resolution RenderTargets applied to plane geometries for the rearview and convex side mirrors, capped at 15 FPS to conserve draw calls.
* **360-Degree Camera System:** Simulated using a single high-altitude orthographic camera looking directly down at the vehicle, composited into the HUD.
* **Parking Sensors:** Raycasters mounted on the front and rear bumpers. The UI displays green/yellow/red proximity arcs with corresponding audio beeps based on distance to obstacles.

## 4. Hardware Input & Controls

* **Standard Input:** WASD/Arrows for throttle and steering, Mouse for camera look.
* **Sim Wheel / Gamepad API:**
* `axes[0]`: Steering wheel input.
* `buttons[6]` (L2): Brake pedal.
* `buttons[7]` (R2): Throttle pedal.
* `buttons[4]` requests R and `buttons[5]` requests D (explicit edge-triggered requests, not a toggle).

## 5. Environments & Progression

The product target uses static lighting and five sequential parking lessons. Phase 5 delivered the asset-loading and progression foundation: four original prototype GLBs, validated asynchronous loading, versioned local records, and a stage selector. Phase 6 adds the five lesson runtimes and measured outcomes: Stage 1 is the Garage forward-bay lesson, and only confirmed success unlocks the next stage. `Lái tự do` retains the separate Garage sandbox without lesson completion. These prototype assets do not claim production art, image-based light bakes, dynamically driveable routes, or validated training readiness.

* **Environment 1: Urban Roadside.** Static daylight. Focuses on parallel parking between low-poly vehicles and navigating standard curbs.
* **Environment 2: Underground Garage.** Baked ambient occlusion and point lights. Focuses on reverse-perpendicular parking, tight concrete pillars, and spatial alignment using the 360-degree camera.
* **Failure State:** In lessons, collision and other failure boundaries stop the attempt and show its recap; Retry starts a fresh attempt. Sandbox contact stops driving until Reset or Menu.

**Delivery:** The prototype is a static Vite build (`dist`) hosted at the root of `https://park-core.nguyenviettung.id.vn/` through GitHub Pages and Actions. Pull requests and `main` pushes are validated (unit, typecheck, build, Chromium browser tests and a production-preview smoke test of built JS/CSS/GLBs); only a passing `main` run deploys, with manual reruns. Firefox automated coverage is excluded by owner decision (2026-11-05), not a timing fix or compatibility certification. Setup, domain/DNS/HTTPS and recovery steps are in the README. Live availability remains unverified until the owner enables Pages and a deployment is observed.

## 6. AI Implementation Plan & Model Routing

To maximize the Copilot Pro+ token budget, prompt tasks must be strictly routed based on model capability and cost.

**AI Model Tier Strategy**

* **Tier 1: Premium (e.g., Claude 3 Opus):** Highest token cost. Reserve strictly for complex 3D mathematics, physics tuning, and architectural foundations where hallucinations cause hours of debugging.
* **Tier 2: Standard (e.g., Claude 3.5 Sonnet):** Best capability-to-cost ratio. Use for core game logic, state management, and UI integration.
* **Tier 3: Lightweight (e.g., Claude 3 Haiku / GPT-4o-mini):** Lowest cost. Use for boilerplate generation, CSS styling, repetitive data structures, and file scaffolding.

Here is the detailed task breakdown mapped to the optimal AI model tiers.

**Phase 0: Draft Detail Design Document**

* **Define Physics Parameters & Kinematics:** Outline the mass, friction coefficients, suspension stiffness, and Ackermann steering formulas for the Sedan and CUV.
* *Model:* Premium (Opus). Physics parameter relationships require deep reasoning to prevent unstable simulation behavior.

* **Define Game State Interfaces:** Write the TypeScript interfaces for the progression system, vehicle telemetry, and sensor data structures.
* *Model:* Standard.

* **UI/UX Blueprint:** Specify the DOM overlay hierarchy, CSS Grid layouts, and the implementation of the Amethyst Purple accent color for targets and HUD elements.
* *Model:* Lightweight.

**Phase 1: Draft Implement Plan Document**

* **Generate Prompt Templates:** Draft strict system prompts to be used in the implementation phase (e.g., "Write Three.js code without explanations, use TypeScript strict mode").
* *Model:* Standard.

* **Task Sequencing & Chunking:** Break down the implementation into highly isolated files (e.g., `VehicleController.ts`, `RenderEngine.ts`) so context windows stay small during coding.
* *Model:* Standard.

* **Asset Pipeline Setup:** Define the exact export settings required for Blender (GLTF format, baked lighting textures, Z-up to Y-up conversion).
* *Model:* Lightweight.

**Phase 2: Design & Scaffolding**

* **Tasks:** Initialize Vite, TypeScript configuration, Three.js rendering loop, base Amethyst Purple CSS theme, and HUD DOM containers. Write TypeScript interfaces for game states and vehicle telemetry. Phase 2 delivers only a static, non-drivable renderer preview (no physics, input or assets); see [the phase design](phase-2-detail-design.md) and [the phase plan](phase-2-implementation-plan.md).
* **Model Routing:** Lightweight (Claude 3 Haiku / GPT-4o-mini) for boilerplate and CSS. Standard (Claude 3.5 Sonnet) for TypeScript interfaces.

**Phase 3: Physics & Input Mechanics**

* **Tasks:** Implement Cannon-es world, configure the `RaycastVehicle` (suspension, friction, Ackermann steering), and implement the Gamepad API polling loop.
* **Phase 3 scope:** implemented drivable physics prototype (real `RaycastVehicle` for both vehicles, keyboard and explicitly calibrated Gamepad input, external follow camera, truthful telemetry); no lessons, mirrors, sensors or assets. See the approved [phase design](phase-3-detail-design.md), [phase plan](phase-3-implementation-plan.md) and [measurement report](phase-3-measurements.md), including the owner-approved version-specific braking correction. Software gates: 167 unit/DOM/physics tests, typecheck/build, 12 Chromium/Firefox tests; independent review and its verified correction complete, merged into local `main` with owner approval. Nothing pushed.
* **Model Routing:** Premium (Claude 3 Opus) for Cannon-es physics tuning to prevent mathematical hallucinations. Standard for input polling.

**Phase 4: Vision & Support Systems**

* **Phase 4 scope:** Add profile-anchored driver and collision-adjusted chase views, bounded mouse-look with pointer-lock safety, rear/side mirrors, a simulated overhead view, estimated trajectory aids, and front/rear proximity sensors with labeled visual warnings and optional audio. Integrate them into the existing preview loop, renderer and Vietnamese HUD.
* **Prototype boundary:** Current cockpit/mirror geometry and anchors are placeholders. Trajectory and sensors are guidance only; this phase does not deliver lessons, parking evaluation, release assets, validated vehicle/hardware support or training-readiness evidence. See [the phase detail design](phase-4-detail-design.md) and [the phase implementation plan](phase-4-implementation-plan.md).
* **Constraints:** Keep one WebGL renderer and the preview's single simulation/animation loop. Bound mirror updates to 15 Hz, overhead updates to 30 Hz and sensor/DOM updates to 20 Hz. Audio unlocks only after a deliberate user action and stops on pause, outcome and disposal; visual warnings remain available when audio is muted or unavailable.
* **Model Routing:** Premium for camera/projection and trajectory geometry; Standard for preview lifecycle, sensor/audio behavior and cross-system verification; Lightweight only for repetitive CSS/DOM scaffolding after interfaces and behavior are fixed.
* **Validation status:** Prototype software gates pass; labeled mirror-landmark, garage-wall, supported-Node, asset, wheel and reference-hardware validation remain pending. See the [phase detail design](phase-4-detail-design.md) and [phase plan](phase-4-implementation-plan.md) for evidence and limits.

**Phase 5: Assets & Progression Foundation — Implemented**

* **Delivered:** Original deterministic Sedan, CUV, Roadside and Garage GLBs; named anchor/dimension validation; explicit collider metadata; cancellable selected-pair loading and disposal; versioned progress/settings/calibration storage; contiguous stage locks; Stage 1 Garage sandbox.
* **Asset fidelity:** These are small low-poly vertex-color prototypes, not production vehicles or image-based light bakes. See [the Phase 5 detail design](phase-5-detail-design.md), [implementation plan](phase-5-implementation-plan.md), and [asset pipeline measurements](asset-pipeline.md).
* **Validation status:** Software checks are recorded in the Phase 5 implementation plan. Mirror sightlines, environment clearance, route feasibility, real-wheel behavior, supported-Node execution, reference-PC performance, production art and instructor review remain pending.

**Phase 6: Lessons & Parking Evaluation — Implemented and Merged Locally**

* **Delivered:** Five authored lesson scenarios, advisory checkpoints, full-envelope parking evaluation, collision/failure outcomes, uniform durable recaps, IndexedDB history, retry, and success-only contiguous progression. `Lái tự do` remains a separate Garage sandbox that cannot unlock stages.
* **Explicit boundary:** Geometric route witnesses and browser/software acceptance do not establish dynamic route drivability, instructor approval, vehicle or wheel support, reference-PC performance, production-art quality, learner competence, or training readiness.
* **Status and evidence:** Implemented on the isolated `phase-6-lessons-parking-evaluation` branch and merged into local `main` as `1f372bd` after owner approval; nothing was pushed. See the [Phase 6 detail design](phase-6-detail-design.md), [implementation plan](phase-6-implementation-plan.md), and [approved design](superpowers/specs/2026-11-04-phase-6-lessons-parking-evaluation-design.md). External validation remains pending.