import { hash } from "../../spectrum";

const FONT = `A 01110 10001 10001 11111 10001 10001 10001
B 11110 10001 10001 11110 10001 10001 11110
C 01110 10001 10000 10000 10000 10001 01110
D 11110 10001 10001 10001 10001 10001 11110
E 11111 10000 10000 11110 10000 10000 11111
F 11111 10000 10000 11110 10000 10000 10000
G 01110 10001 10000 10111 10001 10001 01111
H 10001 10001 10001 11111 10001 10001 10001
I 01110 00100 00100 00100 00100 00100 01110
J 00111 00010 00010 00010 00010 10010 01100
K 10001 10010 10100 11000 10100 10010 10001
L 10000 10000 10000 10000 10000 10000 11111
M 10001 11011 10101 10101 10001 10001 10001
N 10001 10001 11001 10101 10011 10001 10001
O 01110 10001 10001 10001 10001 10001 01110
P 11110 10001 10001 11110 10000 10000 10000
Q 01110 10001 10001 10001 10101 10010 01101
R 11110 10001 10001 11110 10100 10010 10001
S 01111 10000 10000 01110 00001 00001 11110
T 11111 00100 00100 00100 00100 00100 00100
U 10001 10001 10001 10001 10001 10001 01110
V 10001 10001 10001 10001 10001 01010 00100
W 10001 10001 10001 10101 10101 10101 01010
X 10001 10001 01010 00100 01010 10001 10001
Y 10001 10001 01010 00100 00100 00100 00100
Z 11111 00001 00010 00100 01000 10000 11111
0 01110 10001 10011 10101 11001 10001 01110
1 00100 01100 00100 00100 00100 00100 01110
2 01110 10001 00001 00010 00100 01000 11111
3 11111 00010 00100 00010 00001 10001 01110
4 00010 00110 01010 10010 11111 00010 00010
5 11111 10000 11110 00001 00001 10001 01110
6 00110 01000 10000 11110 10001 10001 01110
7 11111 00001 00010 00100 01000 01000 01000
8 01110 10001 10001 01110 10001 10001 01110
9 01110 10001 10001 01111 00001 00010 01100
' 00100 00100 01000 00000 00000 00000 00000
" 01010 01010 00000 00000 00000 00000 00000
. 00000 00000 00000 00000 00000 01100 01100
, 00000 00000 00000 00000 01100 00100 01000
- 00000 00000 00000 01110 00000 00000 00000
_ 00000 00000 00000 00000 00000 00000 11111
/ 00001 00010 00010 00100 01000 01000 10000
: 00000 01100 01100 00000 01100 01100 00000
; 00000 01100 01100 00000 01100 00100 01000
( 00010 00100 01000 01000 01000 00100 00010
) 01000 00100 00010 00010 00010 00100 01000
[ 01110 01000 01000 01000 01000 01000 01110
] 01110 00010 00010 00010 00010 00010 01110
& 01100 10010 10100 01000 10101 10010 01101
? 01110 10001 00001 00010 00100 00000 00100
! 00100 00100 00100 00100 00100 00000 00100
+ 00000 00100 00100 11111 00100 00100 00000
= 00000 00000 11111 00000 11111 00000 00000
* 00000 10101 01110 11111 01110 10101 00000
# 01010 11111 01010 01010 11111 01010 00000
$ 00100 01111 10100 01110 00101 11110 00100
% 11001 11010 00010 00100 01000 01011 10011`;

export const GLYPHS: Record<string, string[]> = Object.fromEntries(FONT.split("\n").map((line) => [line[0]!, line.slice(2).split(" ")]));

export const ICONS = {
  play: ["1100000", "1111000", "1111110", "1111111", "1111110", "1111000", "1100000"],
  pause: ["1100011", "1100011", "1100011", "1100011", "1100011", "1100011", "1100011"],
  prev: ["1100001", "1100011", "1100111", "1101111", "1100111", "1100011", "1100001"],
  next: ["1000011", "1100011", "1110011", "1111011", "1110011", "1100011", "1000011"],
  heart: ["0110110", "1111111", "1111111", "1111111", "0111110", "0011100", "0001000"],
  heart0: ["0110110", "1001001", "1000001", "1000001", "0100010", "0010100", "0001000"],
  shuffle: ["0000100", "1111110", "0000100", "0000000", "0010000", "0111111", "0010000"],
  repeat: ["0001000", "1111100", "1001000", "1000001", "0001001", "0011111", "0001000"],
  speaker: ["0001000", "0011001", "1111010", "1111010", "1111010", "0011001", "0001000"],
  link: ["0111000", "1000100", "1001110", "1010101", "0111001", "0010001", "0001110"],
  at: ["0111110", "1000001", "1011101", "1010101", "1011110", "1000000", "0111110"],
  card: ["1111111", "1000001", "1011101", "1011101", "1000001", "1011001", "1111111"],
  laptop: ["0111110", "0100010", "0100010", "0111110", "1111111"],
  lock: ["0011100", "0100010", "0100010", "1111111", "1110111", "1110111", "1111111"],
  search: ["0111000", "1000100", "1000100", "1000100", "0111100", "0000010", "0000001"],
  plus: ["00100", "00100", "11111", "00100", "00100"],
  close: ["10001", "01010", "00100", "01010", "10001"],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof ICONS;

export function runs(rows: readonly string[], scale: number, ox = 0, oy = 0): string {
  let path = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      if (row[x] !== "1") {
        x += 1;
        continue;
      }
      let end = x;
      while (row[end] === "1") end += 1;
      path += `M${ox + x * scale} ${oy + y * scale}h${(end - x) * scale}v${scale}h${(x - end) * scale}z`;
      x = end;
    }
  });
  return path;
}

export const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

export function pixelable(text: string): boolean {
  return [...plain(text)].every((char) => char === " " || GLYPHS[char] !== undefined);
}

export function textPath(text: string, scale: number): { d: string; width: number; height: number } {
  let d = "";
  let x = 0;
  for (const char of plain(text)) {
    const glyph = GLYPHS[char];
    if (glyph !== undefined) d += runs(glyph, scale, x * scale);
    x += 6;
  }
  return { d, width: Math.max(0, x - 1) * scale, height: 7 * scale };
}

export function wrapWords(text: string, chars: number): string[] {
  const width = Math.max(1, chars);
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (let rest = word; rest !== "";) {
      const joined = line === "" ? rest : `${line} ${rest}`;
      if (joined.length <= width) {
        line = joined;
        rest = "";
      } else if (line !== "") {
        lines.push(line);
        line = "";
      } else {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
    }
  }
  if (line !== "") lines.push(line);
  return lines.length === 0 ? [""] : lines;
}

export function clip(text: string, chars: number): string {
  return text.length <= chars ? text : `${text.slice(0, Math.max(0, chars - 3)).trimEnd()}...`;
}

export const charsFor = (width: number, scale: number) => Math.floor((width + scale) / (6 * scale));

export function fitPixels(text: string, width: number, scales: readonly number[], maxLines = 1): { scale: number; lines: string[] } {
  if (width <= 0) return { scale: scales[0]!, lines: [text] };
  for (const scale of scales.slice(0, -1)) if (text.length <= charsFor(width, scale)) return { scale, lines: [text] };
  const scale = scales[scales.length - 1]!;
  const chars = charsFor(width, scale);
  const lines = wrapWords(text, chars);
  if (lines.length <= maxLines) return { scale, lines };
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = clip(`${kept[maxLines - 1]} ${lines[maxLines]}`, chars);
  return { scale, lines: kept };
}

export function identicon(seed: string): { rows: string[]; tone: number } {
  const value = hash(seed);
  const rows = Array.from({ length: 7 }, (_, y) => {
    let half = "";
    for (let x = 0; x < 4; x += 1) half += (value >>> ((y * 4 + x) % 32)) & 1 ? "1" : "0";
    return half + [...half.slice(0, 3)].reverse().join("");
  });
  return { rows, tone: value % 4 };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function coverTones(luma: Float32Array | null, size: number, tones = 5): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (luma !== null) {
        const dither = (BAYER[(y % 4) * 4 + (x % 4)]! / 16 - 0.5) * (1 / tones);
        out[index] = Math.max(0, Math.min(tones - 1, Math.floor((luma[index]! + dither) * tones)));
        continue;
      }
      const u = (x / size) * 16;
      const v = (y / size) * 16;
      const [dx, dy] = [u - 10.5, v - 5.5];
      const distance = dx * dx + dy * dy;
      if (distance < 7) {
        out[index] = tones - 1;
        continue;
      }
      const push = distance < 30 ? ((30 - distance) / 9) * Math.sign(dy || 1) : 0;
      const wave = v + 2.6 * Math.sin(u / 3.3) + push;
      out[index] = [0, 1, 2, 3, 2, 1][((Math.floor(wave / 1.7) % 6) + 6) % 6]!;
    }
  return out;
}

export function tonePaths(tones: Uint8Array, size: number, scale: number, count = 5): string[] {
  return Array.from({ length: count }, (_, tone) => {
    const rows = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (tones[y * size + x] === tone ? "1" : "0")).join(""));
    return runs(rows, scale);
  });
}

export function headCell(fraction: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor(fraction * count)));
}

export function vox(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 14);
  return `${slug || "disc"}.vox`;
}

export function tagFor(reason: string | null, vibe: boolean): "fresh" | "vibe" | "spread" | null {
  if (reason === null) return null;
  if (/^(unheard|new to)/.test(reason)) return "fresh";
  return vibe ? "vibe" : "spread";
}
