// The pack's one door to the Git Crafter engine. collect.mjs hands each collect() the engine's
// helpers as `lib` (Git Crafter quality/collectors/README.md); each collector passes it to useLib
// first, and every pack file takes engine names from here, never an engine file by path. Each name
// is a live binding, so a module may import it before any collect() runs. collect.mjs skips lib/.
import { readFileSync } from 'node:fs';

// The tab ids a pack target may name: the pack's own (pack.json) and the engine tab one pack metric sits
// on. The engine's loadTargets knows only the engine's tabs and lib names none of them, so this door
// names both; a call may still pass its own tabIds.
const ENGINE_TABS = ['documentation'];
const PACK_TABS = JSON.parse(readFileSync(new URL('../../pack.json', import.meta.url), 'utf8')).tabs.map(([id]) => id);
const TAB_IDS = new Set([...PACK_TABS, ...ENGINE_TABS]);

export let causes, CHARTS, expandGlobs, ghClient, greenAt, loadTargets, managedClaudeMd, ownRepo, percentile, PROJECTS_DIR, projectMatch, prRefs, PULL_FIELDS, redact, redactText, remoteRepo, resolvePath, reverts, scoreMetric, TEXT_FIELDS;

// Takes the engine's names from lib; a call with none (a test that set lib already) keeps them.
export function useLib(lib) {
  if (!lib) return;
  ({ causes, CHARTS, expandGlobs, ghClient, greenAt, loadTargets, managedClaudeMd, ownRepo, percentile, PROJECTS_DIR, projectMatch, prRefs, PULL_FIELDS, redact, redactText, remoteRepo, resolvePath, reverts, scoreMetric, TEXT_FIELDS } = lib);
  const engineTargets = lib.loadTargets;
  loadTargets = (dir, options = {}) => engineTargets(dir, { tabIds: TAB_IDS, ...options });
}
