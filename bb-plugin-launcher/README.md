# bb-plugin-launcher

A Raycast-style launcher for bb. It replaces the ⌘K thread search with one
window for threads, projects, quick prompts, settings, and plugins.

## Use

- **Open:** `⌘K` (Ctrl+K elsewhere). The launcher catches the key before bb's
  quick palette does. Turn **Open with ⌘K** off in the plugin's settings to get
  bb's palette back; "Launcher: open" stays in the quick palette (`⌘⇧P`) and
  can be bound in Settings → Keyboard.
- **Home:** with an empty query you see Needs attention (waiting for input,
  errors, unread), Running, Pinned (projects and threads), Recent, Projects,
  and Commands. Needs attention, Running, and Pinned share the first six rows,
  so Recent always starts within the first nine. Recent and Projects are ranked
  by how often and how recently you open them. `Tab` jumps back to the thread
  you were in before this one; the footer names it.
- **Search:** typing searches thread titles, projects, branches, commands,
  settings, plugins, the telecom reference, and 3GPP specs. Once the query is three
  characters or longer, the Messages section shows threads whose messages
  match.
- **Top hit:** the best match from every section comes first and is selected,
  so `↵` runs it. A title, abbreviation, or keyword equal to the whole query
  beats any partial match. Ask an agent and Messages are top hit only when
  nothing else matches.
- **No arrow keys needed:** `⌘1`–`⌘9` (Ctrl+1–9 elsewhere) run the first nine
  rows, whose numbers show on the right. While the launcher is open these keys
  are its own, not bb's thread jump. `Tab` on a project, plugin, page command,
  telecom entry, or spec clause opens its page; the footer says where it goes.
- **Telecom reference:** when the [telecom-ref](https://github.com/benwaffle/bb-plugins)
  plugin is running, the launcher searches its 3GPP Diameter commands, AVPs,
  applications, interfaces, and network functions. An exact match such as
  `SAR` is the top hit. `↵` opens the entry in Telecom reference, `⌘↵`
  searches there, `⇧⌘C` copies a citation, and `Tab` lists more matches in the
  launcher. The preview shows the summary, code, request flow, and spec
  clause.
- **3GPP specs:** when the [Spec Search](../bb-plugin-spec-search) plugin is
  running, the launcher searches the clauses of the specs it has indexed. A
  spec and clause such as `29.228 B.1` or `TS 29.272 §7.3.2` is the top hit;
  words search clause titles and text, with the matched words in bold. `↵`
  opens the composer with a prompt asking about the clause, `⌘↵` copies the
  clause text, `⇧⌘C` copies its citation, and `Tab` lists more matches. The
  preview shows the clause text, its parent, and its subclauses. A spec that
  is not indexed yet shows **Fetch <spec> from 3GPP**.
- **Plugin results:** plugins that publish a `launcher.search` RPC add their
  own sections, such as Spotify playlists and songs. `↵` runs the first action
  and `⌘K` lists the rest; see [Plugin results](#plugin-results).
- **Quick prompt:** type a prompt and pick **Ask in <project>** to start a
  thread there without leaving the launcher (`⌘↵` opens it in the composer
  instead). **Ask in project…** picks another project.
- **Projects:** `↵` on a project lists its threads, up to the latest 100.
  Typing there searches all of them, or starts a thread in that project.
- **Preview:** the right pane shows the selected thread's project, branch,
  workspace, machine, agent, pull request, and last few messages. Other
  results show their title and description there.

## Keys

| Key | Action |
| --- | --- |
| `↑` `↓` / `Ctrl+N` `Ctrl+P` | Move |
| `↵` | Primary action |
| `⌘↵` | Secondary action (open in split, new thread) |
| `⌘1`–`⌘9` | Primary action of that row |
| `⌘K` | Actions for the selected item |
| `Tab` | Open the selected item's page |
| `Tab` on an empty query | Back to the previous thread |
| `⇧⌘P` | Pin or unpin |
| `⇧⌘U` | Mark read or unread |
| `⌘E` | Rename thread |
| `⇧⌘C` | Copy ID |
| `⌘⌫` | Archive thread |
| `⇧⌘E` | Enable or disable plugin |
| `Esc` / `⌫` on an empty query | Back, then close |

## Pages

- **Thread actions:** open, open in split, send message, rename, pin, mark
  read or unread, stop, show project threads, new thread in project, copy ID
  or link, archive (with undo). **More actions** below them lists every other
  action in bb's thread menu, bb's own and other plugins' (fork, move to
  section, delete, PR Board's review, …), skipping ones the launcher already
  has. Actions with a list of choices, like moving to a section, open it as a
  page.
- **Settings…:** general app toggles, theme, default agent, the launcher's own
  settings, and links to every Settings section.
- **Plugins…:** every installed plugin with its status. Open one to enable,
  disable, or reload it, and to edit its boolean, select, project, string,
  and number settings. Secret settings open the plugin's settings page.

## Plugin results

Any plugin can add results by registering two RPC methods with
`experimental_discoverable: true`. The launcher finds them with
`sdk.plugins.experimental_discoverRpc({ method: "launcher.search" })`.

- `launcher.search` takes `{ query }` and returns `{ items }`. Each item has
  `id`, `title`, `subtitle` (or null), `section`, `actions` (`[{ id, title }]`,
  at least one), and `keywords`. Sections show at most eight items.
- `launcher.run` takes `{ itemId, actionId }` and returns
  `{ message, navigate }`. A `message` shows as a toast; a `navigate` path opens
  in bb.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Open with ⌘K | on | Catch ⌘K for the launcher instead of bb's quick palette |
| Show preview pane | on | Show the preview pane beside the results |

## Layout

- `server.ts`: settings, pinned projects, and usage counts in `bb.storage.kv`,
  and `telecom_search`, which runs `bb telecom-ref search --json` (3 s
  timeout, recent queries cached)
- `telecom.ts`: maps the telecom-ref CLI's JSON to compact results
- `model.ts`: shared state types and the frecency score
- `app.tsx`: registers the overlay and the "Launcher: open" command
- `launcher/`: the window (`Launcher.tsx`), results list (`Results.tsx`),
  preview pane, pages, ranking and the top hit (`rank.ts`), plugin result
  sources (`sources.tsx`), telecom results (`telecom.tsx`), and 3GPP spec
  results (`specs.tsx`), which call Spec Search's `search`, `clause`, and
  `fetch` RPC methods directly

## Develop

```
npm install
npm run check   # typecheck, tests, build
bb plugin install .
```

`bb plugin dev` rebuilds and reloads the plugin on every save.
