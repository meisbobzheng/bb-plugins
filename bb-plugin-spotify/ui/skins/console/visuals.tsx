import { useEffect, useRef, useState } from "react";
import type { PlayerState } from "../../../contract";
import { useArt, useSample } from "../../art";
import { progressAt } from "../../model";
import { beat, fillLevels, hash, useFrame, type Signal } from "../../spectrum";
import type { Visualizer } from "./commands";

const RAMP = " .:-=+*#%@";
const BLOCKS = " ▁▂▃▄▅▆▇█";
const BRAILLE = "⣀⣄⣤⣦⣶⣷⣿";

export function signalOf(player: PlayerState, now: number): Signal {
  return { playing: player.isPlaying, progressMs: progressAt(player, now), durationMs: player.track?.durationMs ?? 0, trackId: player.track?.id ?? null };
}

function useCharWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => {
      const probe = document.createElement("span");
      probe.textContent = "█".repeat(20);
      element.appendChild(probe);
      const charWidth = probe.getBoundingClientRect().width / 20;
      probe.remove();
      if (charWidth > 0) setWidth(Math.floor(element.clientWidth / charWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function AsciiCover({ player, demo, cols = 30, rows = 16 }: { player: PlayerState; demo: boolean; cols?: number; rows?: number }) {
  const art = useArt(player.track?.album.imageUrl, demo);
  const sample = useSample(art, cols, rows);
  const pre = useRef<HTMLPreElement>(null);
  useFrame(
    (now) => {
      const element = pre.current;
      if (element === null) return;
      if (sample === null) {
        element.textContent = Array.from({ length: rows }, () => " ".repeat(cols)).join("\n");
        return;
      }
      const lift = 0.08 * beat(signalOf(player, now));
      const mono = getComputedStyle(element).getPropertyValue("--ascii-mono").trim() === "1";
      const lines: string[] = [];
      for (let y = 0; y < rows; y += 1) {
        let line = "";
        for (let x = 0; x < cols; x += 1) {
          const index = y * cols + x;
          const value = Math.min(1, sample.luma[index]! * 1.05 + lift);
          const char = RAMP[Math.min(RAMP.length - 1, Math.floor(value * RAMP.length))]!;
          if (char === " ") line += " ";
          else if (mono) line += `<span style="opacity:${(0.35 + value * 0.65).toFixed(2)}">${char}</span>`;
          else {
            const [r, g, b] = [sample.rgb[index * 3]!, sample.rgb[index * 3 + 1]!, sample.rgb[index * 3 + 2]!];
            const boost = 1.15 + lift * 2;
            line += `<span style="color:rgb(${Math.min(255, r * boost) | 0},${Math.min(255, g * boost) | 0},${Math.min(255, b * boost) | 0})">${char}</span>`;
          }
        }
        lines.push(line);
      }
      element.innerHTML = lines.join("\n");
    },
    player.isPlaying && sample !== null,
    10,
    [sample],
  );
  return <pre ref={pre} className="c-ascii" aria-hidden="true" />;
}

export function BrailleProgress({ player, onSeek }: { player: PlayerState; onSeek(ms: number): void }) {
  const span = useRef<HTMLDivElement>(null);
  const width = useCharWidth(span) || 52;
  const seed = hash(player.track?.id ?? "");
  const loud = Array.from({ length: width }, (_, index) => {
    const u = index / width;
    return Math.min(1, Math.max(0, 0.3 + 0.55 * Math.sin(u * Math.PI * 0.9 + 0.2) + 0.18 * Math.sin(u * 40 + seed) * Math.sin(u * 7 + seed / 3)));
  });
  useFrame(
    (now) => {
      const element = span.current;
      if (element === null) return;
      const duration = player.track?.durationMs ?? 0;
      const fraction = duration > 0 ? progressAt(player, now) / duration : 0;
      element.innerHTML = loud.map((value, index) => `<span class="${index / width <= fraction ? "c-y" : "c-f"}">${BRAILLE[Math.round(value * (BRAILLE.length - 1))]}</span>`).join("");
    },
    player.isPlaying,
    4,
    [player.progressMs, player.track?.id, width],
  );
  return (
    <div
      ref={span}
      className="c-wave"
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={player.track?.durationMs ?? 0}
      aria-valuenow={player.progressMs}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - rect.left) / rect.width) * (player.track?.durationMs ?? 0));
      }}
    />
  );
}

export function Spectrum({ player, mode, rows = 7, mini = false }: { player: PlayerState; mode: Visualizer; rows?: number; mini?: boolean }) {
  const pre = useRef<HTMLPreElement>(null);
  const measured = useCharWidth(pre);
  const bands = mini ? 14 : Math.max(8, measured);
  const peaks = useRef(new Float32Array(400));
  const levels = useRef(new Float32Array(bands));
  if (levels.current.length !== bands) levels.current = new Float32Array(bands);
  useFrame(
    (now) => {
      const element = pre.current;
      if (element === null) return;
      const signal = signalOf(player, now);
      const level = levels.current;
      fillLevels(level, signal, now / 1000);
      if (mini) {
        element.textContent = Array.from(level, (value) => BLOCKS[Math.max(1, Math.round(value * 8))]).join("");
        return;
      }
      if (mode === "off") {
        element.innerHTML = `${"\n".repeat(rows - 1)}<span class="c-f">${"─".repeat(bands)}</span>`;
        return;
      }
      const color = (row: number) => (row > rows * 0.7 ? "c-y" : row > rows * 0.4 ? "c-y2" : "c-b");
      const lines: string[] = [];
      if (mode === "scope") {
        for (let row = 0; row < rows; row += 1) {
          let line = "";
          for (let x = 0; x < bands; x += 1) {
            const amplitude = signal.playing ? 2.9 * (0.35 + 0.65 * level[Math.floor((x / bands) * 6)]!) : 0;
            const y = (rows - 1) / 2 + Math.sin(x * 0.32 + now / 140) * Math.sin(x * 0.07 - now / 1000) * amplitude;
            line += Math.round(y) === row ? "•" : " ";
          }
          lines.push(`<span class="${color(rows - row)}">${line}</span>`);
        }
      } else {
        for (let row = rows - 1; row >= 0; row -= 1) {
          let line = "";
          let run = "";
          let runClass = "";
          const flush = () => {
            if (run !== "") line += `<span class="${runClass}">${run}</span>`;
            run = "";
          };
          for (let band = 0; band < bands; band += 1) {
            const source = mode === "mirror" ? level[Math.abs(Math.floor(bands / 2) - band) % bands]! : level[band]!;
            peaks.current[band] = Math.max(source, peaks.current[band]! - 0.012);
            const cell = Math.max(0, Math.min(1, source * rows - row));
            const peak = cell === 0 && Math.floor(peaks.current[band]! * rows) === row && peaks.current[band]! > 0.08;
            const char = peak ? "▔" : BLOCKS[Math.round(cell * 8)]!;
            const klass = peak ? "c-r" : color(row);
            if (klass !== runClass) {
              flush();
              runClass = klass;
            }
            run += char;
          }
          flush();
          lines.push(line);
        }
      }
      element.innerHTML = lines.join("\n");
    },
    player.isPlaying,
    mini ? 20 : 30,
    [bands, mode],
  );
  return <pre ref={pre} className={mini ? "c-spec-mini" : "c-spec"} aria-hidden="true" />;
}

export function blocksBar(fraction: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return "▮".repeat(filled) + "▯".repeat(width - filled);
}

export function sparkline(values: readonly number[]): string {
  const max = Math.max(1, ...values);
  return values.map((value) => BLOCKS[Math.round((value / max) * 8)] ?? " ").join("");
}
