// The pack's one door to the Git Crafter engine. collect.mjs hands each collect() the engine's
// helpers as `lib` (Git Crafter quality/collectors/README.md); each collector passes it to useLib
// first, and every pack file takes engine names from here, never an engine file by path. Each name
// is a live binding, so a module may import it before any collect() runs. collect.mjs skips lib/.
export let causes, CHARTS, expandGlobs, ghClient, greenAt, loadTargets, managedClaudeMd, ownRepo, percentile, PROJECTS_DIR, projectMatch, prRefs, PULL_FIELDS, redact, redactText, remoteRepo, resolvePath, reverts, scoreMetric, TEXT_FIELDS;

// Takes the engine's names from lib; a call with none (a test that set lib already) keeps them.
export function useLib(lib) {
  if (!lib) return;
  ({ causes, CHARTS, expandGlobs, ghClient, greenAt, loadTargets, managedClaudeMd, ownRepo, percentile, PROJECTS_DIR, projectMatch, prRefs, PULL_FIELDS, redact, redactText, remoteRepo, resolvePath, reverts, scoreMetric, TEXT_FIELDS } = lib);
}
