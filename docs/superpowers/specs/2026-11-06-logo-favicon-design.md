# Park-Core Logo and Favicon Design

## Intent

Help learners recognize Park-Core immediately as a parking-practice simulator.

## Design

Use a simple top-down car aligning with a marked parking space, with one clear
guidance cue. Keep the existing dark background and amethyst accent. The
existing “Park-Core” menu heading remains the wordmark; add the mark beside it
without changing learner-facing copy or menu behavior.

## Approaches

- **One shared SVG mark (selected):** use the same lightweight, scalable mark
  in the menu and as the browser favicon. This keeps the app and browser tab
  visually consistent without adding dependencies.
- **Separate logo and favicon SVGs:** permits size-specific detail but
  duplicates artwork and can drift.
- **Multi-size raster favicon set:** broad legacy format coverage, at the cost
  of extra generated assets and maintenance not needed by this app.

## Scope and constraints

- Add one SVG asset and reference it from the menu and `index.html`.
- Keep the menu heading’s text accessible and preserve the existing page title.
- Use the current high-contrast dark and amethyst palette.
- Do not change lessons, the driving HUD, or other application behavior.
- Keep the implementation native to the existing Vite app; add no packages.

## Implementation details left to the builder

Choose a compact SVG viewBox and CSS sizing that remain legible as a favicon and
as a menu mark. Treat the adjacent mark as decorative because the existing
heading supplies the accessible name.
