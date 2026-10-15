# bb-plugin-library

Save diagrams, call flows, explanations, and design docs from any bb thread,
then search them all in one place.

## Use it

**Save**

- Click **Save to Library** in any chat message's action bar. Select text first
  to save only the selection. The dialog suggests a title, kind, and tags; press
  Enter (or ⌘↵) to save.
- Ask an agent: "save this attach flow to my Library". Agents use the
  `library_save` tool, or `bb library save` in threads started before the plugin
  was installed.

**Find**

- Open **Library** in the sidebar, or press ⌘⇧L (**Library: open your last
  entry, or go back** in the quick palette; rebind it in Settings → Keyboard).
  Pressing ⌘⇧L again returns to the page you came from. Press `/` to focus
  search, ↑/↓ and Enter to open a result.
- The Library reopens on the entry you last read, at the same scroll position,
  with your search and filters as you left them. Opening entries inside the
  Library does not add to back/forward history, so Back leaves the Library.
- Filter by kind (Flows, Diagrams, Explanations, Design docs, References,
  Notes) and by tag. Each tag group is one pill, such as **Interfaces 28**,
  that opens a menu of its tags with counts; check tags to filter, type to jump
  to one, and press Escape to close. An entry shows its tags the same way, and
  picking one filters the Library by it.
- In a thread, open the side panel's **Library** tab to search beside the chat
  and **Insert in message** to reference an entry in your prompt.
- Each entry links to the conversation it came from, lists the specs it
  references (linked to 3GPP and IETF pages), and can be edited, copied, or
  used to start a new thread.

**Tag groups**

Every tag belongs to one group, and the Library shows tags, filters, and the tag
editor group by group:

| Group | Examples |
| --- | --- |
| Interfaces | S6a, S6c, Cx, SGd, Gx, Rx, Sh, N8, Nudm |
| Procedures | Attach, TAU, IMS Registration, MT Call, PDU Session, EPS-AKA |
| Messages | ULR/ULA, AIR/AIA, SAR/SAA, SRR/SRA, CCR/CCA, INVITE |
| Network functions | HSS, MME, UDM, S-CSCF, SMS-GMSC, PCRF |
| Protocols | Diameter, SIP, GTPv2-C, NAS, PFCP, SBI |
| Domains | EPC, 5GC, IMS, SMS, VoLTE, BSS |
| Components | Your own services, repositories, and modules |
| Tech stack | Go, Postgres, gRPC, AWS CDK, Lambda |
| Topics | Outbox, Provisioning, Storage, SQN |
| Status | Implemented, Partial, Not Implemented, Planned |
| Doc type | Overview, Index, End-to-end, Message Reference |
| Other | Tags nobody has grouped yet |

The first six groups come from a built-in glossary: saving detects those terms
in the content and files them in their fixed group, and hovering one shows its
endpoints and spec. The glossary is in [glossary.ts](glossary.ts). Every other
tag gets its group the first time someone saves it: agents pass tags by group,
and the tag editor has a group picker. A tag keeps that group on every entry;
pick another group in the editor, or run `bb library regroup`, to move it.

## CLI

```
bb library search [words…] [--kind <kind>] [--tag <tag>]… [--limit <n>] [--json]
bb library show <id> [--json]
bb library save --title <title> --body "$(cat flow.md)" [--kind <kind>] [--summary <text>] [tag flags] [--json]
bb library update <id> [--title <title>] [--body "$(cat flow.md)"] [--kind <kind>] [--summary <text>] [tag flags] [--json]
bb library tags [--json]
bb library groups [--json]
bb library regroup <tag> <group> [--json]
bb library retag [--dry-run] [--json]
bb library delete <id> [--json]
```

Tag flags take a tag per group and repeat: `--interface`, `--procedure`,
`--message`, `--function`, `--protocol`, `--domain`, `--component`, `--tech`,
`--topic`, `--status`, and `--doc`. `--tag` adds a tag whose group is already
known.

`search` with no words lists the newest entries. Words match as prefixes;
quote a phrase to match it exactly.

`update` changes an entry in place and keeps its id. Omitted fields keep their
values, a new body replaces the whole body, and detected tags are refreshed.

`tags` lists every tag by group. `regroup` moves a tag to another group on
every entry. `retag` adds newly detected glossary tags to every saved entry and
never removes one.

## Agent tools

| Tool | Does |
| --- | --- |
| `library_save` | Save Markdown with a title, optional kind, summary, and tags by group. |
| `library_search` | Full-text search with kind and tag filters. |
| `library_get` | Read one entry in full. |
| `library_update` | Change an entry in place, keeping its id; omitted fields stay as they are. |

The [skill](skills/library/SKILL.md) tells agents how to write entries that
read well later.

## Develop

```
npm install
npm run check        # typecheck, tests, build
bb plugin install .
bb plugin dev        # rebuild and reload on save
```

Entries live in the plugin's SQLite database (`<dataDir>/plugins/library/data.db`)
with an FTS5 index kept in sync by triggers. Groups of tags outside the
glossary live in its `tag_groups` table. Deleting a thread keeps its entries
and drops only the link back to it.
