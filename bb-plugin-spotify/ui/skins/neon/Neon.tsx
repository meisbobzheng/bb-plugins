import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PALETTES, type Device, type Playlist, type SearchResult, type Track } from "../../../contract";
import { artists, playlistLength } from "../../format";
import { isTyping, transportKey, useKeys } from "../../keys";
import { progressAt, upNext, type MiniProps, type Skin, type SkinProps } from "../../model";
import { Devices, Duck, Help, Keycaps, Library, Queue, Rules, ShareButtons, sourceOf, Stats, Tracks, type Share } from "./panes";
import { capFor, layoutFor, type Hue } from "./tubes";
import { Art, Elapsed, Eq, Equalizer, Hairline, Icon, Seek, Sign } from "./visuals";
import "./neon.css";

type Focus = "playlists" | "tracks" | "next";
type Tab = "tracks" | "next" | "library" | "more";
type Toast = { id: number; text: string; hue: Hue } | null;
type Player = SkinProps["data"]["player"];

const TABS: { id: Tab; label: string; focus: Focus | null }[] = [
  { id: "tracks", label: "Tracks", focus: "tracks" },
  { id: "next", label: "Up next", focus: "next" },
  { id: "library", label: "Library", focus: "playlists" },
  { id: "more", label: "More", focus: null },
];

const PANES: Focus[] = ["playlists", "tracks", "next"];

const KEYS: Record<"full" | "compact" | "tight", [string, string][]> = {
  full: [
    ["space", "play/pause"],
    ["n", "next"],
    ["p", "prev"],
    ["f", "like"],
    ["s", "search"],
    ["R", "reshuffle"],
    ["y", "link"],
    ["@", "mention"],
    ["c", "card"],
    ["d", "device"],
    ["− +", "volume"],
    ["?", "help"],
  ],
  compact: [
    ["space", "play"],
    ["n", "next"],
    ["p", "prev"],
    ["f", "like"],
    ["s", "search"],
    ["R", "reshuffle"],
    ["1–4", "tabs"],
    ["?", "keys"],
  ],
  tight: [
    ["space", "play"],
    ["n", "next"],
    ["f", "like"],
    ["1–4", "tabs"],
    ["?", "keys"],
  ],
};

const paletteOf = (palette: string) => ((PALETTES.neon as readonly string[]).includes(palette) ? palette : PALETTES.neon[0]);

const ordered = (playlists: Playlist[] | null): Playlist[] => [...(playlists ?? []).filter((entry) => entry.readable), ...(playlists ?? []).filter((entry) => !entry.readable)];

const pad = (value: number) => String(value).padStart(2, "0");

const songs = (count: number) => `${count.toLocaleString()} ${count === 1 ? "song" : "songs"}`;

const clamp = (value: number, length: number) => Math.max(0, Math.min(length - 1, value));

function useSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => setSize((value) => (value.width === element.clientWidth && value.height === element.clientHeight ? value : { width: element.clientWidth, height: element.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function titleOf(player: Player): string {
  return player.track?.name ?? (player.status === "no-device" ? "No device" : "Nothing playing");
}

function Over({ data, device = false }: { data: SkinProps["data"]; device?: boolean }) {
  const { player } = data;
  const track = player.track;
  const list = data.selection.tracks ?? [];
  const index = track === null ? -1 : list.findIndex((entry) => entry.id === track.id);
  const context = player.context === null ? null : (player.context.name ?? player.context.kind);
  return (
    <div className="n-over">
      <span className="n-live">{track === null ? (player.status === "no-device" ? "○ No device" : "○ Idle") : player.isPlaying ? "● Now playing" : "❚❚ Paused"}</span>
      {index >= 0 ? ` · Track ${pad(index + 1)} / ${list.length}` : ""}
      {context === null ? "" : ` · ${context}`}
      {device && player.device !== null ? ` · ${player.device.name}` : ""}
    </div>
  );
}

function Transport({ player, actions }: { player: Player; actions: SkinProps["actions"] }) {
  return (
    <span className="n-btns" onMouseDown={(event) => event.preventDefault()}>
      <button type="button" className="n-tbb" onClick={actions.previous} aria-label="Previous song" title="Previous (p)">
        <Icon name="prev" />
      </button>
      <button type="button" className="n-pp" onClick={actions.toggle} aria-label={player.isPlaying ? "Pause" : "Play"} title="Play / pause (space)">
        <Icon name={player.isPlaying ? "pause" : "play"} />
      </button>
      <button type="button" className="n-tbb" onClick={actions.next} aria-label="Next song" title="Next (n)">
        <Icon name="next" />
      </button>
      <button
        type="button"
        className={`n-tbb n-like ${player.liked ? "n-on" : ""}`}
        onClick={actions.like}
        disabled={player.track === null}
        aria-pressed={player.liked === true}
        aria-label={player.liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
        title="Save to Liked Songs (f)"
      >
        <Icon name="heart" />
      </button>
    </span>
  );
}

const repeatLabel = (player: Player) => (player.repeat === "off" ? "off" : player.repeat === "track" ? "one" : "all");

function Modes({ player, onShuffle, onRepeat, small = false }: { player: Player; onShuffle(): void; onRepeat(): void; small?: boolean }) {
  const shuffle = player.shuffle ? "on" : "off";
  const repeat = repeatLabel(player);
  return (
    <span className={small ? "n-mini-m" : "n-modes"}>
      <button type="button" className={`n-mode ${player.shuffle ? "n-on" : ""}`} onClick={onShuffle} title={`Shuffle ${shuffle} (x)`} aria-pressed={player.shuffle}>
        <Icon name="shuffle" />
        {small ? null : (
          <>
            Shuffle<small>{shuffle}</small>
          </>
        )}
      </button>
      <button type="button" className={`n-mode ${player.repeat === "off" ? "" : "n-on"}`} onClick={onRepeat} title={`Repeat ${repeat} (r)`} aria-pressed={player.repeat !== "off"}>
        <Icon name="repeat" />
        {small ? null : (
          <>
            Repeat<small>{repeat}</small>
          </>
        )}
      </button>
    </span>
  );
}

function Volume({ player, onSet }: { player: Player; onSet(percent: number): void }) {
  const device = player.device;
  const volume = device?.supportsVolume ? device.volumePercent : null;
  const on = volume === null ? 0 : Math.round(volume / 10);
  return (
    <span className={`n-vol ${volume === null ? "n-dis" : ""}`} title="Volume (− +)">
      <Icon name="volume" />
      <span
        className="n-segs"
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={volume ?? 0}
        onClick={(event) => {
          if (volume === null) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onSet(Math.max(1, Math.ceil(((event.clientX - rect.left) / rect.width) * 10)) * 10);
        }}
      >
        {Array.from({ length: 10 }, (_, index) => (
          <i key={index} className={index < on ? "n-on" : ""} style={{ height: 4 + index }} />
        ))}
      </span>
      <span className="n-v">{volume ?? "–"}</span>
      {player.duck.active && player.duck.mode === "lower" ? (
        <span className="n-dk" title="Lowered while an agent waits">
          ↓
        </span>
      ) : null}
    </span>
  );
}

function Hero({ props, onShare, onLike }: { props: SkinProps; onShare(how: Share): void; onLike(): void }) {
  const { data, actions } = props;
  const { player } = data;
  const track = player.track;
  return (
    <div className="n-hero">
      <Art track={track} demo={data.demo} className="n-hcv" />
      <div className="n-hmeta">
        <Over data={data} />
        <div className="n-plate">
          <i className="n-bolt n-a" />
          <i className="n-bolt n-b" />
          <i className="n-bolt n-c" />
          <i className="n-bolt n-d" />
          <Sign text={titleOf(player)} lit={track !== null} max={42} ignite={track?.id ?? player.status} />
          <div className={`n-artist ${track === null ? "n-unlit" : "n-lit n-clear"}`}>{track === null ? (player.status === "no-device" ? "Spotify isn't open anywhere" : "Pick a playlist, or press space") : artists(track)}</div>
        </div>
        {track === null ? (
          player.status === "no-device" ? (
            <div className="n-shares">
              <button type="button" className="n-sbtn n-ol" onClick={actions.launchApp}>
                <Icon name="open" />
                Open Spotify <kbd data-k="o">o</kbd>
              </button>
            </div>
          ) : null
        ) : (
          <>
            <div className="n-facts">
              <span className="n-trunc">
                {track.album.name}
                {track.album.year === null ? "" : ` · ${track.album.year}`}
              </span>
              <span className="n-dim">·</span>
              <button type="button" className={`n-saved ${player.liked ? "" : "n-no"}`} onClick={onLike}>
                <Icon name="heart" />
                {player.liked ? "Saved to Liked Songs" : "Not saved · f to like"}
              </button>
            </div>
            <ShareButtons onShare={onShare} />
          </>
        )}
      </div>
    </div>
  );
}

function NeonPage(props: SkinProps) {
  const { data, actions } = props;
  const { player } = data;
  const track = player.track;
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const size = useSize(root);
  const layout = layoutFor(size);
  const full = layout === "full";
  const [pane, setPane] = useState<Focus>("tracks");
  const [tab, setTab] = useState<Tab>("tracks");
  const [cursor, setCursor] = useState<Record<Focus, number | null>>({ playlists: null, tracks: null, next: null });
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [summon, setSummon] = useState(0);
  const [help, setHelp] = useState(false);
  const [picker, setPicker] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const playlists = useMemo(() => ordered(data.playlists), [data.playlists]);
  const upcoming = upNext(data).slice(0, 30);
  const selection = data.selection;
  const needle = query.trim().toLowerCase();
  const trackList: Track[] =
    found?.tracks ?? (needle === "" ? (selection.tracks ?? []) : (selection.tracks ?? []).filter((entry) => `${entry.name} ${artists(entry)} ${entry.album.name}`.toLowerCase().includes(needle)));
  const focus: Focus | null = full ? pane : (TABS.find((entry) => entry.id === tab)?.focus ?? null);
  const at: Record<Focus, number> = {
    playlists: cursor.playlists ?? Math.max(0, playlists.findIndex((entry) => entry.id === selection.playlist?.id)),
    tracks: cursor.tracks ?? Math.max(0, trackList.findIndex((entry) => entry.id === track?.id)),
    next: cursor.next ?? 0,
  };
  const lengths: Record<Focus, number> = { playlists: playlists.length, tracks: trackList.length, next: upcoming.length };

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (summon > 0) input.current?.focus();
  }, [summon]);

  useEffect(() => setCursor((value) => ({ ...value, tracks: null })), [selection.playlist?.id, found]);

  const say = (text: string, hue: Hue = "play") => setToast({ id: Date.now(), text, hue });
  const rest = () => root.current?.focus({ preventScroll: true });

  const light = (key: string) => {
    const cap = capFor(key);
    if (cap === null || root.current === null) return;
    for (const element of root.current.querySelectorAll<HTMLElement>("kbd[data-k]")) {
      if (element.dataset.k !== cap) continue;
      element.classList.add("n-hit");
      setTimeout(() => element.classList.remove("n-hit"), 280);
    }
  };

  const clearSearch = () => {
    setQuery("");
    setFound(null);
    setSearchOpen(false);
  };

  const playList = (playlist: Playlist | null | undefined) => {
    if (!playlist) return;
    actions.playPlaylist(playlist);
    say(`playing ${playlist.name}`);
  };

  const pick = (index: number, again = false) => {
    const playlist = playlists[index];
    if (playlist === undefined) return;
    setCursor((value) => ({ ...value, playlists: index }));
    if (again && selection.playlist?.id === playlist.id && found === null) return playList(playlist);
    actions.select(playlist.id);
    clearSearch();
    if (!full) setTab("tracks");
    if (!playlist.readable) say(`${playlist.name} is followed · play only · ⏎ plays it`, "clear");
  };

  const playRow = (index: number) => {
    const chosen = trackList[index];
    if (chosen === undefined) return;
    setCursor((value) => ({ ...value, tracks: index }));
    if (found === null && selection.playlist !== null) actions.playPlaylist(selection.playlist, chosen);
    else actions.playTrack(chosen);
  };

  const playNext = (chosen: Track) => {
    actions.playTrack(chosen);
    say(`playing ${chosen.name}`);
  };

  const share = (how: Share, subject: Track | null = track) => {
    if (subject === null) return say("nothing playing to share", "warn");
    if (how === "link") actions.copyLink(subject);
    if (how === "thread") actions.mention(subject);
    if (how === "card") actions.shareCard(subject, root.current);
    say(how === "link" ? `copied link · ${subject.name}` : how === "thread" ? `mentioned ${subject.name} in the thread` : `share card copied · ${subject.name}`, "uv");
  };

  const like = () => {
    if (track === null) return;
    actions.like();
    say(player.liked ? "removed from Liked Songs" : "♥ saved to Liked Songs");
  };

  const reshuffle = () => {
    if (data.shuffling) return;
    const source = sourceOf(props);
    actions.smartShuffle({ sourceId: source.id });
    say(`reshuffling ${source.name}${data.shuffleOptions.vibe ? ` · vibe “${data.shuffleOptions.vibe}”` : ""}`, "vibe");
  };

  const shuffle = () => {
    actions.setShuffle(!player.shuffle);
    say(`shuffle ${player.shuffle ? "off" : "on"}`, "clear");
  };

  const repeat = () => {
    actions.cycleRepeat();
    say(`repeat ${player.repeat === "off" ? "all" : player.repeat === "context" ? "one" : "off"}`, "clear");
  };

  const openPicker = () => {
    actions.refreshDevices();
    setPicker(Math.max(0, data.devices.findIndex((device) => device.isActive)));
  };

  const transfer = (device: Device | undefined) => {
    if (device?.id == null) return;
    actions.transfer(device.id);
    setPicker(null);
    say(`playing on ${device.name}`, "uv");
    rest();
  };

  const openTab = (next: Tab) => {
    setTab(next);
    if (next !== "tracks") setSearchOpen(false);
  };

  const summonSearch = () => {
    if (!full) {
      setTab("tracks");
      setSearchOpen(true);
    }
    setSummon((value) => value + 1);
  };

  const runSearch = () => {
    const text = query.trim();
    if (text === "") return;
    setSearching(true);
    actions.search(text).then(
      (result) => {
        setFound(result);
        setSearching(false);
        say(`${songs(result.tracks.length)} on Spotify for “${text}”`, "clear");
        rest();
      },
      () => {
        setSearching(false);
        say("search failed", "warn");
      },
    );
  };

  const move = (delta: number) => {
    if (picker !== null) return setPicker(clamp(picker + delta, data.devices.length));
    if (focus === null) return;
    setCursor((value) => ({ ...value, [focus]: clamp(at[focus] + delta, lengths[focus]) }));
  };

  const enter = () => {
    if (focus === "playlists") return pick(at.playlists, true);
    if (focus === "next") {
      const entry = upcoming[at.next];
      return entry === undefined ? undefined : playNext(entry.track);
    }
    if (focus === "tracks") {
      if (found === null && selection.playlist !== null && !selection.readable) return playList(selection.playlist);
      playRow(at.tracks);
    }
  };

  const handle = (event: KeyboardEvent): boolean => {
    if (picker !== null) {
      if (event.key === "Escape" || event.key === "d") {
        setPicker(null);
        return true;
      }
      if (event.key === "Enter") {
        transfer(data.devices[picker]);
        return true;
      }
    }
    if (transportKey(event, data, actions)) return true;
    const position = progressAt(player, Date.now());
    switch (event.key) {
      case "ArrowLeft":
        actions.seek(Math.max(0, position - 10_000));
        return true;
      case "ArrowRight":
        actions.seek(position + 10_000);
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
        enter();
        return true;
      case "Tab":
        if (full) setPane(PANES[(PANES.indexOf(pane) + (event.shiftKey ? 2 : 1)) % PANES.length]!);
        else openTab(TABS[(TABS.findIndex((entry) => entry.id === tab) + (event.shiftKey ? TABS.length - 1 : 1)) % TABS.length]!.id);
        return true;
      case "f":
        like();
        return true;
      case "s":
        summonSearch();
        return true;
      case "R":
        reshuffle();
        return true;
      case "x":
        shuffle();
        return true;
      case "r":
        repeat();
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
      case "?":
        setHelp(true);
        return true;
      case "Escape":
        if (query === "" && found === null && cursor[focus ?? "tracks"] === null) return false;
        clearSearch();
        setCursor({ playlists: null, tracks: null, next: null });
        return true;
      default: {
        const index = Number(event.key) - 1;
        if (full || !Number.isInteger(index) || TABS[index] === undefined) return false;
        openTab(TABS[index]!.id);
        return true;
      }
    }
  };

  useKeys(root, (event) => {
    if (help) {
      setHelp(false);
      return true;
    }
    const used = handle(event);
    if (used) light(event.key);
    return used;
  });

  const search = (
    <label className="n-search" title="Search (s)">
      <Icon name="search" />
      <input
        ref={input}
        value={query}
        placeholder={`Filter ${selection.playlist?.name ?? "songs"} or search Spotify`}
        aria-label="Filter or search"
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value);
          setFound(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") runSearch();
          else if (event.key === "Escape") {
            clearSearch();
            rest();
          } else return;
          event.stopPropagation();
        }}
      />
      {searching ? <span className="n-busy">searching…</span> : <kbd data-k="s">s</kbd>}
    </label>
  );

  const playButton = (playlist: Playlist) => (
    <button type="button" className="n-plb" onClick={() => playList(playlist)}>
      <Icon name="play" />
      Play
    </button>
  );

  const tracksBody = () => {
    const filtered = needle !== "" && found === null;
    const note = found !== null ? `Spotify · ${songs(found.tracks.length)} for “${query.trim()}” · esc clears` : filtered ? `filtered: “${query.trim()}” · ⏎ searches Spotify · esc clears` : null;
    const playlist = selection.playlist;
    const body =
      found === null && playlist === null ? (
        <div className="n-empty">pick a playlist from the library</div>
      ) : found === null && selection.loading ? (
        <div className="n-empty">loading songs…</div>
      ) : found === null && !selection.readable && playlist !== null ? (
        <div className="n-empty n-note">
          <span>Spotify only lists the songs of playlists you own or collaborate on. {playlist.name} still plays.</span>
          {playButton(playlist)}
        </div>
      ) : trackList.length === 0 ? (
        <div className="n-empty">{found !== null ? "no songs found" : filtered ? `Nothing in ${playlist?.name ?? "this playlist"} matches “${query.trim()}”. ⏎ searches all of Spotify.` : "this playlist is empty"}</div>
      ) : (
        <Tracks props={props} tracks={trackList} cursor={at.tracks} focused={focus === "tracks"} album={full || size.width >= 760} onPlay={(index) => (setPane("tracks"), playRow(index))} onShare={share} />
      );
    return { note, body };
  };

  const devicePicker =
    picker === null ? null : (
      <>
        <div className="n-scrim" onClick={() => setPicker(null)} />
        <div className="n-devpop n-glass" role="dialog" aria-label="Play on">
          <div className="n-cap">
            Play on <small>d</small>
          </div>
          <Devices devices={data.devices} cursor={picker} onPick={transfer} />
        </div>
      </>
    );

  const lit = player.isPlaying && track !== null;
  const palette = paletteOf(props.palette);
  const shell = (children: React.ReactNode) => (
    <div
      ref={root}
      tabIndex={0}
      data-size={layout}
      className={`sp-neon n-${palette} ${full ? "n-full" : "n-cmp"} ${lit ? "" : "n-paused"}`}
      onMouseDown={(event) => !isTyping(event.target) && event.currentTarget.focus({ preventScroll: true })}
    >
      <div className="n-spill" />
      {children}
      <Keycaps keys={KEYS[layout]} toast={toast} />
      {devicePicker}
      {help ? <Help onClose={() => setHelp(false)} /> : null}
    </div>
  );

  if (full) {
    const { note, body } = tracksBody();
    const playlist = selection.playlist;
    return shell(
      <>
        <div className="n-top">
          <div className="n-brand">
            <i className="n-lit n-play">♫</i>Spotify <span>/</span> <em className="n-trunc">{playlist?.name ?? "Library"}</em>
          </div>
          {search}
          <span className="n-grow" />
          <Duck duck={player.duck} />
          <button type="button" className="n-helpbtn" onClick={() => setHelp(true)}>
            <kbd data-k="?">?</kbd>keys
          </button>
        </div>
        <div className="n-main">
          <aside className={`n-side ${pane === "playlists" ? "n-focus" : ""}`} onMouseDown={() => setPane("playlists")}>
            <div className="n-cap">
              Library <small>{data.playlists === null ? "" : `${playlists.length} playlists`}</small>
            </div>
            <Library props={props} playlists={playlists} cursor={at.playlists} focused={focus === "playlists"} onPick={pick} onPlay={playList} />
            <Stats stats={data.stats} />
          </aside>
          <main className="n-center">
            <Hero props={props} onShare={share} onLike={like} />
            <Equalizer player={player} palette={palette} bands={52} reflect className="n-fvis" />
            <div className={`n-tl ${pane === "tracks" ? "n-focus" : ""}`} onMouseDown={() => setPane("tracks")}>
              <div className="n-tl-h">
                <span className="n-nmx n-trunc">{found !== null ? "Search" : (playlist?.name ?? "Tracks")}</span>
                {found === null && playlist !== null && note === null ? (
                  <span className="n-sub n-trunc">
                    {selection.readable && selection.tracks !== null && !selection.loading ? `${songs(selection.tracks.length)} · ${playlistLength(selection.tracks)}` : songs(playlist.trackCount)} · by {playlist.ownedByMe ? "you" : playlist.owner}
                  </span>
                ) : null}
                {note === null ? null : <span className="n-flt n-trunc">{note}</span>}
                {found === null && playlist !== null && selection.readable ? playButton(playlist) : null}
              </div>
              {body}
            </div>
          </main>
          <aside className={`n-rail ${pane === "next" ? "n-focus" : ""}`} onMouseDown={() => setPane("next")}>
            <div className="n-cap">
              Up next <span className={`n-ss-on ${data.session === null ? "n-unlit" : "n-lit n-vibe"}`}>smart shuffle</span>
            </div>
            <Rules props={props} onShuffle={reshuffle} onLeave={rest} />
            <Queue props={props} cursor={at.next} focused={focus === "next"} onPlay={playNext} />
          </aside>
        </div>
        <div className="n-tbar">
          <Modes player={player} onShuffle={shuffle} onRepeat={repeat} />
          <div className="n-ctl">
            <Transport player={player} actions={actions} />
            <div className="n-seek">
              <Seek player={player} onSeek={actions.seek} />
            </div>
          </div>
          <div className="n-out">
            <Volume player={player} onSet={actions.setVolume} />
            <button type="button" className="n-dev n-ol" onClick={openPicker} title="Pick a device (d)">
              <Icon name="laptop" />
              <span className="n-trunc">{player.device?.name ?? "No device"}</span>
              <Icon name="up" className="n-ch" />
            </button>
          </div>
        </div>
      </>,
    );
  }

  const tight = layout === "tight";
  const counts: Partial<Record<Tab, number>> = { tracks: trackList.length, next: upcoming.length, library: playlists.length };
  const { note, body } = tracksBody();
  return shell(
    <>
      <div className="n-chead">
        <Equalizer player={player} palette={palette} bands={36} className="n-cvis" />
        {tight ? null : <Art track={track} demo={data.demo} className="n-ccv" />}
        <div className="n-cmeta">
          <Over data={data} device />
          <Sign text={titleOf(player)} lit={track !== null} max={26} single ignite={track?.id ?? player.status} />
          <div className="n-cart">
            {track === null ? (
              <span className="n-dim">{player.status === "no-device" ? "Spotify isn't open anywhere" : "pick a playlist, or press space"}</span>
            ) : (
              <>
                <b className="n-lit n-clear">{artists(track)}</b>{" "}
                <span className="n-dim">
                  · {track.album.name}
                  {track.album.year === null ? "" : ` · ${track.album.year}`}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="n-cbtns">
          {player.status === "no-device" && track === null ? (
            <button type="button" className="n-sbtn n-ol" onClick={actions.launchApp}>
              <Icon name="open" />
              Open Spotify
            </button>
          ) : (
            <Transport player={player} actions={actions} />
          )}
        </div>
        <div className="n-cseek">
          <Modes player={player} onShuffle={shuffle} onRepeat={repeat} small />
          <Seek player={player} onSeek={actions.seek} />
          <Volume player={player} onSet={actions.setVolume} />
        </div>
      </div>
      <div className="n-tabs" role="tablist">
        {TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={`n-tab ${tab === entry.id ? "n-on" : ""}`} onClick={() => openTab(entry.id)}>
            {entry.label}
            {counts[entry.id] === undefined ? null : <small>{counts[entry.id]}</small>}
          </button>
        ))}
        <Duck duck={player.duck} short={tight} />
      </div>
      <div key={tab} className="n-cbody">
        {tab === "tracks" ? (
          <>
            {searchOpen || query !== "" ? search : null}
            {note === null ? null : <div className="n-flt n-trunc">{note}</div>}
            {body}
          </>
        ) : tab === "next" ? (
          <>
            <Rules props={props} onShuffle={reshuffle} onLeave={rest} />
            <Queue props={props} cursor={at.next} focused={focus === "next"} onPlay={playNext} />
          </>
        ) : tab === "library" ? (
          <Library props={props} playlists={playlists} cursor={at.playlists} focused={focus === "playlists"} onPick={pick} onPlay={playList} />
        ) : (
          <div className="n-cgrid">
            <div>
              <div className="n-cap">Share this track</div>
              <ShareButtons onShare={share} keys />
            </div>
            <div>
              <div className="n-cap">
                Play on <small>d</small>
              </div>
              <Devices devices={data.devices} cursor={-1} onPick={transfer} />
            </div>
            <Stats stats={data.stats} />
          </div>
        )}
      </div>
    </>,
  );
}

function NeonMini({ data, actions, palette, close }: MiniProps) {
  const root = useRef<HTMLDivElement>(null);
  const { player } = data;
  const track = player.track;
  useKeys(root, (event) => {
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
  });
  const lit = player.isPlaying && track !== null;
  return (
    <div ref={root} tabIndex={0} className={`sp-neon n-${paletteOf(palette)} n-mini ${lit ? "" : "n-paused"} ${player.duck.active ? "n-ducked" : ""}`}>
      <span className="n-mcv" data-sp-drag="" title="Drag to move">
        <Art track={track} demo={data.demo} />
      </span>
      <div className="n-mm">
        <button type="button" className="n-mtitle" onClick={actions.openPage} title="Open the Spotify page">
          <Sign text={titleOf(player)} lit={track !== null} max={17} single ignite={track?.id ?? player.status} />
        </button>
        <div className="n-ma">
          {track === null ? (player.status === "no-device" ? "no device · o opens the page" : "press space to play") : artists(track)}
          {track === null ? null : (
            <>
              {" · "}
              <Elapsed player={player} />
            </>
          )}
        </div>
      </div>
      <Eq />
      <Transport player={player} actions={actions} />
      <button type="button" className="n-tbb n-x" onClick={close} aria-label="Close the mini player" title="Close (q)">
        <Icon name="close" />
      </button>
      <Hairline player={player} />
      {player.duck.active ? (
        <div className="n-dkband">
          <Duck duck={player.duck} />
        </div>
      ) : null}
    </div>
  );
}

export const neonSkin: Skin = { id: "neon", Page: NeonPage, Mini: NeonMini };
