import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LIKED_ID, PALETTES, type Device, type Playlist, type SearchResult, type Track } from "../../../contract";
import { artists } from "../../format";
import { isTyping, transportKey, useKeys } from "../../keys";
import { progressAt, upNext, type MiniProps, type Skin, type SkinProps, type SpotifyData } from "../../model";
import { deckle, kanji, layoutFor, nextRepeat, pad, repeatWord, stillWater, type Layout } from "./brush";
import { fibers } from "./paint";
import { Devices, Duck, emptyTracks, Help, Kbd, Library, ordered, Reshuffle, Session, Shares, Stats, Toggles, Tracks, upCount, UpNext, Vibe, Volume, type Share } from "./parts";
import { Disc, Elapsed, Enso, Filters, Icon, Ink, PlayButton, Pond, Seal, Seam } from "./visuals";
import "./wabi-sabi.css";

type Tab = "tracks" | "next" | "library" | "more";
type List = "tracks" | "next" | "library";
type Note = { id: number; text: string } | null;
type Cursor = Record<List | "device", number | null>;

const TABS: { id: Tab; label: string; short: string }[] = [
  { id: "tracks", label: "tracks", short: "tracks" },
  { id: "next", label: "up next", short: "next" },
  { id: "library", label: "library", short: "library" },
  { id: "more", label: "share · stats", short: "more" },
];
const LISTS: List[] = ["library", "tracks", "next"];
const FRESH: Cursor = { tracks: null, next: null, library: null, device: null };
const DECKLE = deckle(5);

const toneOf = (palette: string) => ((PALETTES["wabi-sabi"] as readonly string[]).includes(palette) ? palette : PALETTES["wabi-sabi"][0]);

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

function usePaper(root: React.RefObject<HTMLElement | null>, palette: string): { ink: string; style: React.CSSProperties | undefined } {
  const [ink, setInk] = useState("#27231e");
  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return;
    const value = getComputedStyle(element).getPropertyValue("--ink").trim();
    if (value !== "") setInk(value);
  }, [root, palette]);
  const texture = useMemo(() => fibers(ink), [ink]);
  return { ink, style: texture === null ? undefined : ({ "--w-fibers": `url(${texture})` } as React.CSSProperties) };
}

function placeOf(data: SpotifyData): { index: number; total: number } | null {
  const track = data.player.track;
  const tracks = data.selection.tracks ?? [];
  const index = track === null ? -1 : tracks.findIndex((entry) => entry.id === track.id);
  return index === -1 ? null : { index, total: tracks.length };
}

function origin(data: SpotifyData): string {
  const { track, context } = data.player;
  const session = data.session;
  if (track !== null && session !== null && session.tracks.some((entry) => entry.track.id === track.id)) return `smart shuffle · ${session.sourceName.toLowerCase()}`;
  return (context?.name ?? (context ? context.kind : "a single song")).toLowerCase();
}

function kicker(data: SpotifyData, full: boolean): string {
  if (data.player.track === null) return data.player.status === "no-device" ? "no device" : "nothing playing";
  const place = placeOf(data);
  return `${place === null ? "" : `${pad(place.index + 1)} / ${pad(place.total)} · `}${full ? "from " : ""}${origin(data)}`;
}

function vertical(data: SpotifyData): string {
  const place = placeOf(data);
  const from = origin(data);
  return place === null ? from : `${from} · ${kanji(place.index + 1)}／${kanji(place.total)}`;
}

function Brand({ size, full }: { size: number; full: boolean }) {
  return (
    <div className="w-brand">
      <Enso size={size} seed={3} />
      Spotify
      {full ? <i>quiet room</i> : null}
    </div>
  );
}

function Title({ data }: { data: SpotifyData }) {
  const track = data.player.track;
  const name = track?.name ?? "the room is quiet";
  return (
    <h2 className={`w-title ${name.length > 14 ? "w-long" : ""}`} title={name}>
      {name}
    </h2>
  );
}

function Silence({ props }: { props: SkinProps }) {
  const { data, actions } = props;
  if (data.player.status !== "no-device") return <div className="w-artist">press space to play, or pick a playlist</div>;
  return (
    <div className="w-artist">
      no device is awake ·{" "}
      <button type="button" className="w-link" onClick={actions.launchApp}>
        open Spotify
      </button>{" "}
      <Kbd>o</Kbd>
    </div>
  );
}

function Keep({ props, caption }: { props: SkinProps; caption: boolean }) {
  const { data, actions } = props;
  const liked = data.player.track !== null && data.player.liked === true;
  return (
    <button type="button" className={`w-seal-wrap ${liked ? "w-on" : ""}`} onClick={actions.like} disabled={data.player.track === null} aria-pressed={liked} aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"} title="Keep in Liked Songs (f)">
      <Seal liked={liked} />
      {caption ? (
        <span className="w-seal-cap">
          <b>{liked ? "Kept" : "Not yet kept"}</b> in Liked Songs
          <br />
          <Kbd>f</Kbd> {liked ? "to let go" : "to keep"}
        </span>
      ) : null}
    </button>
  );
}

function Transport({ props, size, children }: { props: SkinProps; size: number; children?: React.ReactNode }) {
  const { data, actions } = props;
  const hints = size > 40;
  return (
    <div className="w-tp" onMouseDown={(event) => event.preventDefault()}>
      <button type="button" className="w-ib" onClick={actions.previous} aria-label="Previous song" title="Previous (p)">
        <Icon name="prev" />
        {hints ? <Kbd>p</Kbd> : null}
      </button>
      <PlayButton playing={data.player.isPlaying} size={size} onClick={actions.toggle} />
      <button type="button" className="w-ib" onClick={actions.next} aria-label="Next song" title="Next (n)">
        {hints ? <Kbd>n</Kbd> : null}
        <Icon name="next" />
      </button>
      <span className="w-spc" />
      {children}
    </div>
  );
}

function States({ props, say }: { props: SkinProps; say(text: string): void }) {
  const { data, actions } = props;
  const { shuffle, repeat } = data.player;
  return (
    <>
      <button
        type="button"
        className={`w-state ${shuffle ? "w-on" : ""}`}
        onClick={() => {
          actions.setShuffle(!shuffle);
          say(shuffle ? "shuffle off · back to the order you set" : "shuffle on · smart shuffle steps aside");
        }}
        title="Shuffle (x)"
      >
        shuffle <b>{shuffle ? "on" : "off"}</b>
      </button>
      <button
        type="button"
        className={`w-state ${repeat !== "off" ? "w-on" : ""}`}
        onClick={() => {
          actions.cycleRepeat();
          say(nextRepeat(repeat));
        }}
        title="Repeat (r)"
      >
        repeat <b>{repeatWord(repeat)}</b>
      </button>
    </>
  );
}

function Picker({ props, open, cursor, caption, onToggle, onPick }: { props: SkinProps; open: boolean; cursor: number | null; caption: boolean; onToggle(): void; onPick(device: Device): void }) {
  const { data } = props;
  return (
    <div className={`w-dev ${open ? "w-open" : ""}`}>
      {caption ? <div className="w-cap">playing on</div> : null}
      <button type="button" className="w-dev-b" onClick={onToggle} aria-expanded={open} title="Devices (d)">
        <span className="w-trunc">{data.player.device?.name ?? "no device"}</span>
        <span className="w-chev">▼</span>
        {caption ? <Kbd>d</Kbd> : null}
      </button>
      {open ? <Devices devices={data.devices} current={data.player.device} cursor={cursor ?? -1} onPick={onPick} /> : null}
    </div>
  );
}

function WabiSabiPage(props: SkinProps) {
  const { data, actions, palette } = props;
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const size = useSize(root);
  const layout: Layout = layoutFor(size);
  const full = layout === "full";
  const tight = layout === "tight";
  const { ink, style } = usePaper(root, palette);
  const [tab, setTab] = useState<Tab>("tracks");
  const [focus, setFocus] = useState<List>("tracks");
  const [cursor, setCursor] = useState<Cursor>(FRESH);
  const [help, setHelp] = useState(false);
  const [picker, setPicker] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [summon, setSummon] = useState(0);
  const { player } = data;
  const track = player.track;
  const playlists = useMemo(() => ordered(data.playlists), [data.playlists]);
  const results = found !== null;
  const listed: Track[] = results ? found.tracks : (data.selection.tracks ?? []);
  const upcoming = upNext(data);
  const list: List | null = full ? focus : tab === "more" ? null : tab;

  useEffect(() => {
    if (note === null) return;
    const timer = setTimeout(() => setNote(null), 2400);
    return () => clearTimeout(timer);
  }, [note]);

  useEffect(() => {
    if (summon > 0) input.current?.focus();
  }, [summon]);

  useEffect(() => setCursor((value) => ({ ...value, tracks: null })), [data.selection.playlist?.id]);

  const say = (text: string) => setNote({ id: Date.now(), text });
  const rest = () => root.current?.focus({ preventScroll: true });

  const clearSearch = () => {
    setFound(null);
    setSearching(false);
    setQuery("");
    setCursor((value) => ({ ...value, tracks: null }));
  };

  const pick = (index: number) => {
    const playlist = playlists[index];
    if (playlist === undefined) return;
    setCursor((value) => ({ ...value, library: index }));
    if (found !== null) clearSearch();
    if (data.selection.playlist?.id === playlist.id && !playlist.readable) return playList(playlist);
    actions.select(playlist.id);
    if (!playlist.readable) say(`${playlist.name} is followed · play only, ⏎ again to play it`);
    else if (!full) setTab("tracks");
  };

  const playList = (playlist: Playlist) => {
    actions.playPlaylist(playlist);
    say(`playing ${playlist.name}`);
  };

  const playAt = (index: number) => {
    const chosen = listed[index];
    if (chosen === undefined) return;
    setCursor((value) => ({ ...value, tracks: index }));
    if (!results && data.selection.playlist !== null) actions.playPlaylist(data.selection.playlist, chosen);
    else actions.playTrack(chosen);
  };

  const playNext = (chosen: Track) => {
    actions.playTrack(chosen);
    say(`playing ${chosen.name}`);
  };

  const reshuffle = () => {
    if (data.shuffling) return;
    const chosen = data.selection.playlist;
    actions.smartShuffle({ sourceId: chosen?.readable ? chosen.id : LIKED_ID });
    say(`reshuffling ${chosen?.readable ? chosen.name : "Liked Songs"} by feel…`);
  };

  const share = (how: Share) => {
    if (track === null) return say("nothing playing to share");
    if (how === "link") actions.copyLink(track);
    if (how === "thread") actions.mention(track);
    if (how === "card") actions.shareCard(track, root.current);
    say(how === "link" ? "copied link" : how === "thread" ? `@${track.name} placed in the thread` : "share card on its way");
  };

  const like = () => {
    if (track === null) return;
    actions.like();
    say(player.liked ? "let go · removed from Liked Songs" : `kept · ${track.name} is in Liked Songs`);
  };

  const togglePicker = () => {
    if (!picker) actions.refreshDevices();
    setPicker(!picker);
    setCursor((value) => ({ ...value, device: null }));
  };

  const transfer = (device: Device) => {
    setPicker(false);
    if (device.id === null) return say(`${device.name} can't be reached from here`);
    actions.transfer(device.id);
    say(`playing on ${device.name}`);
  };

  const openSearch = () => {
    if (!full) setTab("tracks");
    setSearching(true);
    setSummon((value) => value + 1);
  };

  const runSearch = () => {
    const text = query.trim();
    if (text === "") return;
    say(`looking for “${text}”…`);
    actions.search(text).then(
      (result) => {
        setFound(result);
        setCursor((value) => ({ ...value, tracks: null }));
        say(`${result.tracks.length} ${result.tracks.length === 1 ? "song" : "songs"} for “${text}”`);
      },
      () => say("the search came back empty-handed · try again"),
    );
  };

  const lengthOf = (name: List) => (name === "tracks" ? listed.length : name === "next" ? upcoming.length : playlists.length);

  const move = (delta: number) => {
    if (list === null) return;
    const length = lengthOf(list);
    if (length === 0) return;
    setCursor((value) => {
      const at = value[list];
      const start = at ?? (list === "tracks" ? listed.findIndex((entry) => entry.id === track?.id) : list === "library" ? playlists.findIndex((entry) => entry.id === data.selection.playlist?.id) : -1);
      return { ...value, [list]: at === null && start !== -1 ? start : Math.max(0, Math.min(length - 1, (start === -1 ? (delta > 0 ? -1 : length) : start) + delta)) };
    });
  };

  const activate = (): boolean => {
    if (list === null) return false;
    const at = cursor[list];
    if (at === null) return false;
    if (list === "tracks") playAt(at);
    else if (list === "library") pick(at);
    else if (upcoming[at]) playNext(upcoming[at]!.track);
    return true;
  };

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (help) {
        setHelp(false);
        return true;
      }
      if (picker) {
        const at = cursor.device;
        if (event.key === "Escape" || event.key === "d") setPicker(false);
        else if (event.key === "j" || event.key === "ArrowDown") setCursor((value) => ({ ...value, device: Math.min(data.devices.length - 1, (at ?? -1) + 1) }));
        else if (event.key === "k" || event.key === "ArrowUp") setCursor((value) => ({ ...value, device: Math.max(0, (at ?? data.devices.length) - 1) }));
        else if (event.key === "Enter" && at !== null && data.devices[at]) transfer(data.devices[at]!);
        else return false;
        return true;
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
          return activate();
        case "Tab":
          if (!full) return false;
          setFocus((value) => LISTS[(LISTS.indexOf(value) + (event.shiftKey ? LISTS.length - 1 : 1)) % LISTS.length]!);
          return true;
        case "f":
          like();
          return true;
        case "s":
          openSearch();
          return true;
        case "R":
          reshuffle();
          return true;
        case "x":
          actions.setShuffle(!player.shuffle);
          say(player.shuffle ? "shuffle off" : "shuffle on");
          return true;
        case "r":
          actions.cycleRepeat();
          say(nextRepeat(player.repeat));
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
          togglePicker();
          return true;
        case "o":
          actions.launchApp();
          return true;
        case "?":
          setHelp(true);
          return true;
        case "Escape":
          if (found === null && !searching) return false;
          clearSearch();
          return true;
        default: {
          const index = Number(event.key) - 1;
          if (full || !Number.isInteger(index) || TABS[index] === undefined) return false;
          setTab(TABS[index]!.id);
          return true;
        }
      }
    },
    [help, picker, cursor, data, actions, player, full, list, listed, upcoming, playlists, found, searching, track],
  );
  useKeys(root, onKey);

  const finder = (
    <label className="w-search">
      <input
        ref={input}
        value={query}
        placeholder="search"
        aria-label="Search Spotify"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") runSearch();
          else if (event.key === "Escape") {
            if (query === "") clearSearch();
            event.currentTarget.blur();
            rest();
          } else return;
          event.stopPropagation();
        }}
      />
      <Kbd>s</Kbd>
    </label>
  );

  const tracks =
    listed.length === 0 ? (
      emptyTracks(data, results, () => data.selection.playlist && playList(data.selection.playlist))
    ) : (
      <Tracks
        key={results ? "found" : (data.selection.playlist?.id ?? "none")}
        props={props}
        tracks={listed}
        cursor={cursor.tracks ?? -1}
        focused={list === "tracks"}
        results={results}
        onPick={(index) => {
          if (full) setFocus("tracks");
          playAt(index);
        }}
      />
    );

  const library = (
    <Library
      data={data}
      cursor={cursor.library ?? -1}
      focused={list === "library"}
      onPick={(index) => {
        if (full) setFocus("library");
        pick(index);
        rest();
      }}
    />
  );

  const next = (limit?: number) => (
    <UpNext
      props={props}
      cursor={cursor.next ?? -1}
      focused={list === "next"}
      limit={limit}
      onPick={(chosen) => {
        if (full) setFocus("next");
        playNext(chosen);
      }}
    />
  );

  const picked = (
    <Picker
      props={props}
      open={picker}
      cursor={cursor.device}
      caption={full}
      onToggle={togglePicker}
      onPick={transfer}
    />
  );

  const volume = player.device === null || !player.device.supportsVolume ? null : player.device.volumePercent;
  const ducked = player.duck.active;
  const heading = results ? `search · “${query.trim()}”` : (data.selection.playlist?.name ?? "songs");
  const back = results ? (
    <button type="button" className="w-link" onClick={clearSearch}>
      back to {data.selection.playlist?.name ?? "the playlist"} <Kbd>esc</Kbd>
    </button>
  ) : null;

  return (
    <div
      ref={root}
      tabIndex={0}
      data-layout={layout}
      className={`sp-wabi w-${toneOf(palette)} w-tex w-${layout} ${player.isPlaying ? "" : "w-paused"} ${ducked ? "w-ducked" : ""}`}
      style={style}
      onMouseDown={(event) => {
        if (picker && !(event.target as HTMLElement).closest(".w-dev")) setPicker(false);
        if (!isTyping(event.target)) event.currentTarget.focus({ preventScroll: true });
      }}
    >
      <Filters />
      <Ink.Provider value={ink}>
        {full ? (
          <>
            <header className="w-hd">
              <Brand size={20} full />
              <Duck duck={player.duck} short={false} />
            </header>
            <aside className="w-lib">
              {finder}
              <div className="w-cap">library</div>
              {library}
              <div className="w-stats">
                <div className="w-cap">this week</div>
                <Stats data={data} short={false} />
              </div>
            </aside>
            <main className="w-mn">
              <div className="w-np">
                <Disc player={player} demo={data.demo} size={208} seed={11} onClick={actions.toggle} title="Play or pause (space)" />
                <div className="w-meta">
                  <div className="w-kick w-trunc">{kicker(data, true)}</div>
                  <Title data={data} />
                  {track === null ? (
                    <Silence props={props} />
                  ) : (
                    <>
                      <div className="w-artist w-trunc">{artists(track)}</div>
                      <div className="w-album w-trunc">
                        {track.album.name}
                        {track.album.year === null ? null : <span className="w-yr">{track.album.year}</span>}
                      </div>
                    </>
                  )}
                  <Keep props={props} caption />
                </div>
                <div className="w-vert">{vertical(data)}</div>
              </div>
              <Seam player={player} onSeek={actions.seek} />
              <Transport props={props} size={46}>
                <States props={props} say={say} />
                <Volume volume={volume} ducked={ducked} onChange={actions.setVolume} />
              </Transport>
              <Pond player={player} />
              <div className="w-tl-h">
                <h3 className="w-trunc">{heading}</h3>
                <span>
                  {back ?? (
                    <>
                      {data.selection.tracks && data.selection.readable ? `${data.selection.tracks.length.toLocaleString()} songs · ` : ""}
                      <Kbd>j</Kbd> <Kbd>k</Kbd> move · <Kbd>⏎</Kbd> play
                    </>
                  )}
                </span>
              </div>
              {tracks}
            </main>
            <footer className="w-keys">
              <span>
                <Kbd>space</Kbd>pause
              </span>
              <span>
                <Kbd>n</Kbd>
                <Kbd>p</Kbd>next · previous
              </span>
              <span>
                <Kbd>f</Kbd>keep
              </span>
              <span>
                <Kbd>←</Kbd>
                <Kbd>→</Kbd>seek
              </span>
              <span>
                <Kbd>R</Kbd>reshuffle
              </span>
              <button type="button" className="w-sp" onClick={() => setHelp(true)}>
                <Kbd>?</Kbd>all keys
              </button>
              <span>
                <Kbd>⌘⇧S</Kbd>mini
              </span>
            </footer>
            <div className="w-alc-w">
              <section className="w-alc w-tex" style={{ clipPath: DECKLE }}>
                {picked}
                <div className="w-bl w-swash" />
                <h4>
                  next, by feel <small>smart shuffle</small>
                </h4>
                <Vibe props={props} onShuffle={reshuffle} onLeave={rest} />
                <Toggles props={props} short={false} />
                <Reshuffle busy={data.shuffling} onClick={reshuffle} />
                <Session data={data} />
                <div className="w-un">
                  <div className="w-cap">
                    <span>up next</span>
                    <span>{upcoming.length} queued</span>
                  </div>
                  {next(8)}
                </div>
                <div className="w-sh">
                  <div className="w-cap">share this song</div>
                  <Shares onShare={share} />
                </div>
              </section>
            </div>
          </>
        ) : (
          <>
            <header className="w-hd">
              <Brand size={18} full={false} />
              <Duck duck={player.duck} short />
              {picked}
            </header>
            <div className="w-np">
              <Disc player={player} demo={data.demo} size={tight ? 92 : 124} seed={11} onClick={actions.toggle} title="Play or pause (space)" />
              <div className="w-meta">
                <div className="w-kick w-trunc">{kicker(data, false)}</div>
                <Title data={data} />
                {track === null ? (
                  <Silence props={props} />
                ) : (
                  <div className="w-artist w-trunc">
                    {artists(track)}
                    {tight ? null : (
                      <span className="w-album">
                        {track.album.name}
                        {track.album.year === null ? null : <span className="w-yr">{track.album.year}</span>}
                      </span>
                    )}
                  </div>
                )}
                <Transport props={props} size={tight ? 34 : 38}>
                  <Volume volume={volume} ducked={ducked} onChange={actions.setVolume} label={false} />
                </Transport>
              </div>
              <Keep props={props} caption={false} />
            </div>
            <Seam player={player} onSeek={actions.seek} />
            {stillWater(size) ? null : <Pond player={player} />}
            <nav className="w-tabs" role="tablist">
              {TABS.map((entry, index) => (
                <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={tab === entry.id ? "w-on" : ""} onClick={() => setTab(entry.id)} title={`${entry.label} (${index + 1})`}>
                  {tight ? entry.short : entry.label}
                  {entry.id === "tracks" ? <sup>{listed.length}</sup> : entry.id === "next" ? <sup>{upCount(data)}</sup> : entry.id === "library" ? <sup>{playlists.length}</sup> : null}
                </button>
              ))}
              <span className="w-r">
                <States props={props} say={say} />
              </span>
            </nav>
            <div className="w-tabc">
              {tab === "tracks" ? (
                <div className="w-tab w-tab-tracks">
                  {searching || results ? (
                    <div className="w-find">
                      {finder}
                      {back}
                    </div>
                  ) : null}
                  {tracks}
                </div>
              ) : tab === "next" ? (
                <div className="w-tab">
                  <div className="w-vibe-row">
                    <span className="w-cap">vibe</span>
                    <Vibe props={props} onShuffle={reshuffle} onLeave={rest} />
                    <Reshuffle busy={data.shuffling} onClick={reshuffle} short />
                  </div>
                  <Toggles props={props} short />
                  <Session data={data} />
                  {next()}
                </div>
              ) : tab === "library" ? (
                <div className="w-tab">{library}</div>
              ) : (
                <div className="w-tab">
                  <div className="w-more">
                    <div>
                      <span className="w-cap">share this song</span>
                      <Shares onShare={share} />
                    </div>
                    <div className="w-stats">
                      <span className="w-cap">this week</span>
                      <Stats data={data} short />
                    </div>
                    <div>
                      <span className="w-cap">keys</span>
                      <p className="w-more-keys">
                        <Kbd>1–4</Kbd> tabs · <Kbd>s</Kbd> search
                        <br />
                        <Kbd>x</Kbd> shuffle · <Kbd>r</Kbd> repeat
                        <br />
                        <Kbd>d</Kbd> devices · <Kbd>?</Kbd> all
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <footer className="w-keys">
              <span>
                <Kbd>space</Kbd>pause
              </span>
              <span>
                <Kbd>n</Kbd>
                <Kbd>p</Kbd>
              </span>
              <span>
                <Kbd>f</Kbd>keep
              </span>
              {tight ? null : (
                <span>
                  <Kbd>R</Kbd>reshuffle
                </span>
              )}
              <span>
                <Kbd>1–4</Kbd>tabs
              </span>
              <button type="button" className="w-sp" onClick={() => setHelp(true)}>
                <Kbd>?</Kbd>keys
              </button>
            </footer>
          </>
        )}
        {help ? <Help compact={!full} /> : null}
        {note === null ? null : (
          <div key={note.id} className="w-toast" role="status">
            {note.text}
          </div>
        )}
      </Ink.Provider>
    </div>
  );
}

function WabiSabiMini({ data, actions, palette, close }: MiniProps) {
  const root = useRef<HTMLDivElement>(null);
  const { ink, style } = usePaper(root, palette);
  const { player } = data;
  const track = player.track;
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
  const duck = player.duck;
  const liked = track !== null && player.liked === true;
  const line = duck.active
    ? `♪ ${duck.mode === "pause" ? "paused" : "lowered"} — ${duck.threads.map((thread) => `‘${thread.title}’`).join(", ") || "a thread"} ${duck.threads.length > 1 ? "need" : "needs"} you`
    : [player.context?.name, player.device?.name].filter(Boolean).join(" · ");
  return (
    <div ref={root} tabIndex={0} className={`sp-wabi w-${toneOf(palette)} w-tex w-mini ${player.isPlaying ? "" : "w-paused"}`} style={style}>
      <Filters />
      <Ink.Provider value={ink}>
        <span className="w-grip" data-sp-drag="" title="Drag to move">
          <i />
          <i />
          <i />
        </span>
        <Disc player={player} demo={data.demo} size={58} seed={9} onClick={actions.toggle} />
        <div className="w-mini-b">
          <button type="button" className="w-l1 w-trunc" onClick={actions.openPage} title="Open the Spotify page (o)">
            <b>{track?.name ?? "nothing playing"}</b>
            <span>{track ? artists(track) : player.status === "no-device" ? "no device awake" : "press space to play"}</span>
          </button>
          <Seam player={player} onSeek={actions.seek} times={false} />
          <div className="w-l3">
            <Elapsed player={player} />
            {line ? (
              <>
                {" · "}
                <span className={duck.active ? "w-note" : ""}>{line}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="w-ctl" onMouseDown={(event) => event.preventDefault()}>
          <button type="button" className="w-ib" onClick={actions.previous} aria-label="Previous song" title="Previous (p)">
            <Icon name="prev" />
          </button>
          <PlayButton playing={player.isPlaying} size={32} onClick={actions.toggle} />
          <button type="button" className="w-ib" onClick={actions.next} aria-label="Next song" title="Next (n)">
            <Icon name="next" />
          </button>
          <button type="button" className={`w-seal-wrap ${liked ? "w-on" : ""}`} onClick={actions.like} disabled={track === null} aria-pressed={liked} aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"} title="Keep (f)">
            <Seal liked={liked} size="mini" />
          </button>
          <button type="button" className="w-close" onClick={close} aria-label="Close the mini player" title="Close (q)">
            ×
          </button>
        </div>
      </Ink.Provider>
    </div>
  );
}

export const wabiSabiSkin: Skin = { id: "wabi-sabi", Page: WabiSabiPage, Mini: WabiSabiMini };
