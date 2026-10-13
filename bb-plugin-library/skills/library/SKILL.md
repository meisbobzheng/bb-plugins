---
name: library
description: Save diagrams, call and registration flows, explanations, and design docs to the user's Library, find ones saved before, and fix or extend them in place, with the library_save, library_search, library_get, and library_update tools or the bb library CLI. Use when the user asks to save, keep, bookmark, look up, or change something they saved earlier.
---

# Library

The Library keeps Markdown entries the user wants to find again: call flows,
registration flows, diagrams, protocol explanations, and design docs. The user
browses and searches them on the Library page in the bb sidebar. Each entry
links back to the thread it came from.

## Saving

Save only when the user asks. Prefer the `library_save` tool. Without the tool,
write the Markdown to a file and pass its contents:

```
bb library save --title "S6a attach: ULR/ULA between MME and HSS" --kind flow --body "$(cat flow.md)"
```

Write each entry so it stands on its own, months later, without the chat:

- **Title**: name the interface, procedure, and messages, e.g.
  "Gx IP-CAN session establishment: CCR-I/CCA-I between PCEF and PCRF".
- **Body**: the full explanation, never "see above". Draw call flows as a
  ` ```mermaid ` `sequenceDiagram`, with the message names on the arrows. Name
  the spec and clause the flow follows, e.g. "3GPP TS 29.272 §5.2.1.1".
- **Kind**: `flow` for call, registration, and message flows; `diagram` for
  other diagrams; `explanation`; `design` for design docs; `reference` for
  tables and look-ups; `note`.
- **Tags**: interfaces (S6a, Gx, N8), procedures (Attach, Registration),
  Diameter command pairs (ULR/ULA), and protocols are detected and added
  automatically. Add only tags they miss, such as a product or vendor name.

## Finding

```
bb library search <words> [--kind flow] [--tag S6a] [--json]
bb library show <lib_id>
bb library tags
```

Search matches word prefixes, so "regis" finds "registration". Search before
you redraw a flow the user says they saved, then read it with `library_get` or
`bb library show`.

## Updating

To fix, extend, or rewrite a saved entry, update it in place. The id, source
thread, and creation date stay the same, so the index entries and references
that point at it keep working. Prefer the `library_update` tool. Without the
tool:

```
bb library show <lib_id> --json          # read the current entry
bb library update <lib_id> --body "$(cat flow.md)" [--title …] [--kind …] [--summary …] [--tag …]
```

- Pass only the fields that change; the rest keep their current values.
- A new body replaces the whole body. Send the complete Markdown, not a diff.
- Detected tags are refreshed from the new content. `--tag` (or `tags`)
  replaces the extra tags; omit it to keep the current ones.

## Rules

- Never save a new copy and delete the old one to change an entry; update it.
- Never delete an entry unless the user asks; then use `bb library delete <lib_id>`.
- Use only the ids that search prints.
- Change entries only through these tools and commands, never the plugin's
  database.
