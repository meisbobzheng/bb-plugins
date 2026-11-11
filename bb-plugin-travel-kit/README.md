# bb-plugin-travel-kit

Build a kit on your main laptop that sets up a travel laptop: apps, command-line
tools, custom scripts, shell and config, repos in `~/dev`, Claude Code, and bb
itself. On the travel laptop bb becomes a fresh standalone server whose only
machine is that laptop, with your recent threads remapped to it. While you
travel, push handbacks to a private GitHub repo; back home, apply them to the
main laptop.

## Use it

1. On the main laptop, open **Travel Kit** in the sidebar, click **Scan this
   Mac**, untick anything you don't want, and click **Generate kit**. The zip
   lands in `~/Desktop` (change it in settings).
2. Copy the zip to the travel laptop, unzip it, and run `./install.sh` in
   Terminal. It shows a plan first, then works through it in phases with a
   status line per step. Run it again any time; finished steps are skipped and
   failed ones retried.
3. On the travel laptop, open **Travel Kit → Handback** and click **Push
   handback** (or run `travel-kit handback`) whenever you want the main laptop
   to catch up.
4. Back on the main laptop, run the command shown on **Travel Kit → Handback**
   in Terminal (`zsh '<plugin>/runner/travel-kit' apply`). bb quits for a moment
   while the threads merge.

## What the installer does

| Phase | What happens |
| --- | --- |
| Preflight | macOS version, free disk, network, Command Line Tools |
| Admin rights and Homebrew | One sudo prompt, kept alive while the script runs; points you at Privileges if you aren't an admin |
| Essential tools | `gh`, plus `git`, `awscli`, `node`, `mas`, `uv`, `pipx`, `jq` when the kit has them |
| Iru Self Service | Lists the apps Iru installs, opens Self Service, and waits until they appear |
| Sign-ins | 1Password SSH agent, then GitHub (`gh` and SSH) |
| Packages | Taps, formulae, casks, App Store apps, npm, uv and pipx tools |
| Shell, config and scripts | Dotfiles, `~/.config`, Claude Code config, and scripts such as `druid-forward` |
| AWS SSO | `aws sso login` for each SSO session in your `~/.aws/config` |
| Repos in ~/dev | Clones from git bundles, keeps uncommitted work, recreates bb worktrees |
| bb | Installs bb, starts it once so it makes its own identity, installs plugins, merges threads |
| Handback | Creates the private `travel-kit-<hostname>` repo and installs the `travel-kit` command |

The summary lists what failed with the exact `travel-kit retry <step>` to run,
versions that differ from the main laptop, and what still needs you (provider
sign-ins, privacy prompts). Logs are in `~/.travel-kit/logs/latest`.

`travel-kit doctor` reports what's missing without changing anything.

A laptop set up some other way becomes a travel laptop with `travel-kit enroll`.
It creates the handback repo, and its first handback covers bb threads since
this laptop's bb was set up plus everything else on it; the main laptop skips
what it already has. Repos go into a handback only when they have unpushed
commits, uncommitted changes, or no remote; the main laptop clones or fetches
the rest from GitHub.

## How bb moves

The kit never uses `bb server import`, which carries the old server's identity
and machines over. Instead it exports threads active in the last 7 days (and the
threads they came from), with their events, environments, projects, sections,
settings, and plugin data. On the travel laptop bb starts fresh, the script
quits it, merges that content with the old host ID and home paths rewritten to
the new ones, and starts it again. Claude Code session folders are renamed for
the new paths so threads resume. Handbacks merge the same way in the other
direction, keeping the main laptop's IDs when a project, environment, or
section already exists there.

## What never leaves the laptop

bb's auth secret, host ID, and telemetry ID; `~/.ssh`; AWS credentials and SSO
caches; `gh`'s `hosts.yml`; `.netrc`, `.npmrc`, `.env` files; key and
certificate files; files named like credentials, secrets, tokens, or
passwords; shell history. In plugin databases, auth tables are emptied and
password, token, secret, and API key columns are cleared.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Where to save kits | `~/Desktop` | Folder for generated kits |
| Export threads active in the last N days | 7 | 1 to 90 |
| Zip the kit | On | Off leaves a folder |

## Develop

```
npm install
npm run check
bb plugin install .
```

The runner in `runner/` is plain zsh and needs only what macOS ships with
(`sqlite3`, `git` from the Command Line Tools, `tar`, `curl`, `shasum`).
