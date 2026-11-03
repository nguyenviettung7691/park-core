# Park-Core: Technical Design Document

## 1. Project Overview & Architecture

**Objective:** A web-based 3D first-person/third-person automatic car parking simulator focused on guidance and spatial training, supporting Sim Wheel devices via the HTML5 Gamepad API.
**Development Constraint:** Architected strictly to remain under the GitHub Copilot Pro+ $70/month usage limit by aggressively optimizing 3D physics scope and avoiding complex real-time shader generation.

**Tech Stack:**

* **Core Engine:** Three.js (WebGL rendering), optimized for 1440p at 144Hz refresh rates.
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
* `buttons[4]/[5]`: Gear shifting (D/R toggle).

## 5. Environments & Progression

To prevent token exhaustion from generating complex branching logic and dynamic lighting, the game utilizes static baked lighting and a linear 5-stage sequential progression system tracked via `localStorage`.

* **Environment 1: Urban Roadside.** Static daylight. Focuses on parallel parking between low-poly vehicles and navigating standard curbs.
* **Environment 2: Underground Garage.** Baked ambient occlusion and point lights. Focuses on reverse-perpendicular parking, tight concrete pillars, and spatial alignment using the 360-degree camera.
* **Failure State:** Bounding box collisions trigger an immediate scenario fail and reset.

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
* **Model Routing:** Premium (Claude 3 Opus) for Cannon-es physics tuning to prevent mathematical hallucinations. Standard for input polling.

**Phase 4: Vision & Support Systems**

* **Tasks:** Create the orthographic camera setup for the 360-degree view, attach Cannon-es raycasters to vehicle bumpers, and map raycast distances to UI sensor arcs and audio.
* **Model Routing:** Premium for 3D-to-2D matrix projections (orthographic mapping). Standard for UI data binding.

**Phase 5: Environments & Assets**

* **Tasks:** Write GLTF loaders for the Sedan, CUV, Urban Roadside, and Underground Garage models. Apply pre-baked texture maps.
* **Model Routing:** Lightweight for repetitive asset loading scripts.

**Phase 6: Game Loop & Progression**

* **Tasks:** Implement the State Machine (`MainMenu`, `Playing`, `Success`, `Fail`), create trigger zones for parking target detection, and implement `localStorage` sequential unlocking.
* **Model Routing:** Standard for state machine logic. Lightweight for local storage management.