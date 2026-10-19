# PR Board

A kanban board of open GitHub pull requests, with one agent review thread per
PR and a review page for reading the diff and commenting on it.

## Install

```sh
npm install --include=dev
bb plugin install . --yes
```

Requires `gh` signed in to GitHub on the bb server machine. `gopls` is
optional; with it, ⌘-click on Go code resolves definitions exactly.

## Board

The **PR Board** sidebar entry lists the open PRs of one repository at a time
in four columns. The repository menu at the start of the toolbar switches
between the configured repositories, and only the chosen one is read from
GitHub. **Add repository…** at the end of the menu takes a repository name in
the current repository's organization (or a full `owner/repo`), checks it with
GitHub, adds it to the **Repositories** setting, and switches to it. The board
remembers the last repository you picked.

| Column | PRs |
| --- | --- |
| Draft | Draft PRs. |
| Open | Ready for review, with no comment or review from a person other than the author. |
| Reviewing | Commented on or reviewed by someone other than the author. Comments from bots, GitHub Actions, and Copilot do not count. |
| Ready | Approved: GitHub's review decision is approved, or, in repositories without required reviews, a person approved and nobody requested changes. |

Each card shows the number, title, author, age, size, CI status, reviewers
(ring color: green approved, red changes requested, blue commented, grey
requested), comment count, unresolved threads, and the review thread's state.
Filter by text, or by **Requested** (review requested from you or one of your
teams, until you review) and **Mine**.

**Columns** lays the groups out side by side; **Rows** stacks them, each a grid
of cards that wraps to the page width, so the page scrolls down. Rows is the
default when the window is taller than it is wide. Click a group's header to
collapse it.

Hover a card for its actions: **Shrink** reduces it to one line (**Expand**
restores it), **Hide** removes it from the board, and the external-link icon
opens it on GitHub. **N hidden** in the toolbar shows hidden cards, faded, with
**Unhide**. Layout, scope, collapsed groups, and shrunk and hidden PRs are kept
in this client's local storage.

The last board loads at once, including after a restart, and updates in the
background: the toolbar shows **Updating…** while it fetches and **Updated
<time>** after, where the time is when the server last read GitHub. It returns to
where you scrolled.

To stay within GitHub's API limit (5,000 GraphQL points an hour, shared with
everything else that uses your `gh` login), the board refreshes cheaply:

- While the board is on screen it checks every minute, and once when it
  becomes visible again; it does not check while hidden. The server reuses a
  check for 50 seconds, so going in and out of the board costs nothing, and
  live updates from review threads also wait until the board is visible.
- A check lists only the repository's open PRs with each one's id, number, last update
  time, and CI status (about 1 point). CI status updates the cards directly.
- Full details (reviewers, reviews, comments, and review threads) are fetched
  only for PRs that are new, changed since the last check, or that you acted
  on from PR Board, and for every PR at least every 15 minutes.
- **Refresh** checks right away and fetches every PR's details again.

## Review page

Click a card to open `/plugins/pr-board/board/pr/<owner>/<repo>/<n>`. If the
PR has no live review thread, one is started:

- in the project whose git remote matches the repository, or the **Review
  project** setting;
- in a `git-worktree` environment on `origin/<head branch>` (the default branch
  for PRs from forks), where `gh pr checkout <n>` runs once the worktree is
  ready;
- with a first message that asks for a short, plain summary of the PR;
- followed by `/thermo-nuclear-code-quality-review review pr <n>`, sent after
  the checkout and queued behind the summary. The message asks the agent to
  record its findings with the `pr_board_record_findings` tool.

The review thread's chat is the page's **Review thread** panel tab. The
**Review diff** button in a review thread's header opens the page from the
thread.

Every 15 minutes the server checks each PR that has a review thread. When the
PR has left the open list and GitHub reports it merged or closed, its review
thread is archived and the plugin forgets the thread and its findings; a thread
whose agent is still running is archived on a later check. Unarchiving the
thread afterwards keeps it, and reopening the PR starts a new review thread.

A PR's page also opens from the cache when you come back to it, on the file
you last viewed, and refreshes in the background. The server keeps each PR it
has loaded in the plugin database, so this survives restarts, and only fetches
it again when it changed:

- Within 50 seconds of the last look it reuses the saved PR with no GitHub
  call.
- After that it runs one tiny query (last update time, head commit, and which
  review threads are resolved) and reuses the saved PR when nothing changed. If
  the board checked the PR in the last 50 seconds and it has not been updated,
  it skips even that.
- Only a change, a PR Board action on the PR, or the page's refresh fetches the
  PR, its files, viewed states, and merge base again. Marking a file viewed in
  PR Board updates the saved PR; marking it on GitHub's website is not noticed
  until the PR changes.

The page has:

- **Files**: every changed file with its status, finding, unresolved-thread,
  and pending-comment counts. The circle marks a file viewed on GitHub. `j` and
  `k` move between files.
- **Findings**: the recorded findings, blockers first. Click one to jump to
  its lines. Dismissed findings are hidden until **Show dismissed**.
- **The diff**: split or unified, wrapped or not, collapsed or the full file.
  Lines a finding covers are shaded amber, darker for blockers and majors;
  lines with a pending comment are shaded violet. Findings, GitHub review
  threads, and pending comments render under their last line. Findings on
  lines outside the shown hunks, and outdated GitHub comments, are listed
  above the diff.
- **Description**: the PR body.
- **Run review**: sends the review command to the thread again.

The diff layout is **Auto** by default: split when the diff area is at least
860 pixels wide, unified when it is narrower. **Split** and **Unified** fix it.
The ↑ and ↓ buttons step through the files.

On a page narrower than 900 pixels, such as a vertical monitor with the thread
panel open, the file list and findings move into a collapsible panel above the
diff (the list button toggles it), the header's actions move to their own row,
and toolbar buttons show icons only.

### Commenting

Hover a line number and click **+**, or drag across line numbers first for a
range. The editor offers:

- **Add to review**: saves a pending comment in the plugin's database (⌘↵).
- **Comment now**: posts a single review comment immediately.
- **Suggest change**: inserts a GitHub suggestion block with the selected new
  lines.
- **Ask agent**: sends the text as a question to the review thread, with the
  selected lines quoted, instead of to GitHub. The answer appears in the
  **Review thread** tab.

A finding's **Comment** button opens the editor on the finding's lines with its
title and explanation. **Submit review** posts every pending comment in one
review with a summary and **Comment**, **Approve**, or **Request changes**.
Authors can only comment. GitHub threads can be replied to, resolved, and
unresolved in place.

GitHub only accepts review comments on lines inside a diff hunk, so the editor
refuses ranges outside one, and a range must stay inside one hunk.

### Go to definition

⌘-click (Ctrl-click off macOS) an identifier in the diff. The lookup runs in the
review thread's worktree:

- Go code on the PR's head uses `gopls definition`, including definitions in
  the standard library and module cache, which open read-only.
- Everything else, and the old side of the diff, searches the commit with
  `git grep` for definition patterns in Go, TypeScript/JavaScript, Python,
  Rust, C/C++, JVM languages, Swift, C#, and protobuf, ranked same file, then
  same directory, then other non-test code.

One match jumps to it: into the diff when the file changed in the PR,
otherwise into a read-only file view where ⌘-click keeps working. Several
matches open a picker. The back button, ⌥←, or Ctrl+- return to where you
were.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Repositories | `private-tech-inc/hss` | Comma-separated `owner/repo` list offered in the board's repository menu. |
| Review project | none | Project that review threads start in when no project's remote matches. |
| Review model | `claude-opus-5-5` | Claude Code model of new review threads. Empty uses the project's default. |
| Review reasoning effort | `high` | `low`, `medium`, `high`, `xhigh`, or `max`. |
| Review permission mode | `auto` | `auto` is Approve for me, `accept-edits` is Accept Edits, `full` is Full Access. |

Review threads always run on Claude Code, because the review is the
`/thermo-nuclear-code-quality-review` skill. The model, effort, and mode are set
when a thread starts, so changing them affects new review threads only; change
an existing thread from its composer.

## CLI

```
bb pr-board board [--repo owner/repo] [--refresh] [--json]
bb pr-board open <n | owner/repo#n | PR URL> [--json]
bb pr-board review <n | owner/repo#n | PR URL> [--json]
bb pr-board findings <n | owner/repo#n | PR URL> [--json]
```

See `skills/pr-board/SKILL.md` for the output formats.

## Storage

The plugin database keeps the PR of each review thread, the findings, pending
comments, and the last loaded copy of each opened PR. The thread and findings of
a PR are removed once its review thread is archived after a merge or close.
Nothing reaches GitHub until you post a comment, reply,
resolve a thread, mark a file viewed, or submit a review.

## Limits

- The review worktree and every `gh`, `git`, and `gopls` call run on the bb
  server machine.
- File contents come from GitHub's contents API at the merge base and the head;
  files over 2 MB show the patch only.
- Findings keep the head commit they were recorded on. After new commits they
  show **outdated**, and their lines may have moved.
- Go to definition needs the review worktree. On the head side it uses the
  checked-out files, so local edits in the worktree can shift gopls results.
- The board reads the 100 most recently updated open PRs per repository and up
  to 100 review threads per PR.

## Development

```sh
npm run check   # typecheck, tests, build
bb plugin dev   # rebuild and reload on save
```
