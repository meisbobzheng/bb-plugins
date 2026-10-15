Keep the explanations your agents write, and find them again in seconds.

## What you get

- A **Save to Library** button on every chat message. Select text first to
  save only that part. The save dialog suggests a title, a kind, and tags.
- A **Library** page with instant full-text search, kind and tag filters, and
  rendered Markdown, including mermaid sequence diagrams.
- Every entry links back to the conversation it came from, and exports to PDF,
  Markdown, or HTML wherever you choose to save it.
- A **Library** tab in the thread side panel that searches while you chat and
  inserts an entry reference into your message.
- Agent tools and a `bb library` command, so agents can save a flow when you
  ask, look up what you saved before, and fix it in place without changing
  its link.

## Built for mobile core work

Tags are sorted into groups: Interfaces, Procedures, Messages, Network
functions, Protocols, Domains, Components, Tech stack, Topics, Status, and Doc
type. Entries are tagged automatically with the 4G and 5G interfaces (S6a, S6c,
Cx, N8), procedures (Attach, IMS Registration, PDU Session), Diameter command
pairs (ULR/ULA, SRR/SRA), network functions (HSS, MME, S-CSCF), protocols, and
domains they mention. Agents file every other tag under its group, and filters
on the Library page follow the same groups. Hover a tag to see its endpoints
and specification. Each entry lists the 3GPP and IETF specifications it
references, linked to their pages.

## How it works

Entries live in this plugin's own SQLite database on the bb server, indexed
with SQLite full-text search. Nothing leaves the machine, and the plugin needs
no account or API key.
