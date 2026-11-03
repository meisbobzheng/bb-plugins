# bb-plugin-spec-search

Fetch 3GPP specifications from the official 3GPP FTP, index them by clause, and
search them from any bb thread.

## Use it

On first load the plugin queues the starter catalog: the newest Rel-19 version
of every spec for Cx, S6a, S6c, Sh and SGd, the shared basics, the other HSS
Diameter interfaces, security, NAS and SIP, and the network architecture. Run
`bb spec catalog` for the list and what each spec covers. They download one at
a time in the background.

- Ask an agent: "what does 29.228 B.1 say?" or "which spec is this paragraph
  from?". Agents use the `spec_*` tools, or `bb spec` in threads started before
  the plugin was installed.
- `bb spec show 29.228 B.1` prints a clause. `29.228 annex b`, `TS 29.272
  §7.3.2`, and `ts29328 6.1.2` work too.
- `bb spec search purge UE` searches clause titles and text. An exact phrase
  ranks first, then clauses with every word; words match as prefixes, so
  `regis` finds "registration". Add a spec number to search only that spec:
  `bb spec search 29.272 purge`.
- `bb spec identify "<passage>"` finds which clause a passage comes from and
  how much of it matches.
- In the [Launcher](../bb-plugin-launcher) (⌘K), type `29.228 B.1` or words
  from a spec: the clause is the top hit, the preview shows its text, `↵` asks
  an agent about it, and `⌘↵` copies it. A spec that is not indexed yet offers
  **Fetch <spec> from 3GPP**.

## CLI

```
bb spec search <query…> [--spec <spec>] [--limit <n>] [--json]
bb spec show <spec> <clause> [--deep] [--json]
bb spec identify <passage…> [--limit <n>] [--json]
bb spec fetch [specs…] [--rel <release>] [--wait] [--json]
bb spec add <files…> [--wait] [--json]
bb spec list [--json]
bb spec catalog [--json]
bb spec jobs [--limit <n>] [--json]
bb spec refresh [--wait] [--json]
bb spec remove <spec> [--json]
```

`fetch` with no specs queues the starter catalog again. `--rel` picks another
release; the default is 19. `add` indexes local files: a 3GPP `.zip`, `.docx`,
or Word 97 `.doc` (converted with macOS `textutil`). The spec number and
version come from the cover page, or from a 3GPP file name such as
`29228-j20.docx`. `--wait` waits for indexing to finish; otherwise the command
returns at once and `bb spec jobs` shows progress.

Every Monday at 06:00 the plugin checks the FTP for newer versions of the specs
it fetched, and `refresh` does the same now. A newer version replaces the old
one once it is fully indexed.

## Agent tools

| Tool | Does |
| --- | --- |
| `spec_search` | A spec and clause, words, or both; an empty query lists the indexed specs. |
| `spec_clause` | Read one clause with its parent and subclauses; `deep` adds the subclause text. |
| `spec_identify` | Find the clauses a passage comes from, with the share that matches. |
| `spec_fetch` | Download and index specs from the 3GPP FTP, waiting up to two minutes. |

The [skill](skills/spec-search/SKILL.md) tells agents to read a clause before
citing it.

## RPC

Other plugins and the app call these through `sdk.plugins.callRpc` with
`pluginId: "spec-search"`; [contract.ts](contract.ts) has the schemas.

| Method | Takes | Returns |
| --- | --- | --- |
| `search` | `{ query, limit }` | `{ hits, missing }`; `missing` names a spec in the query that is not indexed |
| `clause` | `{ spec, clause }` | `{ clause }` with its text, parent, and subclauses, or `null` |
| `fetch` | `{ spec }` | `{ status, note }` after fetching, waiting up to two minutes |

## How it works

- Downloads go only to `https://www.3gpp.org/ftp/Specs/latest/Rel-<n>/`.
  Redirects are checked hop by hop, and listings and archives have size limits
  and a timeout.
- Zip archives are read with Node's zlib under per-file and total size limits.
  Word XML is scanned for paragraphs, runs, and tables only, so no entities or
  external references are expanded.
- Headings in the Word heading styles become clauses: `B.1 General
  description`, `Annex B (informative): …`. Tables are kept as `cell | cell`
  rows so their text is searchable.
- Clauses live in the plugin's SQLite database
  (`<dataDir>/plugins/spec-search/data.db`) with an FTS5 index using the Porter
  stemmer. Clause lookups take under a millisecond and text searches a few
  milliseconds.
- Parsing and indexing yield to the event loop every few thousand XML tokens
  and every 200 clauses, so indexing a large spec such as 24.301 never stalls
  bb for more than a few tens of milliseconds. A new version is written beside
  the old one and switched in a single transaction.

## Develop

```
npm install
npm run check        # typecheck, tests, build
bb plugin install .
```
