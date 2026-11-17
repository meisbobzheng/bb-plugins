Set up a loaner laptop from your own in one run, and bring your work back.

## What you get

- **A kit you generate in one click**: apps, Homebrew, npm/uv/pipx tools, the
  custom scripts you dropped into `/opt/homebrew/bin`, dotfiles, `~/.config`,
  Claude Code config, every repo in `~/dev`, bb plugins, and your recent bb
  threads. Untick anything you don't want.
- **An installer you can rerun**: a plan up front, a live status line per step,
  sign-ins grouped together, Iru apps handed to Iru Self Service, and a summary
  with the exact retry command for anything that failed.
- **bb as a clean standalone server** on the travel laptop: its own identity
  and only that machine, with your threads remapped to its username and paths
  and still resumable.
- **Handbacks to a private GitHub repo** while you travel. Back home, threads
  take the travel copy, and you're asked about each app, package, config
  change, and repo to clone, and once about bb settings.

## How it works

The plugin scans the Mac and builds the kit with a small zsh runner that it
also puts in the kit. No secrets go in the kit: keys, tokens, and credential
files stay behind, and plugin databases lose their auth tables and password
fields.
