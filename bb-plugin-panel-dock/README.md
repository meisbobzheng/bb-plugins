# bb-plugin-panel-dock

Opens bb's side panel on the right or at the bottom of a thread. Terminals,
browser tabs, diffs, and file previews all go wherever you put the panel.

A button in the thread header, next to bb's panel toggle, opens a menu:

- **Open panel → On the right / At the bottom** moves the panel there and
  opens it.
- **New terminal** starts a shell in the thread's workspace and shows it in the
  panel.
- **Floating terminal** opens a terminal in a window floating over the thread.

When the panel is at the bottom, drag its top edge to resize it. The position
and height are saved per window and restored on reload.

## Floating terminal

**Ctrl+`** toggles the floating terminal on every platform. It works from the
composer and from inside the terminal itself. The first press in a thread
starts a shell. Later presses bring back the same shell for as long as it runs.
Exiting the shell or closing its tab means the next press starts a new one.

Pressing Ctrl+` again puts things back as they were: a panel that was closed
closes again, and a panel that was already open returns to its dock with the
terminal tab selected. Focus goes back to wherever it was, such as the
composer. Closing the panel any other way also ends the float.

## Commands

| Command | Default shortcut |
| --- | --- |
| Toggle floating terminal | Ctrl+` |
| Move panel between right and bottom | none |

Both are in the command palette (Mod+Shift+P). Rebind them under
Settings → Keyboard.

## How it works

bb has no plugin API for moving its panel, so a content script sets
`data-panel-dock` on `<html>` and `dock.css` turns the thread's panel group from
a row into a column. The panel keeps bb's own tabs, terminal, and resizing
state. The plugin hides bb's vertical resize handle while the panel is at the
bottom, and the top-edge drag replaces it.

The floating terminal is the same panel. While it floats, `data-panel-float`
on `<html>` pins the panel above the thread, and the thread takes the full
width behind it.

## Caveats

- The CSS targets bb's DOM (`data-split-resize-grid-root`, the
  `thread-detail-secondary-panel-handle` resize handle, the panel's `aside`).
  A bb release that renames these puts the panel back on the right. Nothing
  else breaks.
- Only the single-thread layout docks at the bottom or floats. Split panes keep
  their panels on the right.
- Ctrl+` works only on thread pages, not on New thread or plugin pages.
- The floating terminal floats whatever tab the panel shows. Switching tabs
  while it floats keeps the float.
- Compact (mobile) layouts open the panel as a drawer, so the header button
  is hidden there, and Ctrl+` opens the terminal in that drawer.
- bb's own toggle still says "Show right panel" when the panel is at the
  bottom.

## Development

```
npm install --include=dev
npm test             # vitest: dock persistence, resize drag, header menu, floating terminal
npm run typecheck
bb plugin build .
bb plugin install .  # or `bb plugin dev` for rebuild-on-save
```
