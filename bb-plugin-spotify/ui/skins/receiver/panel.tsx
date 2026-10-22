import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type RefObject } from "react";
import type { PlayerState, Playlist } from "../../../contract";
import { artists, clock } from "../../format";
import { progressAt, upNext, type SpotifyData } from "../../model";
import { energy, fillLevels, useFrame } from "../../spectrum";
import { signalOf } from "../console/visuals";
import { bandSize, needleAt, slotAt, type KnobMode } from "./dial";

const SEGMENTS = 48;
const CELLS = ["", "on", "pk"];
const TICKS = 61;
const MHZ = ["88", "92", "96", "100", "104", "108", "MHz"];

export const pad = (value: number) => String(value).padStart(2, "0");

export function idleText(player: PlayerState): { title: string; line: string } {
  if (player.status === "no-device") return { title: "No device", line: "Open Spotify on this Mac or your phone" };
  if (player.status === "disconnected") return { title: "Not connected", line: "Connect Spotify in settings" };
  if (player.status === "error") return { title: "Signal lost", line: player.error ?? "Spotify did not answer" };
  return { title: "No signal", line: "Tune a station, then press ⏎ to play" };
}

export function Key({ children, kbd, lit, dark, pip, className, ...rest }: { children?: ReactNode; kbd?: string; lit?: boolean; dark?: boolean; pip?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`r-key ${dark ? "r-dark" : ""} ${lit ? "r-lit" : ""} ${className ?? ""}`} {...rest}>
      {pip ? <span className="r-pip" /> : null}
      {children}
      {kbd ? <kbd>{kbd}</kbd> : null}
    </button>
  );
}

export function Group({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`r-group ${className ?? ""}`}>
      <div className="r-group-label r-engrave">{label}</div>
      <div className="r-keys">{children}</div>
    </div>
  );
}

export function Screws() {
  return (
    <>
      <span className="r-screw r-s1" />
      <span className="r-screw r-s2" />
      <span className="r-screw r-s3" />
      <span className="r-screw r-s4" />
    </>
  );
}

export function Unit({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`r-unit ${className ?? ""}`}>
      <div className="r-wood" />
      {children}
      <div className="r-wood" />
    </section>
  );
}

export function Spectrum({ player, bands, rows }: { player: PlayerState; bands: number; rows: number }) {
  const grid = useRef<HTMLDivElement>(null);
  const state = useRef({ levels: new Float32Array(bands), peaks: new Float32Array(bands), cells: new Uint8Array(bands * rows), last: 0 });
  useFrame(
    (now) => {
      const element = grid.current;
      if (element === null) return;
      const { levels, peaks, cells } = state.current;
      const dt = Math.min(0.25, (now - state.current.last) / 1000);
      state.current.last = now;
      const signal = signalOf(player, now);
      fillLevels(levels, signal, now / 1000);
      for (let band = 0; band < bands; band += 1) {
        const height = Math.round(levels[band]! * rows);
        peaks[band] = signal.playing ? Math.max(height, peaks[band]! - dt * 6) : 0;
        const peak = Math.round(peaks[band]!);
        const column = element.children[band]!;
        for (let row = 0; row < rows; row += 1) {
          const value = row < height ? 1 : row === peak && peaks[band]! > 0.5 ? 2 : 0;
          if (cells[band * rows + row] === value) continue;
          cells[band * rows + row] = value;
          column.children[row]!.className = CELLS[value]!;
        }
      }
    },
    player.isPlaying,
    30,
    [player.track?.id],
  );
  return (
    <div ref={grid} className="r-spectrum" style={{ gridTemplateColumns: `repeat(${bands}, 1fr)` }} aria-hidden="true">
      {Array.from({ length: bands }, (_, band) => (
        <div key={band} className="r-band">
          {Array.from({ length: rows }, (_, row) => (
            <i key={row} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function LiveClock({ player }: { player: PlayerState }) {
  const span = useRef<HTMLSpanElement>(null);
  useFrame(
    (now) => {
      if (span.current !== null) span.current.textContent = `${clock(progressAt(player, now))} / ${clock(player.track?.durationMs ?? 0)}`;
    },
    player.isPlaying,
    4,
    [player.progressMs, player.fetchedAt, player.track?.id],
  );
  return <span ref={span} />;
}

export function Vfd({ data, knob, flash, onSeek, onRepeat }: { data: SpotifyData; knob: KnobMode; flash: string | null; onSeek(ms: number): void; onRepeat(): void }) {
  const { player, selection } = data;
  const track = player.track;
  const elapsed = useRef<HTMLSpanElement>(null);
  const remain = useRef<HTMLElement>(null);
  const segs = useRef<HTMLDivElement>(null);
  useFrame(
    (now) => {
      const duration = track?.durationMs ?? 0;
      const position = progressAt(player, now);
      if (elapsed.current !== null) elapsed.current.textContent = track === null ? "-:--" : clock(position);
      if (remain.current !== null) remain.current.textContent = track === null ? "" : `−${clock(duration - position)}`;
      const lit = duration > 0 ? Math.round((position / duration) * SEGMENTS) : 0;
      Array.from(segs.current?.children ?? []).forEach((segment, index) => segment.classList.toggle("on", index < lit));
    },
    player.isPlaying,
    4,
    [player.progressMs, player.fetchedAt, track?.id],
  );
  const idle = idleText(player);
  const next = upNext(data)[0];
  const volume = player.device?.volumePercent ?? null;
  const smart = track !== null && data.session !== null && data.session.tracks.some((entry) => entry.track.id === track.id);
  const listed = track !== null && selection.tracks !== null && selection.playlist?.uri === player.context?.uri ? selection.tracks.findIndex((entry) => entry.id === track.id) : -1;
  const source = player.context === null ? (track === null ? "" : "Single") : (player.context.name ?? player.context.kind);
  return (
    <div className="r-glass r-vfd">
      <div className="r-ind r-glow">
        <span className={track !== null ? "on" : ""}>Stereo</span>
        <span className={player.device !== null ? "on" : ""}>Connect</span>
        <span className={knob !== "off" ? "on" : ""}>{knob === "off" ? "Shuffle" : knob}⇄</span>
        <span className={smart ? "on" : ""}>Smart</span>
        <span className={player.liked ? "on" : ""}>♥ Saved</span>
        <button type="button" className={player.repeat !== "off" ? "on" : ""} onClick={onRepeat} title="Cycle repeat">
          {player.repeat === "track" ? "Repeat 1" : "Repeat"}
        </button>
        <span className={volume !== null ? "on" : ""}>Vol {volume ?? "--"}</span>
        <span className={`r-duck ${player.duck.active ? "on" : ""}`} title={player.duck.threads.map((thread) => thread.title).join(", ")}>
          Ducked
        </span>
      </div>
      <div className="r-vfd-main">
        <div className="r-vfd-text">
          <div className="r-title r-glow">{track?.name ?? idle.title}</div>
          <div className="r-artist r-glow">{track === null ? idle.line : `${artists(track)} — ${track.album.name}`}</div>
        </div>
        <div className="r-time r-glow">
          <span ref={elapsed} />
          <small ref={remain} />
        </div>
      </div>
      <div
        ref={segs}
        className="r-segs"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={track?.durationMs ?? 0}
        aria-valuenow={player.progressMs}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (track !== null) onSeek(((event.clientX - rect.left) / rect.width) * track.durationMs);
        }}
      >
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <i key={index} />
        ))}
      </div>
      <Spectrum player={player} bands={32} rows={9} />
      <div className="r-next r-glow">
        <span className={flash === null ? "" : "r-flash"}>{flash ?? (next === undefined ? "Next ▸ —" : `Next ▸ ${next.track.name} — ${artists(next.track)}`)}</span>
        <span>
          {source}
          {listed >= 0 ? ` · ${pad(listed + 1)}/${pad(selection.tracks!.length)}` : ""}
        </span>
      </div>
    </div>
  );
}

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const at = (degrees: number, radius: number) => `${(134 + Math.sin(rad(degrees)) * radius).toFixed(2)} ${(100 - Math.cos(rad(degrees)) * radius).toFixed(2)}`;
const VU_TICKS = Array.from({ length: 21 }, (_, index) => ({ index, from: at(-50 + index * 5, 70).split(" "), to: at(-50 + index * 5, index % 5 ? 76 : 80).split(" ") }));

function VuFace({ needle }: { needle: (line: SVGLineElement | null) => void }) {
  return (
    <svg viewBox="0 0 268 92" aria-hidden="true">
      <path className="r-vu-ink" d={`M ${at(-50, 66)} A 66 66 0 0 1 ${at(25, 66)}`} strokeWidth="1" />
      <path className="r-vu-red" d={`M ${at(25, 66)} A 66 66 0 0 1 ${at(50, 66)}`} strokeWidth="3" />
      {VU_TICKS.map(({ index, from, to }) => (
        <line key={index} className={index > 15 ? "r-vu-red" : "r-vu-ink"} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} strokeWidth={index % 5 ? 1 : 1.6} />
      ))}
      <text className="r-vu-label" x="134" y="58" textAnchor="middle" fontSize="11" fontWeight="700" letterSpacing="3">
        VU
      </text>
      <text className="r-vu-num" x="52" y="40" fontSize="8">
        −20
      </text>
      <text className="r-vu-num r-vu-hot" x="204" y="40" fontSize="8">
        +3
      </text>
      <line ref={needle} className="r-ndl" x1="134" y1="100" x2="134" y2="18" />
      <circle className="r-hub" cx="134" cy="100" r="9" />
    </svg>
  );
}

export function Meters({ player }: { player: PlayerState }) {
  const needles = useRef<(SVGLineElement | null)[]>([null, null]);
  const state = useRef({ angles: [-50, -50], last: 0 });
  useFrame(
    (now) => {
      const signal = signalOf(player, now);
      const level = energy(signal);
      const dt = Math.min(0.1, (now - state.current.last) / 1000);
      state.current.last = now;
      needles.current.forEach((line, channel) => {
        if (line === null) return;
        const sway = 0.84 + 0.16 * Math.sin(now / (170 + channel * 60) + channel * 2.1);
        const target = signal.playing ? -50 + 98 * Math.min(1, level * sway + 0.06) : -50;
        const angle = signal.playing ? state.current.angles[channel]! + (target - state.current.angles[channel]!) * Math.min(1, dt * 9) : -50;
        state.current.angles[channel] = angle;
        line.style.transform = `rotate(${angle.toFixed(2)}deg)`;
      });
    },
    player.isPlaying,
    60,
  );
  return (
    <div className={`r-meters ${player.isPlaying ? "" : "r-rest"}`}>
      {["L", "R"].map((tag, channel) => (
        <div key={tag} className="r-vu">
          <VuFace
            needle={(line) => {
              needles.current[channel] = line;
            }}
          />
          <span className="r-tag">{tag}</span>
        </div>
      ))}
    </div>
  );
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function Dial({ stations, selectedId, playingUri, loading, onTune }: { stations: Playlist[]; selectedId: string | null; playingUri: string | null; loading: boolean; onTune(index: number): void }) {
  const glass = useRef<HTMLDivElement>(null);
  const size = bandSize(useWidth(glass) - 36, stations.length);
  const selected = stations.findIndex((entry) => entry.id === selectedId);
  const bands = Math.max(1, Math.ceil(stations.length / size));
  const [band, setBand] = useState(0);
  useEffect(() => setBand(selected >= 0 ? Math.floor(selected / size) : 0), [selected, size]);
  const shown = Math.min(band, bands - 1);
  const slots = stations.slice(shown * size, shown * size + size);
  const needle = needleAt(selected, shown, size);
  const away = selected < 0 || Math.floor(selected / size) !== shown;
  return (
    <div className="r-dialrow">
      <div className="r-bandsel">
        <div className="r-group-label r-engrave">Band</div>
        <div className="r-keys">
          <Key className="r-step" disabled={shown === 0} onClick={() => setBand(shown - 1)} aria-label="Previous band">
            ◂
          </Key>
          <span className="r-lcd">
            FM{shown + 1}
            <small>/{bands}</small>
          </span>
          <Key className="r-step" disabled={shown >= bands - 1} onClick={() => setBand(shown + 1)} aria-label="Next band">
            ▸
          </Key>
        </div>
      </div>
      <div ref={glass} className="r-glass r-dial">
        <div className="r-dial-back" />
        <div className="r-stations">
          {loading ? <div className="r-scan">Scanning…</div> : null}
          {!loading && stations.length === 0 ? <div className="r-scan">No stations · make a playlist in Spotify</div> : null}
          {slots.map((station, slot) => {
            const index = shown * size + slot;
            const onAir = station.uri === playingUri;
            return (
              <button
                type="button"
                key={station.id}
                className={`r-st ${index === selected ? "on" : ""} ${station.readable ? "" : "r-follow"}`}
                style={{ left: `${slotAt(slot, size) * 100}%`, maxWidth: `calc(${100 / size}% - 4px)` }}
                onClick={() => onTune(index)}
                title={station.readable ? `${station.name} · ${station.owner}` : `${station.name} · followed, play only`}
              >
                {station.name}
                <small>
                  {onAir ? <b className="r-air">● </b> : null}
                  {station.readable ? `${station.trackCount.toLocaleString()} trk` : "play only"}
                </small>
              </button>
            );
          })}
        </div>
        <div className="r-mhz">
          {MHZ.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="r-scale">
          {Array.from({ length: TICKS }, (_, index) => (
            <i key={index} />
          ))}
        </div>
        <div className={`r-needle ${away ? "r-away" : ""}`} style={{ left: `calc(18px + (100% - 36px) * ${needle})` }} />
      </div>
    </div>
  );
}

export function Rotary<T extends string>({ label, options, value, onChange, className }: { label: string; options: readonly T[]; value: T; onChange(next: T): void; className?: string }) {
  const index = Math.max(0, options.indexOf(value));
  return (
    <div className={`r-knob-box ${className ?? ""}`}>
      <div className="r-group-label r-engrave">{label}</div>
      <button
        type="button"
        className="r-knob"
        style={{ transform: `rotate(${-60 + (120 / Math.max(1, options.length - 1)) * index}deg)` }}
        onClick={() => onChange(options[(index + 1) % options.length]!)}
        aria-label={`${label}: ${value}`}
      />
      <div className="r-knob-scale r-engrave">
        {options.map((option) => (
          <button type="button" key={option} className={option === value ? "on" : ""} onClick={() => onChange(option)}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

export function VolumeKnob({ volume, enabled, onChange }: { volume: number | null; enabled: boolean; onChange(percent: number): void }) {
  const knob = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? volume ?? 0;
  const latest = useRef(shown);
  latest.current = shown;
  const send = useRef(onChange);
  send.current = onChange;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const drag = useRef<{ y: number; from: number } | null>(null);
  const commit = useRef((value: number, delay: number) => {
    const next = Math.max(0, Math.min(100, Math.round(value)));
    latest.current = next;
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      send.current(next);
      timer.current = setTimeout(() => setDraft(null), 1500);
    }, delay);
  });
  useEffect(() => setDraft(null), [volume]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const element = knob.current;
    if (element === null || !enabled) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      commit.current(latest.current - Math.sign(event.deltaY) * 2, 250);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [enabled]);
  return (
    <div className={`r-knob-box r-vol ${enabled ? "" : "r-disabled"}`}>
      <div className="r-group-label r-engrave">Volume</div>
      <div
        ref={knob}
        className="r-knob"
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
        title="Drag up or down, or scroll"
        style={{ transform: `rotate(${-135 + shown * 2.7}deg)` }}
        onPointerDown={(event) => {
          if (!enabled || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { y: event.clientY, from: latest.current };
        }}
        onPointerMove={(event) => drag.current !== null && commit.current(drag.current.from + (drag.current.y - event.clientY) * 0.5, 120)}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      <div className="r-knob-scale r-engrave">
        <span>Min</span>
        <span className="on">{enabled ? shown : "--"}</span>
        <span>Max</span>
      </div>
    </div>
  );
}
