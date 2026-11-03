---
name: spec-search
description: Search and read the full text of 3GPP specifications by clause, find which spec a pasted passage comes from, and fetch more specs from the 3GPP FTP, with the spec_search, spec_clause, spec_identify, and spec_fetch tools or the bb spec CLI. Use when the user asks what a 3GPP spec says, wants a clause such as "29.228 B.1", or asks where some spec text comes from.
---

# Spec Search

Spec Search keeps the full text of 3GPP specifications, split into clauses,
in a local index. It starts with the specs for Cx, S6a, S6c, Sh and SGd plus
their stage 2, security, NAS/SIP, and architecture specs, fetched as Rel-19
Word documents from the official 3GPP FTP.

## Reading a clause

When the user names a spec and clause, look it up directly:

```
spec_search { query: "29.228 B.1" }
spec_clause { spec: "29.228", clause: "B.1" }
```

`spec_search` returns the clause first, then its subclauses. `spec_clause`
returns the clause text, its parent, and its subclauses; pass `deep: true`
for the subclause text too. Read one clause at a time instead of a whole spec.

## Searching

Search with the words the spec would use: message, AVP, and procedure names
work best (`"Update-Location-Request"`, `"ULR-Flags"`, `"purge UE"`). Add a
spec number to search only that spec (`"29.272 purge"`). An empty query lists
the indexed specs and their versions.

Quote and cite the clause you read, e.g. "3GPP TS 29.272 §7.3.2 (V19.6.0)".
Never cite a clause you did not read.

## Finding where text comes from

Pass a passage to `spec_identify`. It returns the best-matching clauses and the
share of the passage each one contains; 80% or more means that clause is the
source.

## Adding specs

If a spec is not indexed, `spec_fetch { specs: ["29.336"] }` downloads its
newest Rel-19 version from www.3gpp.org and indexes it; pass `release` for
another release. The user can also index local files:

```
bb spec fetch 29.336 33.220 --wait
bb spec add ~/Downloads/29228-j20.zip --wait
bb spec list
bb spec show 29.228 B.1
bb spec search purge UE --spec 29.272
bb spec identify "the public user identities associated with the service profile"
bb spec jobs
```
