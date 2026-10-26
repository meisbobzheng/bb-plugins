import { hash } from "../../spectrum";
import { rgbOf, rng } from "./brush";

type Point = { x: number; y: number };
type Glaze = [string, string, string, "dot" | "arc" | "stroke" | "horizon"];

interface Stroke {
  seed: number;
  color: string;
  bristles: number;
  dot: number;
  dry: number;
  ink(u: number): number;
  width(u: number): number;
}

const GLAZES: Record<string, Glaze> = {
  Elaenia: ["#86a09a", "#22302f", "#efe7d6", "arc"],
  Migration: ["#b0b39c", "#4a523f", "#1f221b", "stroke"],
  "In Colour": ["#dccfb4", "#9a8a69", "#2b2620", "dot"],
  "Sixteen Oceans": ["#9cbcc2", "#3c636c", "#f2ebdb", "horizon"],
  "In Rainbows": ["#c8643f", "#3a2822", "#f1e2c4", "stroke"],
  Discovery: ["#575d80", "#1d2036", "#dcc38e", "dot"],
  Mordechai: ["#d2b06f", "#8a6534", "#2a2018", "dot"],
  "Our Love": ["#9a4232", "#46201a", "#f0dbc4", "arc"],
  "Actual Life 3": ["#c2bcae", "#6d685e", "#1d1b19", "stroke"],
  "Hurry Up, We're Dreaming": ["#43546b", "#161d2a", "#e5d1a8", "dot"],
  OutRun: ["#a8486f", "#36182f", "#f2b77d", "horizon"],
};
const KILNS = Object.values(GLAZES);

const cache = new Map<string, string | null>();

export const ratio = () => Math.min(3, Math.max(2, typeof window === "undefined" ? 2 : window.devicePixelRatio || 1));

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  return context === null ? null : [canvas, context];
}

export function painted(key: string, width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): string | null {
  if (cache.has(key)) return cache.get(key)!;
  const surface = canvasOf(width, height);
  const url = surface === null ? null : (draw(surface[1]), surface[0].toDataURL());
  cache.set(key, url);
  if (cache.size > 80) cache.delete(cache.keys().next().value!);
  return url;
}

function blob(cx: number, cy: number, radius: number, random: () => number, amplitude: number): Path2D {
  const path = new Path2D();
  const [p1, p2] = [random() * 6.28, random() * 6.28];
  for (let index = 0; index < 120; index += 1) {
    const angle = (index / 120) * Math.PI * 2;
    const r = radius * (1 + amplitude * (Math.sin(angle * 3 + p1) * 0.6 + Math.sin(angle * 7 + p2) * 0.3 + Math.sin(angle * 17 + p1) * 0.15));
    if (index === 0) path.moveTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    else path.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  path.closePath();
  return path;
}

function brush(context: CanvasRenderingContext2D, points: Point[], stroke: Stroke) {
  const random = rng(stroke.seed);
  const last = points.length - 1;
  const hairs = Array.from({ length: stroke.bristles }, () => {
    const offset = random() * 2 - 1;
    return { offset, alpha: 0.55 + 0.45 * random(), dry: stroke.dry + (1 - stroke.dry) * random() * (1 - 0.45 * Math.abs(offset)), k: 18 + random() * 50, phase: random() * 6.28, scale: 0.75 + random() * 0.5 };
  });
  context.fillStyle = stroke.color;
  for (let index = 0; index <= last; index += 1) {
    const u = index / last;
    const [p, q, r] = [points[index]!, points[Math.min(last, index + 1)]!, points[Math.max(0, index - 1)]!];
    const [tx, ty] = [q.x - r.x, q.y - r.y];
    const length = Math.hypot(tx, ty) || 1;
    const [nx, ny] = [-ty / length, tx / length];
    const width = stroke.width(u);
    const ink = stroke.ink(u);
    for (const hair of hairs) {
      let alpha = hair.alpha * ink * (0.8 + 0.2 * Math.sin(u * hair.k + hair.phase));
      if (u > hair.dry) alpha *= Math.max(0, 1 - (u - hair.dry) * 9);
      if (alpha < 0.03 || Math.sin(u * hair.k * 1.9 + hair.phase * 3) > 1.2 - u * 0.95) continue;
      context.globalAlpha = alpha * 0.55;
      context.beginPath();
      context.arc(p.x + (nx * hair.offset * width) / 2, p.y + (ny * hair.offset * width) / 2, Math.max(0.6, stroke.dot * hair.scale), 0, Math.PI * 2);
      context.fill();
    }
  }
  context.globalAlpha = 1;
}

export function enso(size: number, ink: string, seed: number): string | null {
  const scale = ratio();
  const side = Math.round(size * scale);
  return painted(`enso|${size}|${ink}|${seed}|${scale}`, side, side, (context) => {
    const random = rng(seed);
    const [cx, cy, r] = [side * (0.5 + (random() - 0.5) * 0.02), side * (0.5 + (random() - 0.5) * 0.02), side * 0.385];
    const start = -2.35 + random() * 0.4;
    const sweep = Math.PI * 2 * (0.86 + random() * 0.05);
    const phase = random() * 6.28;
    const heavy = size < 60 ? 1.35 : 1;
    const count = Math.round((r * sweep) / Math.max(0.5, side * 0.0024));
    const points = Array.from({ length: count + 1 }, (_, index) => {
      const u = index / count;
      const theta = start + sweep * u;
      const rr = r * (1 + 0.02 * Math.sin(u * 9.4 + phase) + 0.01 * Math.sin(u * 23 + phase * 2) + 0.045 * u * u);
      return { x: cx + rr * Math.cos(theta), y: cy + rr * Math.sin(theta) };
    });
    brush(context, points, {
      seed,
      color: ink,
      bristles: Math.round(24 + side / 12),
      dot: side * 0.0045 * heavy,
      dry: 0.5,
      ink: (u) => 1 - 0.25 * u,
      width: (u) => heavy * (side * 0.08 * (0.62 + 0.38 * Math.min(1, u * 9)) * (1 - 0.5 * Math.pow(u, 1.25)) * (1 + 0.1 * Math.sin(u * 13 + phase)) + side * 0.028 * Math.exp(-u * 36)),
    });
    if (size <= 60) return;
    context.fillStyle = ink;
    for (let index = 0; index < 4; index += 1) {
      const angle = start - 0.12 - random() * 0.35;
      const distance = r * (1 + (random() - 0.5) * 0.25);
      context.globalAlpha = 0.45 + random() * 0.4;
      context.beginPath();
      context.arc(cx + distance * Math.cos(angle), cy + distance * Math.sin(angle), side * (0.003 + random() * 0.005), 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  });
}

function glaze(context: CanvasRenderingContext2D, side: number, random: () => number, light: string, dark: string) {
  const ground = context.createRadialGradient(side * (0.3 + random() * 0.2), side * (0.25 + random() * 0.2), side * 0.02, side * 0.5, side * 0.55, side * 0.78);
  ground.addColorStop(0, light);
  ground.addColorStop(1, dark);
  context.fillStyle = ground;
  context.fillRect(0, 0, side, side);
  pool(context, side, random, 6);
}

function pool(context: CanvasRenderingContext2D, side: number, random: () => number, count: number) {
  for (let index = 0; index < count; index += 1) {
    const [x, y, r] = [random() * side, random() * side, side * (0.1 + random() * 0.3)];
    const spot = context.createRadialGradient(x, y, 0, x, y, r);
    spot.addColorStop(0, random() < 0.5 ? "rgba(255,240,215,.10)" : "rgba(0,0,0,.15)");
    spot.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = spot;
    context.fillRect(0, 0, side, side);
  }
}

function crackle(context: CanvasRenderingContext2D, side: number, random: () => number, count: number) {
  context.lineWidth = Math.max(0.6, side / 420);
  for (let index = 0; index < count; index += 1) {
    let [x, y, angle] = [random() * side, random() * side, random() * 6.28];
    context.strokeStyle = random() < 0.7 ? "rgba(0,0,0,.22)" : "rgba(255,236,205,.13)";
    context.beginPath();
    context.moveTo(x, y);
    for (let step = 0; step < 4; step += 1) {
      angle += (random() - 0.5) * 1.6;
      x += Math.cos(angle) * side * 0.05;
      y += Math.sin(angle) * side * 0.05;
      context.lineTo(x, y);
    }
    context.stroke();
  }
}

function grain(context: CanvasRenderingContext2D, side: number, amount: number, random: () => number) {
  const image = context.getImageData(0, 0, side, side);
  const pixels = image.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const noise = (random() - 0.5) * amount;
    pixels[index] = pixels[index]! + noise;
    pixels[index + 1] = pixels[index + 1]! + noise;
    pixels[index + 2] = pixels[index + 2]! + noise;
  }
  context.putImageData(image, 0, 0);
}

function currents(context: CanvasRenderingContext2D, side: number) {
  const random = rng(77);
  const rim = blob(side / 2, side / 2, side * 0.47, random, 0.012);
  context.save();
  context.clip(rim);
  glaze(context, side, random, "#7b5670", "#1e1626");
  const [a, bx, by] = [side * 0.105, side * 0.58, side * 0.5];
  for (let line = -12; line <= 12; line += 1) {
    if (line === 0) continue;
    const c = line * side * 0.04;
    context.beginPath();
    for (let x = -side * 0.05, first = true; x <= side * 1.05; x += side / 150, first = false) {
      const dx = x - bx;
      let [lo, hi] = [c, c + Math.sign(c) * a * 1.5];
      for (let step = 0; step < 22; step += 1) {
        const m = (lo + hi) / 2;
        if (m * (1 - (a * a) / (dx * dx + m * m)) - c > 0 === c > 0) hi = m;
        else lo = m;
      }
      const y = by + (lo + hi) / 2 + Math.sin((x / side) * 7 + line * 1.3) * side * 0.004;
      if (first) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    const warm = line % 4 === 0;
    context.strokeStyle = warm ? "rgba(222,140,92,.8)" : `rgba(238,226,206,${(0.36 + random() * 0.3).toFixed(2)})`;
    context.lineWidth = side * (warm ? 0.008 : 0.0035 + random() * 0.003);
    context.stroke();
  }
  const ball = context.createRadialGradient(bx - a * 0.35, by - a * 0.4, a * 0.05, bx, by, a * 0.95);
  ball.addColorStop(0, "#e8c47c");
  ball.addColorStop(0.2, "#6b4c3a");
  ball.addColorStop(0.62, "#1d1418");
  ball.addColorStop(1, "#0d090c");
  context.fillStyle = ball;
  context.beginPath();
  context.arc(bx, by, a * 0.9, 0, Math.PI * 2);
  context.fill();
  crackle(context, side, random, 34);
  context.restore();
  grain(context, side, 26, random);
  context.strokeStyle = "rgba(20,12,16,.35)";
  context.lineWidth = side * 0.008;
  context.stroke(rim);
}

function vessel(context: CanvasRenderingContext2D, side: number, album: string) {
  const seed = hash(album);
  const random = rng(seed);
  const [light, dark, mark, kind] = GLAZES[album] ?? KILNS[seed % KILNS.length]!;
  const rim = blob(side / 2, side / 2, side * 0.47, random, 0.016);
  context.save();
  context.clip(rim);
  glaze(context, side, random, light, dark);
  if (album !== "") {
    if (kind === "dot") {
      context.fillStyle = mark;
      context.globalAlpha = 0.88;
      context.fill(blob(side * (0.55 + random() * 0.1), side * (0.4 + random() * 0.1), side * 0.15, random, 0.06));
      context.globalAlpha = 1;
    } else {
      const count = Math.round(side * 1.4);
      const points = Array.from({ length: count + 1 }, (_, index) => {
        const u = index / count;
        if (kind === "arc") {
          const theta = Math.PI * (1.05 + 1.05 * u);
          return { x: side * 0.5 + Math.cos(theta) * side * 0.27, y: side * 0.6 + Math.sin(theta) * side * 0.27 };
        }
        if (kind === "horizon") return { x: side * (0.08 + 0.84 * u), y: side * (0.64 + 0.012 * Math.sin(u * 5)) };
        return { x: side * (0.16 + 0.68 * u), y: side * (0.56 - 0.08 * u + 0.03 * Math.sin(u * 3.5)) };
      });
      brush(context, points, { seed, color: mark, bristles: 30, dot: side * 0.006, dry: 0.45, ink: (u) => 1 - 0.2 * u, width: (u) => side * (kind === "horizon" ? 0.035 : 0.09) * (0.7 + 0.3 * Math.min(1, u * 8)) * (1 - 0.45 * u) });
      if (kind === "horizon") {
        context.fillStyle = mark;
        context.globalAlpha = 0.85;
        context.fill(blob(side * 0.64, side * 0.42, side * 0.08, random, 0.05));
        context.globalAlpha = 1;
      }
    }
  }
  crackle(context, side, random, 18);
  context.restore();
  grain(context, side, 22, random);
  context.strokeStyle = "rgba(0,0,0,.25)";
  context.lineWidth = side * 0.008;
  context.stroke(rim);
}

function fired(context: CanvasRenderingContext2D, side: number, image: HTMLImageElement, seed: number) {
  const random = rng(seed);
  const rim = blob(side / 2, side / 2, side * 0.47, random, 0.014);
  context.save();
  context.clip(rim);
  context.drawImage(image, 0, 0, side, side);
  const sheen = context.createRadialGradient(side * 0.34, side * 0.28, side * 0.02, side * 0.5, side * 0.55, side * 0.75);
  sheen.addColorStop(0, "rgba(255,244,222,.16)");
  sheen.addColorStop(0.6, "rgba(0,0,0,0)");
  sheen.addColorStop(1, "rgba(10,6,4,.42)");
  context.fillStyle = sheen;
  context.fillRect(0, 0, side, side);
  pool(context, side, random, 4);
  crackle(context, side, random, 22);
  context.restore();
  context.strokeStyle = "rgba(0,0,0,.3)";
  context.lineWidth = side * 0.01;
  context.stroke(rim);
}

export function glazed(album: string, size: number): string | null {
  const side = Math.round(size * ratio());
  return painted(`cover|${album}|${side}`, side, side, (context) => (album === "Currents" ? currents(context, side) : vessel(context, side, album)));
}

export function fire(art: string, size: number): Promise<string | null> {
  const side = Math.round(size * ratio());
  const key = `art|${hash(art)}|${side}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(painted(key, side, side, (context) => fired(context, side, image, hash(art))));
    image.onerror = () => resolve(null);
    image.src = art;
  });
}

export function fibers(ink: string): string | null {
  const side = 1024;
  return painted(`fibers|${ink}`, side, side, (context) => {
    const random = rng(19);
    const dark = rgbOf(ink);
    for (let index = 0; index < 420; index += 1) {
      const [x, y, length, angle, bend, shade] = [random() * side, random() * side, 24 + random() * 120, random() * 6.28, (random() - 0.5) * 1.6, random() < 0.16];
      context.strokeStyle = shade ? `rgba(${dark},${(0.1 + random() * 0.18).toFixed(2)})` : `rgba(255,252,244,${(0.28 + random() * 0.45).toFixed(2)})`;
      context.lineWidth = shade ? 0.7 + random() * 0.6 : 0.6 + random() * 1.5;
      for (const ox of [-side, 0, side])
        for (const oy of [-side, 0, side]) {
          context.beginPath();
          context.moveTo(x + ox, y + oy);
          const mx = x + ox + Math.cos(angle) * length * 0.5 - Math.sin(angle) * length * bend * 0.3;
          const my = y + oy + Math.sin(angle) * length * 0.5 + Math.cos(angle) * length * bend * 0.3;
          context.quadraticCurveTo(mx, my, x + ox + Math.cos(angle + bend * 0.4) * length, y + oy + Math.sin(angle + bend * 0.4) * length);
          context.stroke();
        }
    }
  });
}
