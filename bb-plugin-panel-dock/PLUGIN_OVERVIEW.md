Put bb's side panel on the right or at the bottom of a thread, and summon a
floating terminal on any screen with Ctrl+`.

## What you get

- A movable, resizable floating terminal on any screen, toggled with Ctrl+`
  (rebindable) or the sidebar footer. It opens in the thread's workspace, the
  project's checkout, or your home folder, and keeps its shell as you move
  around.
- A header button that opens the panel on the right or at the bottom.
- A New terminal item that starts a shell in the thread's workspace.
- A draggable top edge for the bottom panel, with its height remembered.
  Double-click the edge to reset the height.
- A command palette entry that moves the panel between the two positions.

## How it works

The plugin restyles bb's existing panel instead of drawing a new one, so tabs,
terminals, and browser views behave as usual. The floating terminal is its own
window that renders a bb terminal session with xterm.js. The position, height, and floating window's place are
stored in this window's local storage. Nothing leaves the machine.
