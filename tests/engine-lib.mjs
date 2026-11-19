// node --import ./tests/engine-lib.mjs: hands the pack's tests the engine's lib, the module collect.mjs
// hands each collect() (collectors/lib/engine.mjs). GIT_CRAFTER names the engine checkout (tests/engine-tests.sh).
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { useLib } from '../collectors/lib/engine.mjs';

if (!process.env.GIT_CRAFTER) throw new Error('GIT_CRAFTER must name a Git Crafter checkout');
useLib(await import(pathToFileURL(join(process.env.GIT_CRAFTER, 'quality', 'collectors', 'lib', 'index.mjs')).href));

// The engine's map check, the one an adopter's pages build runs on each pack map (tests/maps.check.mjs).
export const { checkMaps } = await import(pathToFileURL(join(process.env.GIT_CRAFTER, 'pages', 'checks.mjs')).href);
