# bb-plugins

Plugins and themes for [bb](https://getbb.app). Each `bb-plugin-*` directory is
one plugin with its own `package.json`, README, and tests. Themes live in
[themes](themes).

| Plugin | What it does |
| --- | --- |
| [Library](bb-plugin-library) | Save diagrams, call flows, explanations, and design docs from any thread, then search them in one place. |
| [Panel Dock](bb-plugin-panel-dock) | Open bb's side panel on the right or at the bottom, or float a terminal over the thread with Ctrl+`. |
| [PR Board](bb-plugin-pr-board) | A kanban board of open GitHub PRs with agent review threads and a side-by-side diff review page. |
| [Scratchpad](bb-plugin-scratchpad) | A floating whiteboard for notes and sketches, toggled with ⌘⇧J, that you can @-mention in any thread. |
| [Thread Meter](bb-plugin-thread-meter) | Context, token cost, and plan usage beside the composer's model picker. |
| [Thread Router](bb-plugin-thread-router) | Files new threads into the best-matching sidebar section, or `other` when none fits. |

## Install

From GitHub, one plugin at a time, by its name in [.bb/plugins.json](.bb/plugins.json):

```
bb plugin install git:https://github.com/meisbobzheng/bb-plugins.git@main --plugin library
```

From a local checkout:

```
cd bb-plugin-library
npm install
bb plugin install .
```

## Themes

| Theme | Look |
| --- | --- |
| [Cape](themes/cape/theme.css) | Near-black with bat-signal yellow and moonlight blue accents, IBM Plex Sans, and JetBrains Mono. |

Copy a theme into bb's theme directory, then select it:

```
mkdir -p "$(bb theme dir)/cape"
curl -fsSL https://raw.githubusercontent.com/meisbobzheng/bb-plugins/main/themes/cape/theme.css \
  -o "$(bb theme dir)/cape/theme.css"
bb theme set cape
```

From a local checkout:

```
cp -R themes/cape "$(bb theme dir)/"
bb theme set cape
```

You can also pick it under Settings → Appearance. Code and terminal text use
JetBrains Mono when it's installed and fall back to Menlo otherwise.

## Develop

Every plugin has `typecheck`, `build`, and `check` scripts, and `test` when it
has tests. `check` runs them all:

```
npm run check
```

`bb plugin dev` in a plugin directory rebuilds and reloads it on every save.
