Map complex systems from the top down, and learn them by zooming in.

## What you get

- An **Atlas** page: a diagram you can hover for summaries and click to zoom
  into, level by level, from the whole network down to one service.
- Explicit connections labelled with their interface, colored by plane, with
  live traffic and step-by-step flows.
- A **Deployment** view that shows where each piece runs and which network
  path each interface rides.
- Docs for every service, connection, place, and path in a side panel.

## Built for mobile core work

Connections carry their 3GPP interface names and spec clauses. Connections to
other systems roll up a level by themselves, so the core's top-level diagram
always matches the EPC, BSS, and IMS diagrams under it. An example atlas maps
an EPC three levels deep, down to the HSS's internal services.

## How it works

An atlas is a folder of YAML files you keep in git. The plugin watches the
folder and reloads on every save. Agents read it with `atlas_read`, write it
with their file tools, and check it with `atlas_check`. Nothing leaves the
machine.
