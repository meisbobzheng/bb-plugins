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

- Open **Library** in the sidebar, or run **Library: search saved flows,
  diagrams, and docs** from the quick palette (⌘⇧L by default). Press `/` to
  focus search, ↑/↓ and Enter to open a result.
- Filter by kind (Flows, Diagrams, Explanations, Design docs, References,
  Notes) and by tag. Click a tag on an entry to filter by it.
- In a thread, open the side panel's **Library** tab to search beside the chat
  and **Insert in message** to reference an entry in your prompt.
- Each entry links to the conversation it came from, lists the specs it
  references (linked to 3GPP and IETF pages), and can be edited, copied, or
  used to start a new thread.

**Telecom tagging**

Saving detects 4G/5G interfaces (S6a, S13, Gx, Rx, Gy/Ro, Cx/Dx, Sh, SWx, S1-MME,
S11, S5/S8, N1–N40, Nudm/Namf/…), procedures (Attach, TAU, Registration, PDU
Session, Service Request, IMS Registration, CSFB, SRVCC, …), Diameter command
pairs (ULR/ULA, AIR/AIA, CCR/CCA, AAR/AAA, UAR/UAA, SAR/SAA, …), and protocols
(Diameter, GTPv2-C, PFCP, NGAP, S1AP, NAS, SIP, …). The glossary, with each
term's endpoints and specs, is in [topics.ts](topics.ts).

## CLI

```
bb library search [words…] [--kind <kind>] [--tag <tag>]… [--limit <n>] [--json]
bb library show <id> [--json]
bb library save --title <title> --body "$(cat flow.md)" [--kind <kind>] [--tag <tag>]… [--summary <text>] [--json]
bb library update <id> [--title <title>] [--body "$(cat flow.md)"] [--kind <kind>] [--tag <tag>]… [--summary <text>] [--json]
bb library tags [--json]
bb library delete <id> [--json]
```

`search` with no words lists the newest entries. Words match as prefixes;
quote a phrase to match it exactly.

`update` changes an entry in place and keeps its id. Omitted fields keep their
values, a new body replaces the whole body, and detected tags are refreshed.

## Agent tools

| Tool | Does |
| --- | --- |
| `library_save` | Save Markdown with a title, optional kind, summary, and tags. |
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
with an FTS5 index kept in sync by triggers. Deleting a thread keeps its
entries and drops only the link back to it.
