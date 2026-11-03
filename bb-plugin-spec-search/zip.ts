import { inflateRawSync } from "node:zlib";

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

export interface ZipLimits {
  entries: number;
  entryBytes: number;
  totalBytes: number;
}

export interface ZipFile {
  name: string;
  data: Buffer;
}

interface Entry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

function directory(zip: Buffer, limits: ZipLimits): Entry[] {
  const floor = Math.max(0, zip.length - 0xffff - 22);
  let end = -1;
  for (let at = zip.length - 22; at >= floor; at--) {
    if (zip.readUInt32LE(at) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("Not a zip archive.");
  const count = zip.readUInt16LE(end + 10);
  if (count > limits.entries) throw new Error(`The archive has ${count} entries; the limit is ${limits.entries}.`);
  const entries: Entry[] = [];
  let at = zip.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== DIRECTORY_ENTRY) throw new Error("The archive directory is corrupt.");
    const nameLength = zip.readUInt16LE(at + 28);
    entries.push({
      name: zip.toString("utf8", at + 46, at + 46 + nameLength),
      flags: zip.readUInt16LE(at + 8),
      method: zip.readUInt16LE(at + 10),
      compressedSize: zip.readUInt32LE(at + 20),
      size: zip.readUInt32LE(at + 24),
      offset: zip.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return entries;
}

function extract(zip: Buffer, entry: Entry, maxBytes: number): Buffer {
  if (entry.flags & 1) throw new Error(`${entry.name} is encrypted.`);
  if (entry.size > maxBytes) throw new Error(`${entry.name} is ${entry.size} bytes unzipped; the limit is ${maxBytes}.`);
  if (entry.offset + 30 > zip.length || zip.readUInt32LE(entry.offset) !== LOCAL_HEADER) throw new Error(`${entry.name} is corrupt.`);
  const start = entry.offset + 30 + zip.readUInt16LE(entry.offset + 26) + zip.readUInt16LE(entry.offset + 28);
  const data = zip.subarray(start, start + entry.compressedSize);
  if (data.length !== entry.compressedSize) throw new Error(`${entry.name} is truncated.`);
  if (entry.method === STORED) {
    if (data.length > maxBytes) throw new Error(`${entry.name} is over the ${maxBytes} byte limit.`);
    return data;
  }
  if (entry.method !== DEFLATED) throw new Error(`${entry.name} uses unsupported compression method ${entry.method}.`);
  try {
    return inflateRawSync(data, { maxOutputLength: Math.max(1, maxBytes) });
  } catch {
    throw new Error(`${entry.name} is corrupt or unzips past the ${maxBytes} byte limit.`);
  }
}

export function unzip(zip: Buffer, wanted: (name: string) => boolean, limits: ZipLimits): ZipFile[] {
  const entries = directory(zip, limits)
    .filter((entry) => !entry.name.endsWith("/") && wanted(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  let total = 0;
  return entries.map((entry) => {
    const data = extract(zip, entry, Math.min(limits.entryBytes, limits.totalBytes - total));
    total += data.length;
    return { name: entry.name, data };
  });
}
