# bb-plugin-atlas

Diagram documentation you zoom through. Start from the whole network, hover a
service for a one-line summary, click a system to zoom into its own diagram,
and keep going down to a single service. Play flows step by step, watch
traffic move on each connection, and switch to the Deployment view to see
where everything runs and which network path each interface rides.

## Use it

- Open **Atlas** in the sidebar. The first time, pick a folder and choose
  **Create an example atlas** to see a mobile core mapped three levels deep,
  or **Open this folder** for an atlas you already have.
- **Hover** a node or connection for its summary, interface, and spec.
- **Click** a system to zoom in. Its box shows a thumbnail of the diagram
  inside, and the thumbnail grows into the full diagram. Click a dashed
  reference to travel to the thing it points at. The breadcrumb, Back, and
  Escape zoom back out.
- **Click** a service, connection, place, or network path for its full docs in
  the side panel. **Docs** in the toolbar hides the panel to give the diagram
  the whole width.
- **Play flow** runs a flow such as an initial attach as numbered steps, with a
  pulse along each connection. Pause, step back and forward, or stop.
- **Live traffic** animates every connection: dashed blue for control, green
  for user plane, orange for API, and purple for data.
- **Deployment** morphs the diagram into where it runs: sites, regions,
  clusters, and namespaces, with replica counts. Connections between places
  fold into the network paths they ride, and the **Runs on** chips under the
  diagram light up what each place hosts.
- **Draft with an agent** on a system that isn't mapped yet opens a new thread
  with a prompt to read its code and write its diagram.

## Write it

An atlas is a folder of YAML files that you keep in git like any other docs.
`index.yaml` is the top-level diagram, a system node with `open: epc` zooms
into `epc.yaml`, and an optional `infra.yaml` lists places and network paths.
Connections to references roll up into the diagram above on their own, so each
connection is written once, at the level it belongs to. The page reloads as
soon as a file is saved, and problems show with their file and line.

The bundled `atlas` skill has the full format. Ask an agent to map or update a
system and it edits the files, then checks them with `atlas_check`.

## Commands

```
bb atlas init ~/atlas      # write the example atlas into a new folder and open it
bb atlas use ~/my-atlas    # open an existing atlas folder
bb atlas status            # folder, diagram tree, and problems
bb atlas check             # reload and list problems; exits 1 on errors
bb atlas show epc --node mme
```

## Agent tools

- `atlas_read`: the overview, one diagram, or one node as text.
- `atlas_check`: reload the files and list every problem with its file and
  line.

## How it works

The server reads the folder, watches it for changes, validates every file,
resolves references, rolls connections up a level, works out which network
paths each connection rides, and lays each diagram out with
[ELK](https://eclipse.dev/elk/) on a 16:10 canvas. The page gets the finished
atlas over RPC and draws it as SVG. Nothing leaves the machine.

## Develop

```
npm install
npm run check      # typecheck, tests, build
bb plugin install .
```
