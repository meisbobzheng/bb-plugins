# bb-plugin-scratchpad

A floating whiteboard for bb, similar to Freeform. Toggle it with a hotkey,
sketch, and reference any board from a thread.

## Use

- **Toggle:** `⌘⇧J` (Ctrl+Shift+J elsewhere), the Scratchpad button in the
  sidebar footer, or "Scratchpad: show or hide" in the quick palette
  (`⌘⇧P`). Rebind it in Settings → Keyboard. `Esc` also closes the window.
- **Window:** drag the title bar to move it, drag the bottom-right corner to
  resize it, and double-click the title bar to maximize it. Position and size
  persist.
- **Boards:** the left panel lists boards. Use `+` to add one, double-click a
  board (or the window title) to rename it, and use the trash icon to delete
  it. Boards autosave.
- **Reference from a thread:** type `@` in any composer and pick a board under
  "Scratchpad boards", or use `+` → "Mention scratchpad board" to insert the
  board you have open. At send time the agent receives the board's text,
  sticky notes, arrow connections, and a shape summary, plus a PNG rendering
  of the board.

## Tools

| Key | Tool |
| --- | --- |
| V | Select, move, resize (Shift keeps proportions), marquee |
| H / Space-drag | Pan (scroll also pans; ⌘/pinch-scroll zooms) |
| P | Pen |
| L / A | Line / arrow (Shift snaps to 45°) |
| R / O / D | Rectangle / ellipse / diamond (triangle is in the toolbar) |
| G | Polygon: click points; click the first point, double-click, or press Enter to finish |
| T | Text (or double-click the canvas) |
| N | Sticky note |
| E | Eraser |

Other keys: ⌘Z / ⇧⌘Z undo/redo, ⌘A select all, ⌘D duplicate, ⌫ delete,
arrow keys nudge (Shift for 10px). Clicking the zoom percentage fits the board
to the window.

## Layout

- `server.ts`: SQLite storage, RPC, and the `@` mention provider
- `summary.ts`: converts a board into agent context
- `model.ts` / `constants.ts`: element schema, which the server validates at the RPC boundary
- `app.tsx`: registers the overlay, hotkey, composer entries, and footer button
- `scratchpad/`: the editor (SVG canvas, toolbar, board list, window)

## Develop

```
npm install
npm run check   # typecheck, tests, build; server.test.ts needs better-sqlite3's native binding
bb plugin install .
```

`bb plugin dev` rebuilds and reloads the plugin on every save.
