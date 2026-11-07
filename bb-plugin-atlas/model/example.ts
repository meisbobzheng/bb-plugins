export const EXAMPLE_FILES: Readonly<Record<string, string>> = {
  "index.yaml": `title: Mobile Core
summary: How a device gets onto the network, gets authenticated and charged, and reaches the internet.
body: |
  **This is an example atlas.** Replace these files with your own systems.

  Devices attach through the RAN. The **EPC** handles mobility, sessions, and user-plane traffic, the **BSS** owns subscribers, plans, and charging, and **IMS** carries voice.

  Only LTE-Uu is written in this file. Every other connection here rolls up from the diagrams one level down, so the levels never disagree.
nodes:
  ue:
    label: Devices
    sub: UE
    kind: external
    summary: Phones, hotspots, and IoT modules on your SIMs.
  ran:
    label: RAN
    sub: eNodeB
    kind: external
    summary: Radio access network. eNodeBs terminate the radio link and backhaul control and user traffic to the core over S1.
  epc:
    label: EPC
    sub: Evolved Packet Core
    summary: The 4G packet core. It attaches devices, authenticates them, and carries their data to the internet.
    open: epc
  ims:
    label: IMS
    sub: Voice and SMS
    kind: system
    summary: IP Multimedia Subsystem for VoLTE and SMS over IP. Not mapped yet.
  bss:
    label: BSS
    sub: Business support
    summary: Subscribers, plans, provisioning, online charging, and billing.
    open: bss
    runs-on: ns-bss
  inet:
    label: Internet
    sub: Packet data networks
    kind: external
    summary: External packet data networks the device reaches through the PGW.
edges:
  - LTE-Uu: ue -- ran
    plane: user
    summary: The LTE radio link between the device and the eNodeB.
flows:
  Device comes online:
    - ue -> ran: Attach Request over the air
    - ran -> epc: S1-MME Initial UE Message carries the Attach Request
    - epc -> bss: Gy CCR-Initial asks for data quota
    - bss -> epc: Gy CCA-Initial grants quota
    - epc -> ran: S1-MME Attach Accept, and the default bearer is set up
    - ran -> epc: S1-U carries the first uplink packet to the SGW
    - epc -> inet: SGi out to the internet
`,
  "epc.yaml": `title: EPC
summary: The MME runs control, the SGW and PGW carry user traffic, the HSS holds subscribers, and the PCRF sets policy.
body: |
  Dashed boxes are references to things outside this diagram. Click one to go there.
nodes:
  ran: { ref: index#ran }
  mme:
    label: MME
    sub: Mobility Management Entity
    summary: The main EPC control node. It terminates NAS, runs authentication, tracks and pages idle UEs, and selects the SGW and PGW.
    spec: TS 23.401 §4.4
    facts: { Repo: example/epc-mme, Language: Go }
    runs-on: ns-epc
    replicas: 3
  sgw:
    label: SGW
    sub: Serving Gateway
    summary: The user-plane anchor between eNodeBs. It buffers downlink data for idle UEs and triggers paging through the MME.
    spec: TS 23.401 §4.4
    runs-on: pop
    replicas: 2
  hss:
    label: HSS
    sub: Home Subscriber Server
    summary: The subscriber database for EPS and IMS. It holds profiles, the serving MME, and authentication data, and generates authentication vectors.
    spec: TS 23.002
    open: epc/hss
    runs-on: ns-hss
  pcrf:
    label: PCRF
    sub: Policy and charging rules
    summary: The policy decision point. It builds PCC rules and pushes them to the PCEF in the PGW over Gx.
    spec: TS 23.203 §6.2
    runs-on: ns-epc
    replicas: 2
  pgw:
    label: PGW
    sub: PDN Gateway · PCEF
    summary: The gateway to external networks. It allocates UE IP addresses and enforces policy and charging.
    spec: TS 23.401 §4.4
    runs-on: pop
    replicas: 2
  inet: { ref: index#inet }
  ims: { ref: index#ims }
  bss: { ref: index#bss }
edges:
  - S1-MME: ran -- mme
    summary: eNodeB to MME over S1AP. Carries UE context and E-RAB setup, paging, handover, and NAS transport.
    spec: TS 23.401 §4.2, TS 36.413
  - S1-U: ran -- sgw
    plane: user
    summary: Per-bearer GTP-U tunnels between the eNodeB and the SGW.
    spec: TS 23.401 §4.2, TS 29.281
  - S11: mme -- sgw
    summary: MME to SGW over GTPv2-C. Creates, modifies, and deletes sessions and bearers, and carries downlink data notifications.
    spec: TS 23.401 §4.2, TS 29.274
  - S5: sgw -- pgw
    plane: user
    summary: Bearer and PDN connection management plus the user-plane tunnels between the SGW and PGW.
    spec: TS 23.401 §4.2, TS 29.274
  - S6a: mme -- hss
    summary: MME to HSS over Diameter. Authentication vectors, location update, subscription download, purge, and cancel location.
    spec: TS 23.401 §4.2, TS 29.272
  - Gx: pgw -- pcrf
    summary: PCEF to PCRF over Diameter. The PCRF installs, modifies, and removes PCC rules.
    spec: TS 23.203, TS 29.212
  - SGi: pgw -- inet
    plane: user
    summary: The PGW's interface to external packet data networks.
    spec: TS 23.401 §4.2, TS 29.061
  - Gy: pgw -- bss
    summary: Online charging between the PCEF and the OCS. Reserves quota and reports usage.
    spec: TS 32.251, TS 32.299
  - Cx: hss -- ims
    summary: CSCFs query the HSS for S-CSCF assignment, authentication vectors, and user profiles.
    spec: TS 23.228 §4, TS 29.228
  - Provisioning: hss -- bss
    plane: api
    summary: The BSS creates, changes, and removes subscribers in the HSS.
flows:
  Initial attach (simplified):
    - ran -> mme: S1AP Initial UE Message with the Attach Request
    - mme -> hss: S6a AIR asks for authentication vectors
    - hss -> mme: S6a AIA returns the vectors, then NAS authentication runs with the UE
    - mme -> hss: S6a ULR registers this MME as the serving node
    - hss -> mme: S6a ULA returns the subscription data
    - mme -> sgw: S11 Create Session Request
    - sgw -> pgw: S5 Create Session Request
    - pgw -> pcrf: Gx CCR-Initial
    - pcrf -> pgw: Gx CCA-Initial installs PCC rules
    - pgw -> bss: Gy CCR-Initial to the OCS
    - bss -> pgw: Gy CCA-Initial grants quota
    - pgw -> sgw: S5 Create Session Response with the UE IP address
    - sgw -> mme: S11 Create Session Response
    - mme -> ran: S1AP Initial Context Setup with the Attach Accept
  Downlink data to an idle UE:
    - inet -> pgw: A packet arrives for the UE's IP address
    - pgw -> sgw: S5 GTP-U to the SGW
    - sgw -> mme: S11 Downlink Data Notification while the SGW buffers
    - mme -> ran: S1AP Paging
    - ran -> mme: S1AP Service Request from the UE
    - mme -> sgw: S11 Modify Bearer Request with the eNodeB tunnel
    - sgw -> ran: S1-U delivers the buffered data
`,
  "epc/hss.yaml": `title: HSS
summary: A Diameter edge in front of three internal services, with keys in a vault and profiles in Postgres.
body: |
  Only \`diameter-edge\` speaks Diameter. Everything behind it is internal gRPC.
nodes:
  mme: { ref: epc#mme }
  ims: { ref: index#ims }
  bss: { ref: index#bss }
  diameter-edge:
    sub: S6a and Cx peer
    summary: Terminates Diameter. Handles capabilities exchange and watchdogs, and turns S6a and Cx requests into internal calls.
    spec: TS 29.272, TS 29.228
    facts: { Repo: example/hss-edge }
    runs-on: ns-hss
    replicas: 3
  auth-vectors:
    sub: EPS-AKA vector generation
    summary: Generates RAND, XRES, AUTN, and KASME for each authentication request.
    runs-on: ns-hss
    replicas: 2
  subscriber-store:
    sub: Profiles · SQN · serving node
    summary: Owns subscriber profiles, sequence numbers, and the current serving MME and S-CSCF.
    runs-on: ns-hss
    replicas: 2
  subscriber-api:
    sub: Provisioning · gRPC
    summary: The provisioning API the BSS calls to create, change, and remove subscribers.
    runs-on: ns-hss
  vault:
    label: Key vault
    sub: K / OPc
    kind: store
    summary: Subscriber secret keys. Only auth-vectors can read them.
    runs-on: managed-data
  db:
    label: Postgres
    sub: Subscribers DB
    kind: store
    summary: The system of record for subscriber profiles.
    runs-on: managed-data
edges:
  - S6a: mme -- diameter-edge
    spec: TS 29.272
  - Cx: ims -- diameter-edge
    spec: TS 29.228
  - gRPC: bss -- subscriber-api
    plane: api
  - vectors: diameter-edge -- auth-vectors
    plane: api
  - profile: diameter-edge -- subscriber-store
    plane: api
  - writes: subscriber-api -- subscriber-store
    plane: api
  - SQN: auth-vectors -- subscriber-store
    plane: api
  - K / OPc: auth-vectors -- vault
    plane: data
  - SQL: subscriber-store -- db
    plane: data
flows:
  Authentication Information Request:
    - mme -> diameter-edge: S6a AIR with the IMSI and visited PLMN
    - diameter-edge -> auth-vectors: Generate one vector
    - auth-vectors -> subscriber-store: Read and advance the SQN
    - auth-vectors -> vault: Fetch K and OPc
    - auth-vectors -> diameter-edge: RAND, XRES, AUTN, KASME
    - diameter-edge -> mme: S6a AIA
  Provision a SIM:
    - bss -> subscriber-api: CreateSubscriber with the IMSI and plan
    - subscriber-api -> subscriber-store: Insert the profile
    - subscriber-store -> db: INSERT the subscriber
    - subscriber-api -> bss: OK
`,
  "bss.yaml": `title: BSS
summary: Charging, provisioning, rating, and the product catalog.
body: |
  The OCS is on the Gy hot path. Everything else is request and response from internal tools.
nodes:
  epc: { ref: index#epc }
  ocs:
    label: OCS
    sub: Online charging
    summary: Answers Gy credit-control requests. Reserves quota and records usage in real time.
    spec: TS 32.299
    runs-on: ns-bss
    replicas: 2
  provisioning:
    sub: SIM and plan lifecycle
    summary: Activates, suspends, and retires SIMs, and pushes changes to the HSS.
    runs-on: ns-bss
  rating:
    label: Rating and billing
    sub: Usage → invoices
    summary: Prices usage against tariffs and produces invoices.
    runs-on: ns-bss
  catalog:
    label: Product catalog
    sub: Plans and tariffs
    summary: The source of truth for plans, add-ons, and tariffs.
    runs-on: ns-bss
  console:
    label: Ops console
    sub: Internal tools
    kind: external
    summary: The internal UI for support and finance.
edges:
  - Gy: epc -- ocs
    spec: TS 32.299
  - Provisioning: epc -- provisioning
    plane: api
  - usage: ocs -- rating
    plane: data
  - plans: provisioning -- catalog
    plane: api
  - tariffs: rating -- catalog
    plane: api
  - invoices: rating -- console
    plane: api
  - manage plans: catalog -- console
    plane: api
flows:
  Quota grant:
    - epc -> ocs: Gy CCR-Initial from the PGW
    - ocs -> rating: Rate this request
    - rating -> catalog: Tariff for this plan
    - rating -> ocs: Price per MB
    - ocs -> epc: Gy CCA-Initial with the granted units
`,
  "infra.yaml": `places:
  aws:
    label: AWS us-east-1
    kind: region
    summary: The control plane and managed data.
    contains:
      eks:
        label: EKS core-prod
        kind: cluster
        summary: The Kubernetes cluster for every control-plane service.
        contains:
          ns-epc: { label: ns/epc, kind: namespace }
          ns-hss: { label: ns/hss, kind: namespace }
          ns-bss: { label: ns/bss, kind: namespace }
      managed-data:
        label: Managed data
        kind: group
        summary: AWS-managed stores.
  pop:
    label: Colo PoP
    kind: site
    summary: Two bare-metal UPF hosts running DPDK, next to the RAN backhaul and IP transit.
paths:
  backhaul:
    label: Backhaul · IPsec
    between: [index#ran, pop]
    summary: IPsec tunnels from the cell sites into the PoP.
  dx:
    label: Direct Connect · 10G
    between: [pop, aws]
    summary: The private link from the PoP to the AWS region.
`,
};
