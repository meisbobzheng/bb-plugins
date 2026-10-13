---
name: library
description: Save diagrams, call and registration flows, explanations, and design docs to the user's Library, and find ones saved before, with the library_save, library_search, and library_get tools or the bb library CLI. Use when the user asks to save, keep, bookmark, or look up something they saved earlier.
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

## Rules

- Never delete an entry unless the user asks; then use `bb library delete <lib_id>`.
- Use only the ids that search prints.
- Change entries only through these tools and commands, never the plugin's
  database.
