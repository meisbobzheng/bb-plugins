const RAMP = ".,-~:;=!*#$@";
const TONES = ["", "v-ta", "v-tb", "v-tc", "v-te", "v-tf"];
const TAU = Math.PI * 2;

export interface Pose {
  tilt: number;
  roll: number;
  spin: number;
  pulse: number;
  aspect: number;
}

export function donut(cols: number, rows: number): (pose: Pose) => string {
  const cells = cols * rows;
  const depth = new Float32Array(cells);
  const glyph: string[] = new Array<string>(cells).fill(" ");
  const tone = new Uint8Array(cells);
  const [radius, tube, eye] = [1.5, 0.85, 5];
  const zoom = (cols * eye * 0.44) / (radius + tube);
  return ({ tilt, roll, spin, pulse, aspect }) => {
    depth.fill(0);
    tone.fill(0);
    const [cA, sA, cB, sB] = [Math.cos(tilt), Math.sin(tilt), Math.cos(roll), Math.sin(roll)];
    const flat = 0.24 + pulse * 0.07;
    for (let theta = 0; theta < TAU; theta += 0.1) {
      const [ct, st] = [Math.cos(theta), Math.sin(theta)];
      const ring = radius + tube * ct;
      const height = flat * st;
      let [nr, ny] = [flat * ct, tube * st];
      const length = Math.hypot(nr, ny);
      [nr, ny] = [nr / length, ny / length];
      const groove = Math.abs(st) > 0.5 ? 0.8 + 0.2 * Math.sin(ring * 34) : 1;
      for (let phi = 0; phi < TAU; phi += 0.03) {
        const [cp, sp] = [Math.cos(phi), Math.sin(phi)];
        const [x, z, nx, nz] = [ring * cp, ring * sp, nr * cp, nr * sp];
        const [y1, z1, n1, nz1] = [height * cA - z * sA, height * sA + z * cA, ny * cA - nz * sA, ny * sA + nz * cA];
        const [x2, y2, ny2] = [x * cB - y1 * sB, x * sB + y1 * cB, nx * sB + n1 * cB];
        const ooz = 1 / (z1 + eye);
        const column = (cols / 2 + zoom * ooz * x2) | 0;
        const row = (rows / 2 - zoom * ooz * y2 * aspect) | 0;
        if (column < 0 || column >= cols || row < 0 || row >= rows) continue;
        const index = row * cols + column;
        if (ooz <= depth[index]!) continue;
        depth[index] = ooz;
        const light = (ny2 * 0.62 - nz1 * 0.78) * groove;
        if (light <= 0) {
          glyph[index] = ".";
          tone[index] = 1;
          continue;
        }
        const step = Math.min(11, (light * 12) | 0);
        const angle = (((phi + spin) % TAU) + TAU) % TAU;
        glyph[index] = RAMP[step]!;
        tone[index] = angle < 0.45 && Math.abs(st) > 0.3 ? 5 : step < 4 ? 2 : step < 8 ? 3 : 4;
      }
    }
    let out = "";
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < cols;) {
        const shade = tone[row * cols + column]!;
        if (shade === 0) {
          out += " ";
          column += 1;
          continue;
        }
        let run = "";
        while (column < cols && tone[row * cols + column] === shade) run += glyph[row * cols + column++];
        out += `<i class="${TONES[shade]}">${run}</i>`;
      }
      if (row < rows - 1) out += "\n";
    }
    return out;
  };
}

export interface CityShape {
  pitch: number;
  width: number;
  depth: number;
  rows: number;
}

export function cityGrid(canvasWidth: number, { pitch, depth, rows, width }: CityShape): { bands: number; left: number; step: number; rise: number } {
  const step = 2 * depth + 2;
  const rise = depth + 1;
  const bands = Math.max(1, Math.floor((canvasWidth - (rows - 1) * step - 2 * depth - 4) / pitch));
  const span = bands * pitch - (pitch - width) + (rows - 1) * step + 2 * depth;
  return { bands, left: Math.floor((canvasWidth - span) / 2), step, rise };
}
