import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIKED_ID, PALETTES, type Device, type Playlist, type Track } from "../../../contract";
import { artists, clock } from "../../format";
import { isTyping, transportKey, useKeys } from "../../keys";
import { progressAt, upNext, type MiniProps, type Skin, type SkinProps } from "../../model";
import { Arrow, Clock, Delta, filterIds, Filters, Icon, Kc, Outline, Seek, useFilterId, useSize, Volume, Waveform } from "./drawing";
import { Art, DeviceList, Finder, Help, LEGEND, Meta, Picks, Playlists, Repeat, ShareButtons, Shuffle, ShuffleNote, StatsBox, Tracks, tracksCaption, Transport, type Found, type Share } from "./parts";
import { duckLine, layoutFor, ordered, playlistMeta, revision, stamp, type Layout } from "./sheet";
import "./sketch.css";

type Tab = "tracks" | "next" | "lib" | "more";
type List = "lib" | "tracks" | "next" | "dev";
type Note = { id: number; text: string } | null;
type Cursors = Record<List, number | null>;

const TABS: { id: Tab; label: string; short: string }[] = [
  { id: "tracks", label: "tracks", short: "tracks" },
  { id: "next", label: "up next", short: "next" },
  { id: "lib", label: "library", short: "library" },
  { id: "more", label: "share · device · stats", short: "more" },
];
const TAB_LIST: Record<Tab, List> = { tracks: "tracks", next: "next", lib: "lib", more: "dev" };
const CYCLE: List[] = ["lib", "tracks", "next"];

const paletteOf = (palette: string) => ((PALETTES.sketch as readonly string[]).includes(palette) ? palette : PALETTES.sketch[0]);
const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function rootStyle(id: string): React.CSSProperties {
  const ids = filterIds(id);
  return { "--g-rough": `url(#${ids.rough})`, "--g-fine": `url(#${ids.fine})` } as React.CSSProperties;
}

function DuckCloud({ line }: { line: string }) {
  return (
    <div className="g-duck" role="status">
      <Delta />
      <span className="g-trunc">{line}</span>
      <Outline shape="cloud" tone="red" seed="duck" />
    </div>
  );
}

function SketchPage(props: SkinProps) {
  const { data, actions } = props;
  const palette = paletteOf(props.palette);
  const root = useRef<HTMLDivElement>(null);
  const finder = useRef<HTMLInputElement>(null);
  const id = useFilterId();
  const layout: Layout = layoutFor(useSize(root));
  const full = layout === "full";
  const [tab, setTab] = useState<Tab>("tracks");
  const [focus, setFocus] = useState<List>("tracks");
  const [cursor, setCursor] = useState<Cursors>({ lib: null, tracks: null, next: null, dev: null });
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [help, setHelp] = useState(false);
  const [picker, setPicker] = useState(false);
  const [boil, setBoil] = useState(() => !calm());
  const [summon, setSummon] = useState(0);
  const { player } = data;
  const track = player.track;
  const playlists = useMemo(() => ordered(data.playlists, query), [data.playlists, query]);
  const rows = found !== null ? (found.tracks ?? []) : (data.selection.tracks ?? []);
  const upcoming = upNext(data);
  const active: List | null = full ? (picker ? "dev" : focus) : TAB_LIST[tab];
  const duck = duckLine(player.duck);

  useEffect(() => {
    if (note === null) return;
    const timer = setTimeout(() => setNote(null), 2400);
    return () => clearTimeout(timer);
  }, [note]);

  useEffect(() => {
    if (summon > 0) finder.current?.focus();
  }, [summon]);

  useEffect(() => setCursor((value) => ({ ...value, tracks: null })), [data.selection.playlist?.id, found]);

  const say = (text: string) => setNote({ id: Date.now(), text });
  const rest = () => root.current?.focus({ preventScroll: true });
  const subject = (): Track | null => (active === "tracks" && cursor.tracks !== null ? (rows[cursor.tracks] ?? track) : track);

  const pick = (playlist: Playlist) => {
    const again = data.selection.playlist?.id === playlist.id;
    actions.select(playlist.id);
    setFound(null);
    setCursor((value) => ({ ...value, lib: playlists.indexOf(playlist) }));
    if (!playlist.readable) {
      if (again) {
        actions.playPlaylist(playlist);
        say(`▶ playing ${playlist.name}`);
      } else say(`${playlist.name} is play-only · ⏎ again plays it`);
      return;
    }
    if (!full) setTab("tracks");
  };

  const playRow = (index: number) => {
    const chosen = rows[index];
    if (chosen === undefined) return;
    setCursor((value) => ({ ...value, tracks: index }));
    if (found === null && data.selection.playlist !== null) actions.playPlaylist(data.selection.playlist, chosen);
    else actions.playTrack(chosen);
  };

  const playNext = (chosen: Track) => {
    actions.playTrack(chosen);
    say(`▶ ${chosen.name}`);
  };

  const share = (how: Share) => {
    const chosen = subject();
    if (chosen === null) return say("nothing to share yet");
    if (how === "link") {
      actions.copyLink(chosen);
      say(`✓ link copied · ${chosen.name}`);
    } else if (how === "thread") {
      actions.mention(chosen);
      say(`@ ${chosen.name} — ${artists(chosen)} dropped into the thread`);
    } else {
      actions.shareCard(chosen, root.current);
      say(`share card sketched for “${chosen.name}”`);
    }
  };

  const reshuffle = () => {
    if (data.shuffling) return;
    const chosen = data.selection.playlist;
    actions.smartShuffle({ sourceId: chosen?.readable ? chosen.id : LIKED_ID });
    say(`↻ re-sketching up next from ${chosen?.readable ? chosen.name : "Liked Songs"}…`);
  };

  const search = () => {
    const text = query.trim();
    if (text === "") return;
    setFound({ query: text, tracks: null, error: null });
    setFocus("tracks");
    setTab("tracks");
    rest();
    actions.search(text).then(
      (result) => setFound((value) => (value?.query === text ? { ...value, tracks: result.tracks } : value)),
      (cause: unknown) => setFound((value) => (value?.query === text ? { ...value, error: cause instanceof Error ? cause.message : String(cause) } : value)),
    );
  };

  const queue = (chosen: Track) => {
    actions.queue(chosen);
    say(`+ queued ${chosen.name}`);
  };

  const transfer = (device: Device) => {
    if (device.id === null) return;
    actions.transfer(device.id);
    setPicker(false);
    say(`now playing on ${device.name}`);
  };

  const openPicker = () => {
    actions.refreshDevices();
    setCursor((value) => ({ ...value, dev: Math.max(0, data.devices.findIndex((device) => device.isActive)) }));
    if (full) setPicker((value) => !value);
    else setTab("more");
  };

  const openSearch = () => {
    if (!full) setTab("lib");
    setSummon((value) => value + 1);
  };

  const lengthOf = (list: List) => (list === "lib" ? playlists.length : list === "tracks" ? rows.length : list === "next" ? upcoming.length : data.devices.length);
  const startOf = (list: List) =>
    list === "lib" ? playlists.findIndex((entry) => entry.id === data.selection.playlist?.id) : list === "tracks" ? rows.findIndex((entry) => entry.id === track?.id) : -1;

  const move = (delta: number) => {
    if (active === null) return;
    const length = lengthOf(active);
    if (length === 0) return;
    setCursor((value) => ({ ...value, [active]: Math.max(0, Math.min(length - 1, (value[active] ?? startOf(active)) + delta)) }));
  };

  const enter = () => {
    const at = active === null ? null : cursor[active];
    if (at === null) return false;
    if (active === "lib") playlists[at] && pick(playlists[at]!);
    else if (active === "tracks") playRow(at);
    else if (active === "next") upcoming[at] && playNext(upcoming[at]!.track);
    else if (active === "dev") data.devices[at] && transfer(data.devices[at]!);
    return true;
  };

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (help) {
        setHelp(false);
        return true;
      }
      if (transportKey(event, data, actions)) return true;
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowRight":
          actions.seek(Math.min(track?.durationMs ?? 0, Math.max(0, progressAt(player, Date.now()) + (event.key === "ArrowRight" ? 10_000 : -10_000))));
          return true;
        case "n":
          actions.next();
          return true;
        case "p":
          actions.previous();
          return true;
        case "j":
        case "ArrowDown":
          move(1);
          return true;
        case "k":
        case "ArrowUp":
          move(-1);
          return true;
        case "Enter":
          return enter();
        case "Tab":
          if (!full) return false;
          setPicker(false);
          setFocus((value) => CYCLE[(CYCLE.indexOf(value) + (event.shiftKey ? 2 : 1)) % CYCLE.length]!);
          return true;
        case "f":
          if (track !== null) actions.like();
          return true;
        case "s":
          openSearch();
          return true;
        case "R":
          reshuffle();
          return true;
        case "x":
          actions.setShuffle(!player.shuffle);
          return true;
        case "r":
          actions.cycleRepeat();
          return true;
        case "y":
          share("link");
          return true;
        case "@":
          share("thread");
          return true;
        case "c":
          share("card");
          return true;
        case "d":
          openPicker();
          return true;
        case "o":
          actions.launchApp();
          return true;
        case "b":
          setBoil((value) => !value);
          say(`pencil boil ${boil ? "off" : "on"}`);
          return true;
        case "?":
          setHelp(true);
          return true;
        case "Escape":
          if (picker) setPicker(false);
          else if (found !== null || query !== "") {
            setFound(null);
            setQuery("");
          } else if (active !== null && cursor[active] !== null) setCursor((value) => ({ ...value, [active]: null }));
          else return false;
          return true;
        default: {
          const index = Number(event.key) - 1;
          if (full || !Number.isInteger(index) || TABS[index] === undefined) return false;
          setTab(TABS[index]!.id);
          return true;
        }
      }
    },
    [help, data, actions, player, track, full, active, cursor, picker, found, query, boil, playlists, rows, upcoming],
  );
  useKeys(root, onKey);

  const finderProps = {
    input: finder,
    query,
    onQuery: (value: string) => {
      setQuery(value);
      setCursor((current) => ({ ...current, lib: null }));
    },
    onSearch: search,
    onLeave: rest,
    onBrowse: () => {
      rest();
      setFocus("lib");
      setCursor((current) => ({ ...current, lib: 0 }));
    },
  };
  const listProps = { props, list: playlists, cursor: cursor.lib, focused: active === "lib", onPick: pick };
  const tracksProps = {
    props,
    found,
    cursor: cursor.tracks,
    focused: active === "tracks",
    onPlay: (index: number) => {
      setFocus("tracks");
      playRow(index);
    },
    onQueue: queue,
    onClear: () => {
      setFound(null);
      setQuery("");
    },
  };
  const picksProps = { props, cursor: cursor.next, focused: active === "next", onPlay: playNext };
  const playing = player.isPlaying && track !== null;
  const selection = data.selection.playlist;
  const [caption, aside] = tracksCaption(data, found);

  return (
    <div
      ref={root}
      tabIndex={0}
      data-layout={layout}
      className={`sp-sketch g-${palette} g-${layout} ${playing ? "" : "g-still"}`}
      style={rootStyle(id)}
      onMouseDown={(event) => {
        if (picker && !(event.target as HTMLElement).closest(".g-devcell")) setPicker(false);
        if (!isTyping(event.target)) event.currentTarget.focus({ preventScroll: true });
      }}
    >
      <Filters id={id} boiling={boil && playing} />
      {full ? (
        <>
          <header className="g-head">
            <div className="g-brand">
              <span className="g-tl g-ink">spotify</span>
              <span className="g-slash">/</span>
              <span className="g-h g-trunc">{selection?.name ?? "Library"}</span>
              {selection !== null ? <span className="g-tl g-trunc">{playlistMeta(selection)}</span> : null}
            </div>
            {duck !== null ? (
              <DuckCloud line={duck} />
            ) : (
              <button type="button" className="g-ann g-helpbtn" onClick={() => setHelp(true)}>
                <span>press ? for the key legend</span>
              </button>
            )}
          </header>
          <div className="g-body">
            <div className="g-col g-lib" onMouseDown={() => setFocus("lib")}>
              <Finder {...finderProps} />
              <div className="g-tl">library</div>
              <Playlists {...listProps} />
              <div className="g-legend">
                ◯ open · <span className="g-red">♪</span> playing
              </div>
              <StatsBox stats={data.stats} />
            </div>
            <div className="g-col g-mid">
              <div className="g-np">
                <Art track={track} caption />
                <div className="g-np-meta">
                  <Meta props={props} />
                  {track !== null ? <ShareButtons onShare={share} /> : null}
                </div>
              </div>
              <div className="g-wave">
                <div className="g-tl">fig. 2 — {playing ? "live waveform, redrawn as it plays" : "waveform, at rest"}</div>
                <Waveform player={player} palette={palette} />
                <div className="g-seekrow">
                  <Seek player={player} onSeek={actions.seek} />
                  <div className="g-ann g-ann-seek">
                    <Arrow to="left" />
                    <span>drag to seek</span>
                  </div>
                </div>
              </div>
              <div className="g-trans">
                <Shuffle props={props} />
                <Transport props={props} />
                <Repeat props={props} />
              </div>
              <div className="g-tracks" onMouseDown={() => setFocus("tracks")}>
                <div className="g-thead">
                  <span className="g-tl g-trunc">{caption}</span>
                  <span className="g-tl">{aside}</span>
                </div>
                <Tracks {...tracksProps} />
              </div>
            </div>
            <div className="g-col g-side" onMouseDown={() => setFocus("next")}>
              <ShuffleNote props={props} onShuffle={reshuffle} onLeave={rest} />
              <Picks {...picksProps} />
            </div>
          </div>
          <TitleBlock props={props} palette={palette} picker={picker} cursor={cursor.dev} onPicker={openPicker} onPick={transfer} />
        </>
      ) : (
        <Compact
          props={props}
          layout={layout}
          palette={palette}
          tab={tab}
          duck={duck}
          onTab={setTab}
          onHelp={() => setHelp(true)}
          panes={{
            tracks: <Tracks {...tracksProps} />,
            next: (
              <>
                <ShuffleNote props={props} onShuffle={reshuffle} onLeave={rest} />
                <Picks {...picksProps} plot={false} />
              </>
            ),
            lib: (
              <>
                <Finder {...finderProps} />
                <Playlists {...listProps} columns={layout === "compact"} />
              </>
            ),
            more: (
              <div className="g-more">
                <div>
                  <div className="g-tl">share this track</div>
                  <ShareButtons onShare={share} />
                </div>
                <div>
                  <div className="g-tl">output device · d</div>
                  <DeviceList devices={data.devices} current={player.device} cursor={active === "dev" ? cursor.dev : null} onPick={transfer} />
                  {layout === "tight" ? (
                    <div className="g-more-vol">
                      <div className="g-tl">volume · − +</div>
                      <Volume device={player.device} onChange={actions.setVolume} />
                    </div>
                  ) : null}
                </div>
                <StatsBox stats={data.stats} />
              </div>
            ),
          }}
        />
      )}
      {note === null ? null : (
        <div key={note.id} className="g-toast" role="status">
          <span className="g-tape" />
          {note.text}
        </div>
      )}
      {help ? <Help onClose={() => setHelp(false)} /> : null}
    </div>
  );
}

function TitleBlock({ props, palette, picker, cursor, onPicker, onPick }: { props: SkinProps; palette: string; picker: boolean; cursor: number | null; onPicker(): void; onPick(device: Device): void }) {
  const { data, actions } = props;
  const { player } = data;
  const ducked = player.duck.active && player.duck.mode === "lower";
  return (
    <footer className="g-tblock">
      <div>
        <div className="g-tl">keys</div>
        <div className="g-keys">
          {LEGEND.map(([key, what]) => (
            <span key={key}>
              <Kc>{key}</Kc> {what}
            </span>
          ))}
        </div>
      </div>
      <div className="g-devcell">
        <button type="button" className="g-devbtn" onClick={onPicker} aria-expanded={picker}>
          <span className="g-tl">output device · d</span>
          <span className="g-devv">
            <Icon name="laptop" />
            <span className="g-trunc">{player.device?.name ?? "no device"}</span> ▾
          </span>
        </button>
        {picker ? (
          <div className="g-picker">
            <DeviceList devices={data.devices} current={player.device} cursor={cursor} onPick={onPick} />
            <Outline seed="picker" />
          </div>
        ) : null}
        <Outline shape="rule" seed="dev" />
      </div>
      <div>
        <div className="g-tl">
          volume · − + {ducked ? <span className="g-red">· ducked ↓</span> : null}
        </div>
        <Volume device={player.device} onChange={actions.setVolume} />
        <Outline shape="rule" seed="vol" />
      </div>
      <div>
        <div className="g-tl">sheet</div>
        <div className="g-sheet-n">G-01</div>
        <div className="g-tl g-tiny">
          rev {revision(palette, PALETTES.sketch)} · {stamp(new Date())} · bb
        </div>
        <Outline shape="rule" seed="sheet" />
      </div>
      <Outline seed="tblock" />
    </footer>
  );
}

function Compact({ props, layout, palette, tab, duck, panes, onTab, onHelp }: { props: SkinProps; layout: Layout; palette: string; tab: Tab; duck: string | null; panes: Record<Tab, React.ReactNode>; onTab(tab: Tab): void; onHelp(): void }) {
  const { data, actions } = props;
  const { player } = data;
  const tight = layout === "tight";
  const counts: Partial<Record<Tab, number>> = { tracks: data.selection.tracks?.length, next: upNext(data).length, lib: data.playlists?.length };
  return (
    <>
      <header className="g-c-head">
        <span className="g-tl g-ink g-trunc">
          spotify / {data.selection.playlist?.name ?? "library"} · {player.device?.name ?? "no device"}
        </span>
        {duck !== null ? (
          <span className="g-c-duck" role="status">
            <Delta />
            <span className="g-trunc">{duck}</span>
          </span>
        ) : (
          <span className="g-tl">sheet G-01 · rev {revision(palette, PALETTES.sketch)}</span>
        )}
      </header>
      <div className="g-c-top">
        <Art track={player.track} caption={false} />
        <Meta props={props} />
        {tight ? null : (
          <div className="g-c-trans">
            <Transport props={props} />
          </div>
        )}
      </div>
      {tight ? (
        <div className="g-trans">
          <Shuffle props={props} />
          <Transport props={props} />
          <Repeat props={props} />
        </div>
      ) : null}
      <div className="g-c-seek">
        <span className="g-mono">
          <Clock player={player} />
        </span>
        <div className="g-c-wv">
          <Waveform player={player} palette={palette} split />
          <Seek player={player} onSeek={actions.seek} small />
        </div>
        <span className="g-mono">{clock(player.track?.durationMs ?? 0)}</span>
        {tight ? null : (
          <>
            <Shuffle props={props} />
            <Repeat props={props} />
            <div className="g-c-vol">
              <Icon name="speaker" />
              <Volume device={player.device} onChange={actions.setVolume} />
            </div>
          </>
        )}
      </div>
      <nav className="g-c-tabs" role="tablist">
        <span className="g-tabline">
          <Outline shape="under" seed="tabline" />
        </span>
        {TABS.map((entry, index) => (
          <button key={entry.id} type="button" role="tab" aria-selected={entry.id === tab} className={`g-ctab ${entry.id === tab ? "g-on" : ""}`} onClick={() => onTab(entry.id)} title={`${entry.label} (${index + 1})`}>
            {tight ? entry.short : entry.label}
            {counts[entry.id] !== undefined && !tight ? <small> {counts[entry.id]}</small> : null}
            {entry.id === tab ? <Outline shape="tab" seed={entry.id} /> : null}
          </button>
        ))}
        <span className="g-grow" />
        <button type="button" className="g-hbtn" onClick={onHelp}>
          <Kc>?</Kc>
          {tight ? "" : " keys"}
        </button>
      </nav>
      <div key={tab} className={`g-c-pane g-pane-${tab}`} role="tabpanel">
        {panes[tab]}
      </div>
    </>
  );
}

function SketchMini({ data, actions, palette: chosen, close }: MiniProps) {
  const palette = paletteOf(chosen);
  const root = useRef<HTMLDivElement>(null);
  const id = useFilterId();
  const { player } = data;
  const track = player.track;
  const duck = duckLine(player.duck);
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (transportKey(event, data, actions)) return true;
      if (event.key === "n") actions.next();
      else if (event.key === "p") actions.previous();
      else if (event.key === "f" && track !== null) actions.like();
      else if (event.key === "y" && track !== null) actions.copyLink(track);
      else if (event.key === "@" && track !== null) actions.mention(track);
      else if (event.key === "o") actions.openPage();
      else if (event.key === "q") close();
      else return false;
      return true;
    },
    [data, actions, track, close],
  );
  useKeys(root, onKey);
  const playing = player.isPlaying && track !== null;
  return (
    <div ref={root} tabIndex={0} className={`sp-sketch g-mini g-${palette} ${playing ? "" : "g-still"}`} style={rootStyle(id)}>
      <Filters id={id} boiling={playing && !calm()} />
      <span className="g-tape g-t1" data-sp-drag="" title="Drag to move" />
      <span className="g-tape g-t2" data-sp-drag="" title="Drag to move" />
      <div className="g-m-row">
        <div className="g-m-art" data-sp-drag="" title="Drag to move">
          <Art track={track} caption={false} />
        </div>
        <div className="g-m-meta">
          <button type="button" className="g-m-t g-trunc" onClick={actions.openPage} title="Open the Spotify page (o)">
            {track?.name ?? "nothing on the board"}
          </button>
          <div className="g-m-a g-trunc">
            {track === null ? (
              player.status === "no-device" ? "no Spotify device is awake" : "space to resume"
            ) : (
              <>
                {artists(track)} ·{" "}
                <span className="g-mono">
                  <Clock player={player} /> / {clock(track.durationMs)}
                </span>
              </>
            )}
          </div>
          <Waveform player={player} palette={palette} split />
        </div>
        <div className="g-m-btns">
          <Transport props={{ data, actions, palette }} />
          <button type="button" className="g-m-x" onClick={close} aria-label="Close the mini player" title="Close (q)">
            <Icon name="close" />
          </button>
        </div>
      </div>
      {duck !== null ? (
        <div className="g-m-duck" role="status">
          <span className="g-trunc">
            <Delta />
            {duck}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export const sketchSkin: Skin = { id: "sketch", Page: SketchPage, Mini: SketchMini };
