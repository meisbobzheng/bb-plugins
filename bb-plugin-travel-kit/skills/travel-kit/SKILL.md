---
name: travel-kit
description: Build a travel laptop kit, push handbacks from a travel laptop, and apply them on the main laptop with the bb travel-kit CLI and the travel-kit runner. Use when the user asks to set up a travel or loaner laptop, export their setup, hand changes back, or fix a failed travel-kit install step.
---

# Travel Kit

Travel Kit copies the user's setup from their main laptop to a travel laptop
and hands changes back. The user drives it from the Travel Kit page in the bb
sidebar; the same actions are CLI commands.

## On the main laptop

```
bb travel-kit scan            # counts by kind; --json lists every item
bb travel-kit generate        # builds the kit with the saved profile; prints its path
bb travel-kit status          # mode, settings, last job, handbacks applied
bb travel-kit apply-command   # the Terminal command that applies handbacks
```

What goes in the kit is the user's profile on the Travel Kit page. Don't
change it for them unless asked. Generating takes minutes; it bundles every
repo in `~/dev`.

Never run the apply command from a thread. It quits bb to merge threads, which
stops the thread running it. Give the user the command from
`bb travel-kit apply-command` to run in Terminal.

## On the travel laptop

The installer is `./install.sh` in the unzipped kit. It pauses for sign-ins, so
the user runs it in Terminal, not a thread. After install:

```
travel-kit doctor             # what's missing, changes nothing
travel-kit retry <step-key>   # rerun one step, e.g. travel-kit retry 'cask:*'
travel-kit log <step-key>     # that step's log from the latest run
travel-kit status             # handback repo, steps that aren't done
bb travel-kit handback        # push changes to the private handback repo
bb travel-kit handback --dry-run
```

Step keys look like `formula:jq`, `cask:wireshark-app`, `repo:hss`,
`bbplugin:library`, or `gate-github:gh_+_SSH`; the installer's summary prints
the exact retry command for each failure. Logs live in
`~/.travel-kit/logs/latest/`.

## Constraints

- Secrets never go in a kit or handback. Don't try to add keys, tokens,
  `~/.ssh`, or credential files to one; the user signs in on the travel laptop.
- Apps that Iru manages install through Iru Self Service, not Homebrew.
- Each travel laptop's handbacks go to its own private `travel-kit-<hostname>`
  repo on the user's GitHub account.
