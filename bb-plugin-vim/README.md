# bb-plugin-vim

Vim keys for bb. Move through the sidebar, lists, and panes with `hjkl`,
press `f` to click anything on screen by its letter hint, and keep your hands
off the mouse.

## Use

Keys work whenever you are not typing. Focus in a text field, the composer,
a select, a terminal, or a code editor is insert mode: every key goes to that
field. `Esc` (also `Ctrl+[` on macOS) leaves a text field and returns to
normal mode, unless the field used `Esc` itself, for example to close a
mention menu. Terminals and code editors keep `Esc`.

The mode shows in the bottom-right corner: `NORMAL`, `INSERT`, `HINT`,
`PASS` (a terminal or editor has every key), or `PAUSED`, followed by any keys
waiting for the rest of a sequence or the hint letters typed so far. `?` lists
every key.

## Keys

| Key | Action |
| --- | --- |
| `j` / `k` | Next or previous item, or scroll down or up |
| `h` / `l` | Pane or column to the left or right |
| `gg` / `G` | First or last item, or the top or bottom |
| `d` / `u` | Half a page down or up (also `Ctrl+D` / `Ctrl+U` on macOS) |
| `Enter` / `o` | Open the item under the cursor |
| `O` | Open the thread under the cursor in a split |
| `f` | Click anything on screen by its hint |
| `F` | Move the cursor to anything by its hint |
| `i` | Type in the composer |
| `/` | Focus the page's search or filter field, or the composer |
| `gt` / `J` | Next thread in the sidebar |
| `gT` / `K` | Previous thread in the sidebar |
| `H` / `L` | Back or forward |
| `Esc` | Leave a text field, cancel hints or a pending key, drop the cursor |
| `?` | Show the keys |

In a pane with a list (the sidebar's threads, open menus, Library results,
PR Board cards), `j` and `k` move a cursor, drawn as a ring, and `Enter` opens
what it is on. In any other pane, such as a thread's chat or a settings page,
they scroll. `h` and `l` move between the sidebar, the chat, split panes, the
side panel, and plugin panes, left to right; moving back to a pane returns to
its last item, the open thread, or the item level with where you were.

In hint mode, type a hint's letters to click it (or, after `F`, to put the
cursor there). Picking a text field focuses it, and picking a terminal or code
editor puts the caret in it. `Backspace` undoes a letter; `Esc` or any other
key cancels. Buttons that stay invisible until you hover get no hint.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Vim keys | on | Turn the keys on or off |
| Show mode indicator | on | Show the mode and pending keys in the bottom-right corner |

"Vim: pause or resume" in the quick palette (`⌘⇧P`) turns the keys off in this
window until you resume or reload; bind it in Settings → Keyboard. "Vim: show
keys" opens the key list.

## With other plugins

- **Launcher:** `⌘K` still opens it. Its search field has focus, so its own
  keys (`↑` `↓`, `Ctrl+N` `Ctrl+P`, `Esc`) apply.
- **PR Board:** each column is a pane: `j`/`k` move through its cards, `h`/`l`
  move to the card at the same height in the next column, and `/` focuses the
  filter. On a PR's review page, `j`/`k` stay PR Board's next and previous
  file.
- **Library:** `j`/`k` move through results, `Enter` opens one, `l` moves into
  the entry, and `/` focuses search.
- **Scratchpad:** the window is one more pane. While the canvas has focus its
  tool keys win.
- **Panel Dock:** the side panel is a pane wherever it is docked, and the
  floating terminal keeps every key.

bb's own shortcuts are untouched: vim binds no `⌘` keys, no digits (bb uses
them to answer questions), and only adds `Ctrl` keys on macOS, where `Ctrl` is
not bb's command modifier. `Esc` still reaches bb after vim clears its state.

## For plugin authors

Lists and panes come from roles and bb's own markup. To fine-tune them, add:

- `data-vim-item` to an element `j`/`k` should stop on;
- `data-vim-pane` to a region `h`/`l` should move between;
- `data-vim-defer="j k"` to a region that handles those keys itself while it
  is on screen;
- `data-vim-passthrough` to a region that should receive every key.

## Layout

- `server.ts`: the two settings
- `app.tsx`: registers the overlay and the two palette commands
- `vim/keys.ts`, `vim/bindings.ts`: key names, the key table, and the sequence
  resolver
- `vim/hints.ts`, `vim/layout.ts`: hint labels and pane geometry
- `vim/dom.ts`: finding panes, items, hint targets, scroll containers, and
  text fields in the page
- `vim/engine.ts`: the key handler and actions
- `vim/Overlay.tsx`, `vim/Help.tsx`: the cursor ring, hints, mode indicator,
  and key list

## Develop

```
npm install
npm run check   # typecheck, tests, build
bb plugin install .
```

`bb plugin dev` rebuilds and reloads the plugin on every save.
