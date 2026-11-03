export interface CatalogGroup {
  id: string;
  label: string;
  specs: ReadonlyArray<{ spec: string; about: string }>;
}

export const CATALOG: readonly CatalogGroup[] = [
  {
    id: "core",
    label: "Cx, S6a, S6c, Sh, SGd",
    specs: [
      { spec: "29.228", about: "Cx/Dx signalling flows and message contents" },
      { spec: "29.229", about: "Cx/Dx Diameter protocol" },
      { spec: "29.272", about: "S6a/S6d and other MME/SGSN Diameter interfaces" },
      { spec: "29.338", about: "S6c and SGd Diameter interfaces for SMS" },
      { spec: "29.328", about: "Sh signalling flows and message contents" },
      { spec: "29.329", about: "Sh Diameter protocol" },
      { spec: "23.228", about: "IMS stage 2" },
      { spec: "23.401", about: "EPS for E-UTRAN access, stage 2" },
      { spec: "23.272", about: "CS fallback and SMS over SGs/in MME, stage 2" },
      { spec: "23.040", about: "SMS technical realization" },
    ],
  },
  {
    id: "common",
    label: "Shared basics",
    specs: [
      { spec: "29.230", about: "3GPP-specific Diameter codes" },
      { spec: "23.003", about: "Numbering, addressing and identification" },
      { spec: "23.008", about: "Organization of subscriber data" },
    ],
  },
  {
    id: "hss",
    label: "Other HSS Diameter interfaces",
    specs: [
      { spec: "29.336", about: "S6m, S6n and S6t" },
      { spec: "23.682", about: "Architecture for communication with packet data networks and applications" },
      { spec: "29.273", about: "SWx and other 3GPP EPS AAA interfaces" },
      { spec: "23.402", about: "Architecture enhancements for non-3GPP accesses" },
      { spec: "29.173", about: "SLh" },
      { spec: "23.271", about: "Location services, stage 2" },
      { spec: "29.109", about: "Zh and Zn for GBA" },
      { spec: "33.220", about: "Generic Bootstrapping Architecture" },
    ],
  },
  {
    id: "security",
    label: "Security",
    specs: [
      { spec: "33.203", about: "IMS access security" },
      { spec: "33.401", about: "EPS security architecture" },
    ],
  },
  {
    id: "signalling",
    label: "NAS and SIP signalling",
    specs: [
      { spec: "24.301", about: "EPS NAS, stage 3" },
      { spec: "24.229", about: "IMS SIP and SDP, stage 3" },
    ],
  },
  {
    id: "architecture",
    label: "Architecture",
    specs: [{ spec: "23.002", about: "Network architecture" }],
  },
];

export const CATALOG_SPECS = CATALOG.flatMap((group) => group.specs.map(({ spec }) => spec));
