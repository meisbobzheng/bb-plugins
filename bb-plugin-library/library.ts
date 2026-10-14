export const LIBRARY_PANEL = "library";
export const CHANGED_CHANNEL = "library-changed";
export const MARK_START = "\u0002";
export const MARK_END = "\u0003";

export const KINDS = ["flow", "diagram", "explanation", "design", "reference", "note"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABELS: Record<Kind, { one: string; many: string }> = {
  flow: { one: "Flow", many: "Flows" },
  diagram: { one: "Diagram", many: "Diagrams" },
  explanation: { one: "Explanation", many: "Explanations" },
  design: { one: "Design doc", many: "Design docs" },
  reference: { one: "Reference", many: "References" },
  note: { one: "Note", many: "Notes" },
};

export const LIMITS = {
  title: 200,
  summary: 500,
  body: 500_000,
  tag: 40,
  tags: 30,
  query: 500,
  results: 200,
} as const;

export function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

export const TAG_GROUPS = [
  "interfaces",
  "procedures",
  "messages",
  "functions",
  "protocols",
  "domains",
  "components",
  "tech",
  "topics",
  "status",
  "docs",
  "other",
] as const;
export type TagGroup = (typeof TAG_GROUPS)[number];
export const ASSIGNABLE_GROUPS = TAG_GROUPS.filter((group): group is Exclude<TagGroup, "other"> => group !== "other");

export const TAG_GROUP_INFO: Record<TagGroup, { label: string; hint: string }> = {
  interfaces: { label: "Interfaces", hint: "3GPP reference points and service-based interfaces, e.g. S6a, S6c, Cx, SGd, Gx, N8, Nudm" },
  procedures: {
    label: "Procedures",
    hint: "Attach, registration, mobility, session, call, SMS, and authentication procedures, e.g. Attach, TAU, IMS Registration, MT Call, EPS-AKA",
  },
  messages: { label: "Messages", hint: "Diameter command pairs and signalling messages, e.g. ULR/ULA, SAR/SAA, SRR/SRA, INVITE" },
  functions: { label: "Network functions", hint: "3GPP nodes and network functions, e.g. HSS, MME, UDM, S-CSCF, SMS-GMSC" },
  protocols: { label: "Protocols", hint: "Signalling and transport protocols, e.g. Diameter, SIP, GTPv2-C, NAS, PFCP, SBI" },
  domains: { label: "Domains", hint: "Network domains and services, e.g. EPC, 5GC, IMS, SMS, VoLTE, BSS" },
  components: { label: "Components", hint: "Services, repositories, and modules of the user's own systems, by their project names" },
  tech: { label: "Tech stack", hint: "Languages, databases, libraries, cloud services, and tools, e.g. Go, Postgres, gRPC, AWS CDK, Lambda" },
  topics: { label: "Topics", hint: "Concepts and design themes no other group covers, e.g. Outbox, Provisioning, Storage, SQN, Failover" },
  status: { label: "Status", hint: "Implementation state: Implemented, Partial, Not Implemented, Planned, In Progress, or Deprecated" },
  docs: { label: "Doc type", hint: "What the write-up is, e.g. Overview, Index, End-to-end, Message Reference, Architecture, Troubleshooting" },
  other: { label: "Other", hint: "Tags nobody has grouped yet" },
};

export interface TagRef {
  tag: string;
  group: TagGroup;
}

export function isTagGroup(value: string): value is TagGroup {
  return (TAG_GROUPS as readonly string[]).includes(value);
}

export function sortByGroup<T extends { group: TagGroup }>(tags: readonly T[]): T[] {
  return tags
    .map((tag, index) => ({ tag, index }))
    .sort((a, b) => TAG_GROUPS.indexOf(a.tag.group) - TAG_GROUPS.indexOf(b.tag.group) || a.index - b.index)
    .map(({ tag }) => tag);
}

export function groupTags<T extends { group: TagGroup }>(tags: readonly T[]): Array<{ group: TagGroup; tags: T[] }> {
  return TAG_GROUPS.flatMap((group) => {
    const members = tags.filter((tag) => tag.group === group);
    return members.length === 0 ? [] : [{ group, tags: members }];
  });
}

export function guessKind(body: string): Kind {
  if (/```mermaid\s+sequenceDiagram/.test(body) || /\b(call|message|signall?ing|registration|attach)\s+flows?\b/i.test(body)) {
    return "flow";
  }
  if (/```mermaid/.test(body) || /[┌┐└┘├┤│─]{3,}/.test(body)) return "diagram";
  if (/^#{1,3}\s*(design|architecture|proposal|requirements)\b/im.test(body)) return "design";
  return "explanation";
}

function plainLine(line: string): string {
  return line
    .replace(/^\s*(#{1,6}|[-*+]|\d+[.)]|>)\s+/, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

export function guessTitle(body: string): string {
  const prose = body.replace(/```[\s\S]*?(```|$)/g, "");
  const heading = /^#{1,3}\s+(.+)$/m.exec(prose)?.[1];
  const firstLine = prose.split("\n").find((line) => plainLine(line) !== "");
  const title = plainLine(heading ?? firstLine ?? "").replace(/[:.]$/, "");
  return truncate(title === "" ? "Untitled" : title, 80);
}

export function excerpt(body: string, limit: number): string {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .map(plainLine)
    .filter((line) => line !== "")
    .join(" ");
  return truncate(text.replace(/\s+/g, " ").trim(), limit);
}

export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}
