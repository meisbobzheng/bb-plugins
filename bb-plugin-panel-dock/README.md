# bb-plugin-panel-dock

Opens bb's side panel on the right or at the bottom of a thread. Terminals,
browser tabs, diffs, and file previews all go wherever you put the panel.

A button in the thread header, next to bb's panel toggle, opens a menu:

- **Open panel → On the right / At the bottom** moves the panel there and
  opens it.
- **New terminal** starts a shell in the thread's workspace and shows it in the
  panel.
- **Floating terminal** opens the floating terminal window.

When the panel is at the bottom, drag its top edge to resize it, or
double-click the edge to reset it to 40% of the thread's height. The position
and height are saved per window and restored on reload.

## Floating terminal

**Ctrl+`** toggles a floating terminal window on every screen: threads, the
home page, settings, and plugin pages. The sidebar footer has a **Floating
terminal** button too. The first press starts a shell where you are:

- in a thread, in the thread's workspace;
- in a project, in the project's checkout;
- anywhere else, in your home folder on this machine.

Later presses hide and bring back the same shell, wherever you navigate, for
as long as it runs. Drag the title bar to move the window, drag its corner to
resize it, and double-click the title bar to put it back in the middle. Its
place and size are saved. Ctrl+` works from inside the terminal, focus returns
to where it was when the window hides, and **×** ends the shell. Exiting the
shell closes the window, and the next press starts a new one where you are.

The window draws the shell with xterm.js in bb's terminal colors and font, and
talks to it through bb's terminal API. bb gives plugins no live output stream,
so the window polls for output: every 16 ms while output is flowing, slowing
to every 250 ms when idle and once a second while hidden. Typing feels close
to bb's own terminal, but very fast output can lag slightly behind it.

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

The floating terminal is the plugin's own window, an app overlay that renders
a bb terminal session with xterm.js, so it works on screens without a panel.

## Caveats

- The CSS targets bb's DOM (`data-split-resize-grid-root`, the
  `thread-detail-secondary-panel-handle` resize handle, the panel's `aside`).
  A bb release that renames these puts the panel back on the right. Nothing
  else breaks.
- Only the single-thread layout docks at the bottom. Split panes keep their
  panels on the right.
- The floating terminal is not one of bb's terminal tabs, so it doesn't show
  in the panel's tab list.
- Compact (mobile) layouts open the panel as a drawer, so the header button
  is hidden there.
- bb's own toggle still says "Show right panel" when the panel is at the
  bottom.

## Development

```
npm install --include=dev
npm test             # vitest: dock persistence, resize drag, header menu, floating terminal and its session
npm run typecheck
bb plugin build .
bb plugin install .  # or `bb plugin dev` for rebuild-on-save
```
