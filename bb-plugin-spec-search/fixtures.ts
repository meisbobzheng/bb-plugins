import { deflateRawSync } from "node:zlib";

export function makeZip(files: Record<string, string | Buffer>, { deflate = true } = {}): Buffer {
  const locals: Buffer[] = [];
  const entries: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const data = deflate ? deflateRawSync(raw) : raw;
    const fileName = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(deflate ? 8 : 0, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(fileName.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, fileName, data);
    entries.push(entry, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const directory = Buffer.concat(entries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const STYLES = `<?xml version="1.0"?><w:styles xmlns:w="w">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading8"><w:name w:val="heading 8"/></w:style>
<w:style w:type="paragraph" w:styleId="ZA"><w:name w:val="ZA"/></w:style>
<w:style w:type="paragraph" w:styleId="ZT"><w:name w:val="ZT"/></w:style>
</w:styles>`;

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function paragraph(text: string, style?: string): string {
  const runs = text
    .split("\t")
    .map((part) => `<w:r><w:t xml:space="preserve">${escape(part)}</w:t></w:r>`)
    .join("<w:r><w:tab/></w:r>");
  const properties = style === undefined ? "" : `<w:pPr><w:pStyle w:val="${style}"/><w:tabs><w:tab w:val="left" w:pos="1134"/></w:tabs></w:pPr>`;
  return `<w:p>${properties}${runs}</w:p>`;
}

export function table(rows: readonly (readonly string[])[]): string {
  return `<w:tbl>${rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
}

export function cover(spec: string, version: string, ...title: string[]): string {
  return table([[`3GPP TS ${spec} V${version} (2026-01)`]]).replace("<w:p>", '<w:p><w:pPr><w:pStyle w:val="ZA"/></w:pPr>') + title.map((line) => paragraph(line, "ZT")).join("");
}

export function makeDocx(body: string): Buffer {
  return makeZip({
    "word/styles.xml": STYLES,
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:mc="mc"><w:body>${body}</w:body></w:document>`,
  });
}

export const SPEC_29228 = makeDocx(
  [
    cover("29.228", "19.2.0", "3rd Generation Partnership Project;", "IP Multimedia (IM) Subsystem Cx and Dx interfaces;", "Signalling flows and message contents", "(Release 19)"),
    paragraph("Foreword", "Heading1"),
    paragraph("This Technical Specification has been produced by the 3rd Generation Partnership Project (3GPP)."),
    paragraph("6\tUser identity to HSS resolution", "Heading1"),
    paragraph("6.1\tUser registration status query", "Heading2"),
    paragraph("The I-CSCF sends a User-Authorization-Request to the HSS when it receives a SIP REGISTER request."),
    paragraph("Annex B (informative):\tUser profile UML model", "Heading8"),
    paragraph("B.1\tGeneral description", "Heading1"),
    paragraph("The following picture gives an outline of the UML model of the user profile, which is downloaded from HSS to S-CSCF."),
    paragraph("B.2\tService profile", "Heading1"),
    paragraph("B.2.1\tPublic Identification", "Heading2"),
    paragraph("The class Public Identification contains the public user identities associated with the service profile."),
    table([
      ["Attribute", "Description"],
      ["Identity", "SIP URI or TEL URI"],
    ]),
  ].join(""),
);
