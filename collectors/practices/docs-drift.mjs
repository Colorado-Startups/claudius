// Docs drift: names the live Claude Code docs list that this pack's lists lack, and names the pack
// still lists that the docs dropped. The pages build reads the pages, so a new hook event or settings
// key shows on the Best practices tab without a person comparing the two.
//
// It fails open: a page that does not load, or whose tables changed shape, is an error the caller
// reports as "could not check", never a list of findings.
import { KNOWN_KEYS } from '../claude/claude-settings.mjs';
import { EVENTS } from './practices-rules.mjs';

const names = (md, row) => [...new Set([...String(md ?? '').matchAll(row)].map((m) => m[1]))];

// One row per list: the page, the table row that holds a name, the pack's own names, and the fewest
// names a sound read gives (the pages held 34 and 187 on 2026-11-27).
export const LISTS = [
  { list: 'hook events', url: 'https://code.claude.com/docs/en/hooks.md', row: /^\| `([A-Z][A-Za-z]+)` +\|/gm, own: EVENTS, least: 20 },
  // $schema is valid in a settings file and is not a setting, so the index leaves it out.
  { list: 'settings keys', url: 'https://code.claude.com/docs/en/settings-reference.md', row: /^\| \[`([A-Za-z][A-Za-z0-9_]*)`\]/gm, own: new Set([...KNOWN_KEYS].filter((k) => k !== '$schema')), least: 100 },
];

// Each name one side has and the other lacks, docs first, in page order.
export function drift(pages, lists = LISTS) {
  return lists.flatMap(({ list, url, row, own, least }) => {
    const docs = names(pages[url], row);
    if (docs.length < least) throw new Error(`${url} gave ${docs.length} ${list}, under ${least}: its tables changed shape`);
    return [
      ...docs.filter((n) => !own.has(n)).map((name) => ({ list, name, side: 'in the docs, not in the pack' })),
      ...[...own].filter((n) => !docs.includes(n)).map((name) => ({ list, name, side: 'in the pack, not in the docs' })),
    ];
  });
}

// Each page's text by URL, read one after the other. An error names the page it came from.
export async function readDocs(fetchPage = fetch, lists = LISTS) {
  const pages = {};
  for (const { url } of lists) {
    try {
      const res = await fetchPage(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      pages[url] = await res.text();
    } catch (err) {
      throw new Error(`${url}: ${err?.message ?? err}`);
    }
  }
  return pages;
}
