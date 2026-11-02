# Refactoring record

## Baseline

The read-only audit found range parsing errors, unhandled stream failures,
unsafe JSON replacement, lost metadata during rescans, unsafe HTML interpolation,
unrestricted cross-origin management access, and incomplete resume/remote controls.

Checks run before application edits:

- Scanner regression tests: 2 passed, 3 failed (filename parsing, duplicate roots,
  subtitle association).
- Streaming regression tests: 3 passed, 2 failed (suffix/invalid ranges).
- ESLint: 24 findings. Most frontend unused-function reports were references from
  HTML event attributes; those require explicit integration rather than deletion.
- Prettier: 10 files needed formatting, including newly added checks.
- Knip: one unused export, `getLocalIpAddresses`.

The application initially had no tests or development-tool configuration.
Node 24 and Node 18 validation runtimes are downloaded to temporary directories;
application support remains Node 18+.

## Dependency decisions

All four production dependencies are used and retained. The existing Express 4
dependency ranges are preserved. Its transitive body-parser dependency receives
the compatible security patch reported by npm audit.

Knip, ESLint, and Prettier are development dependencies. The additional
eslint-plugin-html package extracts embedded scripts, and globals supplies
correct Node/browser global names. No test framework is added.
