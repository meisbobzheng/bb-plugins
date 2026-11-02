# bb-plugin-thread-sidebar

A sidebar thread list for bb in the style of T3 Code: threads grouped by
project in roomy two-line rows, with the threads waiting on you highlighted and
listed first.

## Use

Install and enable the plugin, then pick **Thread Sidebar** under Settings →
Appearance → Sidebar. bb uses the first installed list other than its own
until you pin one there, so enabling the plugin may switch the sidebar
already. Picking bb's Thread list brings the old sidebar back.

- **Projects:** each project is a section, in bb's project order. Click its
  header to collapse it; collapsed projects stay collapsed after a reload and
  still show their threads that need input and the open thread. The amber
  badge counts threads waiting on you, and `+` starts a thread in that
  project.
- **Pinned:** pinned threads sit in their own section at the top, in your pin
  order.
- **Order:** within a project, threads that need input come first, then
  running ones, then the rest by last activity. Each project shows eight
  threads plus any that need input; **Show N more** lists the rest.
- **Rows:** a pill shows what the thread is doing (Needs input, Working, Plan,
  Plan ready, Failed), a dot marks an unread finished thread, and the right edge
  shows how long ago it last changed. Threads that need input get an amber
  background and edge. The second line shows the branch, and the machine when
  you have more than one. A thread started from another one sits indented
  under it.
- **Actions:** right-click a row, or hover it and click `⋯`, for bb's thread
  menu (rename, pin, mark unread, archive, and other plugins' actions). The
  archive button beside it archives in one click.
- **Keys:** `⌘1`–`⌘9` jump to the first nine rows in the list, top to bottom;
  hold `⌘` to see which is which. With the Vim plugin, `j`/`k` move through
  rows and project headers and `gt`/`gT` move between threads.
- **Splits:** drag a row into the main area to open it in a split.
- **Phones:** rows and buttons are larger, `⋯` is always visible, and
  long-press opens the thread menu.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Row density | Comfortable | Comfortable rows add the branch and machine under the title; Compact rows are one line |

## Not included

bb's own list also has drag-to-reorder for projects and pins, custom
sections, grouping by machine or chronologically, grouping threads that share
a worktree, archived threads, inline rename, and pull request status on rows.
Use bb's Thread list for those.

## Layout

- `server.ts`: the Row density setting
- `app.tsx`: registers the thread list
- `sidebar/model.ts`: thread status, grouping, sorting, and the per-project
  preview
- `sidebar/ThreadSidebar.tsx`: the list and its project sections
- `sidebar/ThreadRow.tsx`: one thread row with its pill, actions, and menu
- `sidebar/hooks.ts`: the relative-time ticker and collapsed-section storage

## Develop

```
npm install
npm run check   # typecheck, tests, build
bb plugin install .
```

`bb plugin dev` rebuilds and reloads the plugin on every save.
