# bb-plugin-panel-dock

Opens bb's side panel on the right or at the bottom of a thread. Terminals,
browser tabs, diffs, and file previews all go wherever you put the panel.

A button in the thread header, next to bb's panel toggle, opens a menu:

- **Open panel → On the right / At the bottom** moves the panel there and
  opens it.
- **New terminal** starts a shell in the thread's workspace and shows it in the
  panel.

When the panel is at the bottom, drag its top edge to resize it. The position
and height are saved per window and restored on reload.

The command palette (Mod+Shift+P) has **Move panel between right and bottom**.
It has no default shortcut. Bind one under Settings → Keyboard.

## How it works

bb has no plugin API for moving its panel, so a content script sets
`data-panel-dock` on `<html>` and `dock.css` turns the thread's panel group from
a row into a column. The panel keeps bb's own tabs, terminal, and resizing
state. The plugin hides bb's vertical resize handle while the panel is at the
bottom, and the top-edge drag replaces it.

## Caveats

- The CSS targets bb's DOM (`data-split-resize-grid-root`, the
  `thread-detail-secondary-panel-handle` resize handle, the panel's `aside`).
  A bb release that renames these puts the panel back on the right. Nothing
  else breaks.
- Only the single-thread layout docks at the bottom. Split panes keep their
  panels on the right.
- Compact (mobile) layouts open the panel as a drawer, so the header button
  is hidden there.
- bb's own toggle still says "Show right panel" when the panel is at the
  bottom.

## Development

```
npm install --include=dev
npm test             # vitest: dock persistence, resize drag, header menu
npm run typecheck
bb plugin build .
bb plugin install .  # or `bb plugin dev` for rebuild-on-save
```
