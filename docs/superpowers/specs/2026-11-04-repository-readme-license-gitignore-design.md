# Repository README, License, and Ignore Rules

## Intent

Make Park-Core understandable and runnable from its GitHub repository, show
the current web app with a real screenshot and useful badges, state honest
prototype limitations, and provide clear reuse terms and maintainable ignore
rules.

## Goals and boundaries

- Add an English, contributor-facing `README.md` with a real screenshot of the
  app, technology/license badges, project summary, features, controls, setup,
  test/build commands, and links to the phase documentation.
- Add an MIT `LICENSE` for project-owned repository content, including original
  prototype assets and documentation. Third-party dependencies retain their
  own licenses.
- Extend the existing `.gitignore` without dropping its exclusions for
  dependencies, generated builds, browser reports, Superpowers artifacts, and
  worktrees. Add only relevant local secrets, logs, caches, and coverage
  output; keep an example environment file trackable.
- Capture a screenshot from the real running web app and store it at
  `docs/images/park-core-main.png`.
- Clearly state that the simulator and assets are prototypes and that software
  acceptance does not establish instructor approval, supported hardware,
  learner competence, or training readiness.

Non-goals: changing application behavior, publishing the package, adding CI or
badges that claim CI status, changing dependency licenses, or claiming the
prototype is a validated training product.

## Approaches

1. **One MIT license for all project-owned content (chosen):** simple
   repository-wide reuse terms consistent with the owner's request for broad
   reuse. Third-party packages remain under their respective licenses.
2. **Split code and creative-content licenses:** could make attribution terms
   for docs/art distinct, but adds complexity without a stated need.

## Implementation choices

- Keep the README focused on contributors and repository visitors; technical
  documentation and code identifiers are English, while the app screenshot
  naturally shows its Vietnamese learner-facing UI.
- Use a screenshot captured from the current real app rather than mock
  artwork. Reference it with a relative path so it renders on GitHub.
- Use stable project/technology/license badges only; no CI workflow exists.
- Preserve existing ignore behavior and avoid broad patterns that could hide
  source, assets, or user files.

## Remaining to builder

Choose concise README wording and badge URLs, capture the app screenshot at a
readable viewport, and validate links, screenshot existence, ignore behavior,
and whitespace. Do not modify the application or dependency manifests.
