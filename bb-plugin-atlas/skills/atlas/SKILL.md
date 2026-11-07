---
name: atlas
description: Read and write the user's Atlas, diagram documentation of their systems that they zoom through in bb, from the whole network down to a single service, with the atlas_read and atlas_check tools or the bb atlas CLI. Use when the user asks how a documented system works, or asks to document, map, diagram, or update a system, its connections, flows, or where it runs.
---

# Atlas

The Atlas is a folder of YAML files. Each file is one diagram. A system node
opens the diagram one level down, so the user can zoom from the top-level
architecture into one service. The Atlas page in bb shows a short summary when
the user hovers a node, the full docs when they click it, animated traffic on
each connection, step-by-step flows, and a Deployment view of where everything
runs. The page reloads whenever a file changes.

## Read it

- `atlas_read` with no arguments: the folder, the diagram tree, problems, and
  the top-level diagram.
- `atlas_read` with `diagram: "epc"`: one diagram's nodes, connections, and
  flows. Diagram ids are file paths without `.yaml`, such as `epc/hss`.
- `atlas_read` with `diagram` and `node`: one node in full.
- From a terminal: `bb atlas status`, `bb atlas show epc`,
  `bb atlas show epc --node mme`.

Read the atlas before you answer how a documented system works, and say where
the atlas and the code disagree.

## Write it

Edit the YAML files with your file tools, then call `atlas_check` (or run
`bb atlas check`, which exits 1 on errors). Fix every problem it reports;
each one names its file and line.

To map a new system:

1. Find a system node with `kind: system` and no `open`; the page shows it as
   "Not mapped yet".
2. Write its diagram as a new file. Use `<id>.yaml` for a node in
   `index.yaml`, and `<parent>/<id>.yaml` below that, such as `epc/hss.yaml`.
3. Add `open: <diagram id>` to the system node.
4. Add `ref` nodes for everything outside the new diagram that it talks to,
   and connect them. Connections to refs roll up into the diagram above on
   their own, so don't write them there too.
5. Run `atlas_check` until it reports no problems.

### Diagram file

```yaml
title: EPC
summary: One line shown under the title.
body: |
  Markdown shown in the docs panel when nothing is selected.
nodes:
  mme:
    label: MME                # defaults to the id
    sub: Mobility Management Entity
    kind: service             # service, system, external, or store
    summary: One or two sentences, shown on hover.
    body: |
      Markdown shown when the node is clicked.
    facts: { Repo: org/epc-mme, Language: Go }
    spec: TS 23.401 §4.4
    runs-on: ns-epc           # a place id from infra.yaml
    replicas: 3
  hss:
    open: epc/hss             # makes it a system that zooms into epc/hss.yaml
  ran: { ref: index#ran }     # a reference: diagram#node
edges:
  - S6a: mme -- hss           # label: from -- to
    plane: control            # control (default), user, api, or data
    spec: TS 23.401 §4.2, TS 29.272
    summary: Shown on hover and in the docs.
flows:
  Initial attach:
    - ran -> mme: S1AP Initial UE Message
    - mme -> hss: S6a AIR
```

- Node ids use letters, digits, `.`, `-`, and `_`. Put spaces around `--` and
  `->`.
- Every flow step needs a connection between its two nodes.
- Use `plane: user` for user-plane traffic (S1-U, S5, SGi), `api` for
  internal requests, and `data` for databases and streams.
- Name 3GPP interfaces and network functions the way the specs do. When
  `telecom_ref_lookup` is available, look each one up and copy the clause it
  cites into `spec`. Never guess a spec number.
- Layout is automatic. To place nodes by hand, give every node in the diagram
  `at: [x, y]`. Pins on only some nodes are ignored.

### infra.yaml

One optional file at the root describes where things run. Nodes point at its
places with `runs-on`, and connections between places ride its paths in the
Deployment view.

```yaml
places:
  aws:
    label: AWS us-east-1
    kind: region              # region, site, cluster, namespace, or group
    contains:
      eks:
        kind: cluster
        contains:
          ns-epc: { label: ns/epc, kind: namespace }
  pop: { label: Colo PoP, kind: site }
paths:
  dx:
    label: Direct Connect · 10G
    between: [pop, aws]       # place ids, or nodes like index#ran
```

Place ids are unique across the file. `atlas_check` warns when a connection
crosses between places that no path connects.

## Set it up

- `bb atlas init ~/atlas` writes an example atlas into a new folder and opens
  it.
- `bb atlas use ~/path/to/atlas` opens an existing folder.
- The folder is the plugin's `directory` setting. Change it with
  `bb plugin config atlas set directory <path>`.
