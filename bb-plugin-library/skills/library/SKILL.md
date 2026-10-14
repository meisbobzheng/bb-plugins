---
name: library
description: Save diagrams, call and registration flows, explanations, and design docs to the user's Library, find ones saved before, fix or extend them in place, and tag them by group, with the library_save, library_search, library_get, and library_update tools or the bb library CLI. Use when the user asks to save, keep, bookmark, look up, change, or retag something they saved earlier.
---

# Library

The Library keeps Markdown entries the user wants to find again: call flows,
registration flows, diagrams, protocol explanations, and design docs. The user
browses and searches them on the Library page in the bb sidebar, where tags
appear in groups. Each entry links back to the thread it came from.

## Saving

Save only when the user asks. Prefer the `library_save` tool. Without the tool,
write the Markdown to a file and pass its contents:

```
bb library save --title "S6a attach: ULR/ULA between MME and HSS" --kind flow --body "$(cat flow.md)" --topic Outbox --status "Not Implemented"
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
- **Tags**: by group, as below.

## Tags and groups

Every tag belongs to one group, and a tag has the same group on every entry.

| Group | Holds | Examples |
| --- | --- | --- |
| `interfaces` | 3GPP reference points and service-based interfaces | S6a, S6c, Cx, SGd, Gx, N8, Nudm |
| `procedures` | Attach, registration, mobility, session, call, SMS, and authentication procedures | Attach, TAU, IMS Registration, MT Call, EPS-AKA |
| `messages` | Diameter command pairs and signalling messages | ULR/ULA, SAR/SAA, SRR/SRA, INVITE |
| `functions` | 3GPP nodes and network functions | HSS, MME, UDM, S-CSCF, SMS-GMSC |
| `protocols` | Signalling and transport protocols | Diameter, SIP, GTPv2-C, NAS, SBI |
| `domains` | Network domains and services | EPC, 5GC, IMS, SMS, VoLTE, BSS |
| `components` | Services, repositories, and modules of the user's own systems | the project's own service and repo names |
| `tech` | Languages, databases, libraries, cloud services, and tools | Go, Postgres, gRPC, AWS CDK, Lambda |
| `topics` | Concepts and design themes no other group covers | Outbox, Provisioning, Storage, SQN, Failover |
| `status` | Implementation state | Implemented, Partial, Not Implemented, Planned, In Progress, Deprecated |
| `docs` | What the write-up is | Overview, Index, End-to-end, Message Reference, Architecture |
| `other` | Tags nobody has grouped yet | |

- Telecom terms in the first six groups are detected from the title, summary,
  and body, and grouped automatically. Do not repeat them as tags.
- Put every other tag under its group: in the tools, pass
  `tags: { components: [...], tech: [...], topics: [...], status: [...], docs: [...] }`;
  in the CLI, use `--component`, `--tech`, `--topic`, `--status`, and `--doc`
  (also `--interface`, `--procedure`, `--message`, `--function`, `--protocol`,
  and `--domain` for terms the glossary misses).
- Reuse existing tags. Run `bb library tags` first and copy a tag's exact
  spelling instead of inventing a near-duplicate.
- A tag keeps the group it already has. The tool reply says when your group was
  ignored, and lists tags that landed in Other.
- Move a misgrouped tag everywhere with `bb library regroup <tag> <group>`.
  Built-in telecom tags never move. Do this for tags in Other, or when the user
  asks.
- Run `bb library groups` to print the groups, and `bb library retag` to add
  newly detected telecom tags to every saved entry.

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
bb library update <lib_id> --body "$(cat flow.md)" [--title …] [--kind …] [--summary …] [--topic …]
```

- Pass only the fields that change; the rest keep their current values.
- A new body replaces the whole body. Send the complete Markdown, not a diff.
- Detected tags are refreshed from the new content. Passing any tags replaces
  the entry's other tags, so send the full set you want; omit tags to keep the
  current ones.

## Rules

- Never save a new copy and delete the old one to change an entry; update it.
- Never delete an entry unless the user asks; then use `bb library delete <lib_id>`.
- Use only the ids that search prints.
- Change entries only through these tools and commands, never the plugin's
  database.
