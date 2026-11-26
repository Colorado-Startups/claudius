// Prints the public Quality page's master score and its work queue, one line each, from the run the build scored.
// A cloud thread cannot reach the deployed page and the build log held counts only, so the score was unreadable
// there. Every id, value and goal printed is already on the public page; no address or path is read.
//
//   node quality/score-log.mjs <engine dir> [--config quality/public/config.json]
//
// <engine dir> is the Git Crafter checkout the pages action runs from. It never fails the build: a missing engine
// or run prints one line and exits 0.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// One work-queue row: the master points it adds, the tab, the metric, its status and value against its goal.
export const queueLine = (q) => `  +${q.gain} ${q.tab} ${q.def.id} ${q.status} ${JSON.stringify(q.entry?.value)}${q.def.unit ? ` ${q.def.unit}` : ''} (goal ${q.def.goal}, ${q.def.direction === 'lower' ? 'at most' : 'at least'})`;

// The score line and the queue lines for scored tabs, as plain text.
export function scoreLines(overall, queue) {
  const { master, quality, speed, consumption } = overall;
  const head = `score ${master.score} (quality ${quality.score}, speed ${speed.score}, consumption ${consumption.score}); ${master.metricsMeasured} of ${master.metricsTotal} metrics read`;
  return [head, queue.length ? `${queue.length} metric(s) short of their goal, by master points gained:` : 'every metric read meets its goal', ...queue.map(queueLine)];
}

// Scores the run in the config's data folder the way the page does, and returns the lines to print.
export async function scoreRun(engine, configFile) {
  const load = (path) => import(pathToFileURL(join(engine, path)).href);
  const [{ loadConfig }, { readInputs }, score, { overall, workQueue }] = await Promise.all([load('quality/config.mjs'), load('quality/build.mjs'), load('quality/score.mjs'), load('quality/render/model.mjs')]);
  const config = loadConfig({ file: configFile, ci: true });
  const inputs = readInputs(config);
  if (inputs.code) return ['no run to score yet'];
  const metrics = score.mergeMetrics(inputs.local, inputs.latest);
  const reviews = score.newestReviews(inputs.reviewHistory);
  const results = config.tabs.map(([tab]) => score.scoreTab(tab, inputs.defs, metrics, reviews));
  return scoreLines(overall(results), workQueue(results));
}

async function main() {
  const [engine, flag, file] = process.argv.slice(2);
  if (!engine || !existsSync(join(engine, 'quality/score.mjs'))) return console.log(`score-log: no engine at ${engine ?? '(none given)'}; skipped`);
  try {
    console.log((await scoreRun(engine, flag === '--config' ? file : 'quality/public/config.json')).join('\n'));
  } catch (err) {
    console.log(`score-log: ${String(err?.message ?? err).split('\n')[0].slice(0, 160)}; skipped`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
