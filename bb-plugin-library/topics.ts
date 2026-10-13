import { LIMITS, truncate } from "./library.js";

export type TopicCategory = "procedure" | "interface" | "command" | "protocol";

export interface Topic {
  tag: string;
  category: TopicCategory;
  about: string;
  specs: readonly string[];
  pattern: RegExp;
}

const MAX_DETECTED = 10;
const MAX_SPECS = 12;
const CATEGORY_ORDER: readonly TopicCategory[] = ["procedure", "interface", "command", "protocol"];

function word(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

function iface(tag: string, about: string, specs: readonly string[], pattern = new RegExp(`\\b${word(tag)}\\b`)): Topic {
  return { tag, category: "interface", about, specs, pattern };
}

function service(tag: string, about: string, specs: readonly string[]): Topic {
  return iface(tag, about, specs, new RegExp(`\\b${tag}(?:_|\\b)`));
}

function protocol(tag: string, about: string, specs: readonly string[], pattern: RegExp): Topic {
  return { tag, category: "protocol", about, specs, pattern };
}

function procedure(tag: string, specs: readonly string[], pattern: RegExp): Topic {
  return { tag, category: "procedure", about: `${tag} procedure`, specs, pattern };
}

function command(request: string, answer: string, name: string, specs: readonly string[], ambiguous = false): Topic {
  const longName = `\\b${word(name)}-(?:Request|Answer)\\b`;
  const pattern = ambiguous
    ? new RegExp(`${longName}|\\b${request}\\b[\\s\\S]*\\b${answer}\\b|\\b${answer}\\b[\\s\\S]*\\b${request}\\b`)
    : new RegExp(`${longName}|\\b${request}\\b`);
  return { tag: `${request}/${answer}`, category: "command", about: `${name}-Request/Answer`, specs, pattern };
}

export const TOPICS: readonly Topic[] = [
  procedure("Attach", ["TS 23.401", "TS 24.301"], /\b(?:(?:EPS|initial|combined)\s+attach|attach\s+(?:request|accept|complete|reject|procedure|flow))\b/i),
  procedure("Detach", ["TS 23.401", "TS 24.301"], /\b(?:detach\s+(?:request|accept|procedure|flow)|(?:UE|network|MME|HSS)[- ]initiated\s+detach)\b/i),
  procedure("TAU", ["TS 23.401", "TS 24.301"], /\bTAU\b|\btracking\s+area\s+update\b/i),
  procedure("Registration", ["TS 23.502", "TS 24.501"], /\b(?:(?:initial|mobility|periodic|5GS?)\s+registration|registration\s+(?:request|accept|complete|reject))\b/i),
  procedure("Deregistration", ["TS 23.502", "TS 24.501"], /\bde-?registration\b/i),
  procedure("IMS Registration", ["TS 23.228", "TS 24.229"], /\bIMS\s+(?:re-?)?registration\b|\bREGISTER\b/),
  procedure("Service Request", ["TS 23.401", "TS 23.502"], /\bService\s+Request\b|\bservice\s+request\s+(?:procedure|message|flow)\b/),
  procedure("PDU Session", ["TS 23.502", "TS 24.501"], /\bPDU\s+session\b/i),
  procedure("PDN Connectivity", ["TS 23.401", "TS 24.301"], /\bPDN\s+connectivity\b/i),
  procedure("Default Bearer", ["TS 23.401"], /\bdefault\s+(?:EPS\s+)?bearer\b/i),
  procedure("Dedicated Bearer", ["TS 23.401"], /\bdedicated\s+(?:EPS\s+)?bearer\b/i),
  procedure("IP-CAN Session", ["TS 29.212", "TS 29.213"], /\bIP-CAN\s+session\b/i),
  procedure("Handover", ["TS 23.401", "TS 23.502"], /\bhand-?over\b/i),
  procedure("Paging", ["TS 23.401", "TS 23.502"], /\bpaging\s+(?:request|procedure|message|occasion)\b|\bUE\s+paging\b/i),
  procedure("EPS-AKA", ["TS 33.401"], /\bEPS[- ]AKA\b/),
  procedure("5G-AKA", ["TS 33.501"], /\b5G[- ]AKA\b/),
  procedure("EAP-AKA'", ["RFC 9048", "TS 33.501"], /\bEAP-AKA'/),
  procedure("CSFB", ["TS 23.272"], /\bCSFB\b|\bCS\s+fallback\b/i),
  procedure("SRVCC", ["TS 23.216"], /\bSRVCC\b/),
  procedure("VoLTE", [], /\bVoLTE\b/),
  procedure("VoNR", [], /\bVoNR\b/),

  iface("S6a", "MME ↔ HSS", ["TS 29.272"]),
  iface("S6d", "SGSN ↔ HSS", ["TS 29.272"]),
  iface("S13", "MME ↔ EIR", ["TS 29.272"]),
  iface("Gx", "PCEF ↔ PCRF", ["TS 29.212"]),
  iface("Gxx", "BBERF ↔ PCRF", ["TS 29.212"]),
  iface("Sd", "TDF ↔ PCRF", ["TS 29.212"]),
  iface("Rx", "AF ↔ PCRF", ["TS 29.214"], /(?<!Tx\/)\bRx\b(?!\/Tx)/),
  iface("Gy", "PCEF ↔ OCS", ["TS 32.299"]),
  iface("Ro", "CTF ↔ OCS", ["TS 32.299"]),
  iface("Rf", "CTF ↔ CDF", ["TS 32.299"]),
  iface("S9", "H-PCRF ↔ V-PCRF", ["TS 29.215"]),
  iface("Sy", "PCRF ↔ OCS", ["TS 29.219"]),
  iface("Cx", "I/S-CSCF ↔ HSS", ["TS 29.228", "TS 29.229"]),
  iface("Dx", "CSCF ↔ SLF", ["TS 29.228", "TS 29.229"]),
  iface("Sh", "AS ↔ HSS", ["TS 29.328", "TS 29.329"]),
  iface("SWx", "3GPP AAA ↔ HSS", ["TS 29.273"]),
  iface("S6b", "PGW ↔ 3GPP AAA", ["TS 29.273"]),
  iface("SWm", "ePDG ↔ 3GPP AAA", ["TS 29.273"]),
  iface("STa", "Trusted non-3GPP access ↔ 3GPP AAA", ["TS 29.273"]),
  iface("SWa", "Untrusted non-3GPP access ↔ 3GPP AAA", ["TS 29.273"]),
  iface("T6a/T6b", "MME/SGSN ↔ SCEF", ["TS 29.128"], /\bT6[ab]\b/),
  iface("S6t", "SCEF ↔ HSS", ["TS 29.336"]),
  iface("SLg", "MME ↔ GMLC", ["TS 29.172"]),
  iface("SLh", "GMLC ↔ HSS", ["TS 29.173"]),
  iface("SGd", "MME ↔ SMS-C", ["TS 29.338"]),
  iface("S6c", "SMS-GMSC ↔ HSS", ["TS 29.338"]),
  iface("Zh", "BSF ↔ HSS", ["TS 29.109"]),
  iface("S1-MME", "eNB ↔ MME", ["TS 36.413"]),
  iface("S1-U", "eNB ↔ SGW", ["TS 29.281"]),
  iface("S11", "MME ↔ SGW", ["TS 29.274"]),
  iface("S5/S8", "SGW ↔ PGW", ["TS 29.274"], /\bS5\b|\bS8\b/),
  iface("S10", "MME ↔ MME", ["TS 29.274"]),
  iface("S2b", "ePDG ↔ PGW", ["TS 29.274"]),
  iface("SGs", "MME ↔ MSC/VLR", ["TS 29.118"]),
  iface("SGi", "PGW ↔ PDN", ["TS 29.061"]),
  iface("Gn/Gp", "SGSN ↔ GGSN", ["TS 29.060"], /\bG[np]\b/),
  iface("X2", "eNB ↔ eNB", ["TS 36.423"]),
  iface("N1", "UE ↔ AMF", ["TS 24.501"]),
  iface("N2", "gNB ↔ AMF", ["TS 38.413"]),
  iface("N3", "gNB ↔ UPF", ["TS 29.281"]),
  iface("N4", "SMF ↔ UPF", ["TS 29.244"]),
  iface("N7", "SMF ↔ PCF", ["TS 29.512"]),
  iface("N8", "AMF ↔ UDM", ["TS 29.503"]),
  iface("N9", "UPF ↔ UPF", ["TS 29.281"]),
  iface("N10", "SMF ↔ UDM", ["TS 29.503"]),
  iface("N11", "AMF ↔ SMF", ["TS 29.502"]),
  iface("N12", "AMF ↔ AUSF", ["TS 29.509"]),
  iface("N13", "AUSF ↔ UDM", ["TS 29.503"]),
  iface("N14", "AMF ↔ AMF", ["TS 29.518"]),
  iface("N15", "AMF ↔ PCF", ["TS 29.507"]),
  iface("N22", "AMF ↔ NSSF", ["TS 29.531"]),
  iface("N26", "AMF ↔ MME", ["TS 29.274"]),
  iface("N40", "SMF ↔ CHF", ["TS 32.291"]),
  service("Nudm", "UDM services", ["TS 29.503"]),
  service("Namf", "AMF services", ["TS 29.518"]),
  service("Nsmf", "SMF services", ["TS 29.502"]),
  service("Npcf", "PCF services", ["TS 29.507", "TS 29.512", "TS 29.514"]),
  service("Nausf", "AUSF services", ["TS 29.509"]),
  service("Nnrf", "NRF services", ["TS 29.510"]),
  service("Nudr", "UDR services", ["TS 29.504"]),
  service("Nnssf", "NSSF services", ["TS 29.531"]),
  service("Nnef", "NEF services", ["TS 29.522"]),
  service("Nsmsf", "SMSF services", ["TS 29.540"]),
  service("Nbsf", "BSF services", ["TS 29.521"]),
  service("Nchf", "CHF services", ["TS 32.291"]),

  command("ULR", "ULA", "Update-Location", ["TS 29.272"]),
  command("AIR", "AIA", "Authentication-Information", ["TS 29.272"], true),
  command("CLR", "CLA", "Cancel-Location", ["TS 29.272"]),
  command("IDR", "IDA", "Insert-Subscriber-Data", ["TS 29.272"]),
  command("DSR", "DSA", "Delete-Subscriber-Data", ["TS 29.272"]),
  command("PUR", "PUA", "Purge-UE", ["TS 29.272"]),
  command("RSR", "RSA", "Reset", ["TS 29.272"]),
  command("NOR", "NOA", "Notify", ["TS 29.272"], true),
  command("ECR", "ECA", "ME-Identity-Check", ["TS 29.272"]),
  command("CCR", "CCA", "Credit-Control", ["TS 29.212", "TS 32.299"]),
  command("RAR", "RAA", "Re-Auth", ["RFC 6733"]),
  command("AAR", "AAA", "AA", ["TS 29.214"]),
  command("STR", "STA", "Session-Termination", ["RFC 6733"], true),
  command("ASR", "ASA", "Abort-Session", ["RFC 6733"], true),
  command("UAR", "UAA", "User-Authorization", ["TS 29.229"]),
  command("SAR", "SAA", "Server-Assignment", ["TS 29.229", "TS 29.273"], true),
  command("LIR", "LIA", "Location-Info", ["TS 29.229"]),
  command("MAR", "MAA", "Multimedia-Auth", ["TS 29.229", "TS 29.273"], true),
  command("RTR", "RTA", "Registration-Termination", ["TS 29.229", "TS 29.273"]),
  command("PPR", "PPA", "Push-Profile", ["TS 29.229", "TS 29.273"]),
  command("UDR", "UDA", "User-Data", ["TS 29.329"], true),
  command("SNR", "SNA", "Subscribe-Notifications", ["TS 29.329"]),
  command("PNR", "PNA", "Push-Notification", ["TS 29.329"]),
  command("CER", "CEA", "Capabilities-Exchange", ["RFC 6733"]),
  command("DWR", "DWA", "Device-Watchdog", ["RFC 6733"]),
  command("DPR", "DPA", "Disconnect-Peer", ["RFC 6733"]),
  command("ACR", "ACA", "Accounting", ["RFC 6733", "TS 32.299"], true),

  protocol("Diameter", "Diameter base protocol", ["RFC 6733"], /\bDiameter\b/),
  protocol("GTPv2-C", "GTP control plane", ["TS 29.274"], /\bGTPv2(?:-C)?\b|\bGTP-C\b/),
  protocol("GTP-U", "GTP user plane", ["TS 29.281"], /\bGTP-U\b/),
  protocol("PFCP", "Packet Forwarding Control Protocol", ["TS 29.244"], /\bPFCP\b/),
  protocol("NGAP", "NG Application Protocol", ["TS 38.413"], /\bNGAP\b/),
  protocol("S1AP", "S1 Application Protocol", ["TS 36.413"], /\bS1-?AP\b/),
  protocol("NAS", "Non-Access Stratum", ["TS 24.301", "TS 24.501"], /\bNAS\b/),
  protocol("RRC", "Radio Resource Control", ["TS 36.331", "TS 38.331"], /\bRRC\b/),
  protocol("SGsAP", "SGs Application Part", ["TS 29.118"], /\bSGsAP\b/),
  protocol("SBI", "5GC service-based interfaces", ["TS 29.500"], /\bSBI\b/),
  protocol("SIP", "Session Initiation Protocol", ["RFC 3261", "TS 24.229"], /\bSIP\b/),
  protocol("SCTP", "Stream Control Transmission Protocol", ["RFC 9260"], /\bSCTP\b/),
  protocol("RADIUS", "RADIUS", ["RFC 2865"], /\bRADIUS\b/),
];

const TOPICS_BY_TAG = new Map(TOPICS.map((topic) => [topic.tag.toLowerCase(), topic]));

export function topicFor(tag: string): Topic | undefined {
  return TOPICS_BY_TAG.get(tag.toLowerCase());
}

export function detectTags(text: string): string[] {
  const found = TOPICS.flatMap((topic) => {
    const index = text.search(topic.pattern);
    return index < 0 ? [] : [{ topic, index }];
  });
  found.sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.topic.category) - CATEGORY_ORDER.indexOf(b.topic.category) || a.index - b.index,
  );
  return found.slice(0, MAX_DETECTED).map(({ topic }) => topic.tag);
}

export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const cleaned = truncate(raw.replace(/^#+/, "").replace(/\s+/g, " ").trim(), LIMITS.tag);
    if (cleaned === "") continue;
    const tag = topicFor(cleaned)?.tag ?? cleaned;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length === LIMITS.tags) break;
  }
  return result;
}

export function specReferences(text: string): string[] {
  return [...text.matchAll(/\b(?:TS\s?(\d{2})\.(\d{3})|RFC\s?(\d{3,5}))\b/g)].map((match) =>
    match[3] === undefined ? `TS ${match[1]}.${match[2]}` : `RFC ${match[3]}`,
  );
}

export function specsFor(tags: readonly string[], text: string): string[] {
  const topicSpecs = tags.flatMap((tag) => topicFor(tag)?.specs ?? []);
  return [...new Set([...specReferences(text), ...topicSpecs])].slice(0, MAX_SPECS);
}

export function specUrl(spec: string): string | null {
  const ts = /^TS (\d{2})\.(\d{3})$/.exec(spec);
  if (ts !== null) return `https://www.3gpp.org/DynaReport/${ts[1]}${ts[2]}.htm`;
  const rfc = /^RFC (\d+)$/.exec(spec);
  return rfc === null ? null : `https://www.rfc-editor.org/rfc/rfc${rfc[1]}`;
}
