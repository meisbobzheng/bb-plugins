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
  and Commands. Recent and Projects are ranked by how often and how recently
  you open them. `Tab` jumps back to the thread you were in before this one;
  the footer names it.
- **Search:** typing searches thread titles, projects, branches, commands,
  settings, and plugins. Once the query is three characters or longer, the
  Messages section shows threads whose messages match.
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
| `⌘K` | Actions for the selected item |
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

- `server.ts`: settings, pinned projects, and usage counts in `bb.storage.kv`
- `model.ts`: shared state types and the frecency score
- `app.tsx`: registers the overlay and the "Launcher: open" command
- `launcher/`: the window (`Launcher.tsx`), results list (`Results.tsx`),
  preview pane, pages, ranking, and plugin result sources (`sources.tsx`)

## Develop

```
npm install
npm run check   # typecheck, tests, build
bb plugin install .
```

`bb plugin dev` rebuilds and reloads the plugin on every save.
