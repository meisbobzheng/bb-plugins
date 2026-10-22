import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIKED_ID, PALETTES, type DuckState, type Playlist, type SearchResult } from "../../../contract";
import { useArt } from "../../art";
import { artists } from "../../format";
import { isTyping, transportKey, useKeys } from "../../keys";
import { upNext, type MiniProps, type Skin, type SkinProps } from "../../model";
import { Doodle, DoodleFor, Icon, Tick, type IconName } from "./doodles";
import { Notebook, TABS, type Finder, type Tab } from "./Notebook";
import { fillOf, stepDays, stuck, vars } from "./stickers";
import { Caterpillar, JellyBand, MiniDisc, Turntable, VolumeDial } from "./visuals";
import "./pastel.css";

type Share = "link" | "uri" | "thread" | "card";
type Note = { id: number; text: string; bad: boolean } | null;

const SHARES: { how: Share; label: string; icon: IconName; fill: string; tilt: number }[] = [
  { how: "link", label: "Copy link", icon: "link", fill: "var(--mint)", tilt: -1.5 },
  { how: "uri", label: "Copy URI", icon: "tag", fill: "var(--butter)", tilt: 1 },
  { how: "thread", label: "@ thread", icon: "bubble", fill: "var(--sky)", tilt: -0.6 },
  { how: "card", label: "Make a card", icon: "card", fill: "var(--pink)", tilt: 1.8 },
];

const KEYS: [string, string][] = [
  ["space", "play"],
  ["n b", "skip"],
  ["h", "heart"],
  ["j k ⏎", "pick"],
  ["p", "play list"],
  ["s", "shake"],
  ["y", "link"],
  ["@", "thread"],
  ["c", "card"],
  ["1–4", "pages"],
  ["/", "search"],
  ["+ −", "volume"],
  [", .", "seek"],
  ["⌘⇧S", "mini"],
];

const toneOf = (palette: string) => ((PALETTES.pastel as readonly string[]).includes(palette) ? palette : PALETTES.pastel[0]);

const ordered = (playlists: Playlist[] | null): Playlist[] => [...(playlists ?? []).filter((entry) => entry.readable), ...(playlists ?? []).filter((entry) => !entry.readable)];

function subtitle(playlist: Playlist): string {
  if (playlist.kind === "liked") return "all your hearts";
  if (!playlist.readable) return "play only";
  return playlist.collaborative ? "made together" : "yours";
}

function Keys() {
  return (
    <div className="k-keys k-stk">
      <span className="k-tape">keys</span>
      <div className="k-keys-grid">
        {KEYS.map(([key, what]) => (
          <span key={key} className="k-key">
            <kbd>{key}</kbd>
            {what}
          </span>
        ))}
      </div>
    </div>
  );
}

function Shelf({ props, playlists, cursor, onPick }: { props: SkinProps; playlists: Playlist[]; cursor: number | null; onPick(index: number): void }) {
  const { data, actions } = props;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(".k-cursor")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);
  const label = (playlist: Playlist) => {
    const index = playlists.indexOf(playlist);
    const selected = data.selection.playlist?.id === playlist.id;
    return (
      <button
        key={playlist.id}
        type="button"
        className={`k-label ${playlist.readable ? "" : "k-ticket"} ${selected ? "k-pressed" : ""} ${index === cursor ? "k-cursor" : ""}`}
        style={stuck(playlist.name)}
        aria-pressed={selected}
        title={playlist.readable ? `${playlist.name} · double-click to play` : `${playlist.name} · Spotify only lets bb play this one`}
        onClick={() => onPick(index)}
        onDoubleClick={() => actions.playPlaylist(playlist)}
      >
        <span className="k-badge-dot">
          <DoodleFor seed={playlist.name} size={18} />
        </span>
        <span className="k-label-text">
          <span className="k-label-name k-trunc">{playlist.name}</span>
          <span className="k-label-sub">{subtitle(playlist)}</span>
        </span>
        <span className="k-label-count">
          {data.player.context?.uri === playlist.uri ? <Doodle kind="note" fill="var(--card)" size={14} className="k-spin-note" /> : null}
          {playlist.trackCount.toLocaleString()}
        </span>
      </button>
    );
  };
  const followed = playlists.filter((entry) => !entry.readable);
  return (
    <aside className="k-shelf">
      <div className="k-head">
        <span className="k-tape" style={vars({ "--tape": "var(--lilac)" })}>
          my mixtapes
        </span>
        <span className="k-scribble">{data.playlists === null ? "" : `${playlists.length} lists`}</span>
      </div>
      <div ref={list} className="k-labels">
        {data.playlists === null ? <span className="k-scribble">peeling off the stickers…</span> : null}
        {data.playlists !== null && playlists.length === 0 ? <span className="k-scribble">no playlists yet. make one in Spotify and it shows up here.</span> : null}
        {playlists.filter((entry) => entry.readable).map(label)}
        {followed.length > 0 ? (
          <div className="k-group">
            followed · play only <Doodle kind="sparkle" fill="var(--butter)" size={14} />
          </div>
        ) : null}
        {followed.map(label)}
      </div>
      <Keys />
    </aside>
  );
}

function Duck({ duck }: { duck: DuckState }) {
  return (
    <div className="k-duck k-stk" role="status">
      <b>
        <Doodle kind="moon" fill="var(--butter)" size={22} /> shh, an agent needs you
      </b>
      <span className="k-hand">music {duck.mode === "pause" ? "paused" : "turned down"} while you check:</span>
      <ul>
        {duck.threads.map((thread) => (
          <li key={thread.id}>{thread.title}</li>
        ))}
      </ul>
    </div>
  );
}

function NoDevice({ onLaunch }: { onLaunch(): void }) {
  return (
    <div className="k-nodevice k-stk">
      <b>no speaker is listening</b>
      <span>Spotify isn't awake on any of your devices. Open it and the record starts spinning here.</span>
      <button type="button" className="k-button" style={vars({ "--fill": "var(--pink)" })} onClick={onLaunch}>
        <Icon name="play" /> Open Spotify
      </button>
    </div>
  );
}

function Stage({ props, onShare }: { props: SkinProps; onShare(how: Share): void }) {
  const { data, actions } = props;
  const { player } = data;
  const track = player.track;
  const art = useArt(track?.album.imageUrl, data.demo);
  const spinning = player.isPlaying && track !== null;
  const smart = data.session !== null && track !== null && data.session.tracks.some((entry) => entry.track.id === track.id);
  const from = smart ? `, smart-shuffled from ${data.session!.sourceName}` : player.context?.name ? `, from ${player.context.name}` : "";
  const volume = player.device === null || !player.device.supportsVolume ? null : player.device.volumePercent;
  return (
    <section className={`k-stage k-stk ${spinning ? "k-on" : ""}`}>
      {player.duck.active ? <Duck duck={player.duck} /> : null}
      <div className="k-np">
        <Turntable player={player} art={track === null ? null : art} />
        <div className="k-meta">
          <div className="k-kicker">
            <span>{track === null ? "the turntable is quiet" : `${spinning ? "now spinning" : "paused"}${from} ↓`}</span>
            {player.device !== null ? (
              <span className="k-device">
                <Icon name="speaker" size={13} /> {player.device.name}
              </span>
            ) : null}
          </div>
          {track === null ? (
            <>
              <span className="k-tape k-title">nothing spinning yet</span>
              <p className="k-empty-note">
                pick a mixtape from the shelf and press <kbd>p</kbd>, or tap play to pick up wherever Spotify left off.
              </p>
            </>
          ) : (
            <>
              <span className="k-tape k-title" title={track.name}>
                {track.name}
              </span>
              <div className="k-artist k-trunc">{artists(track)}</div>
              <div className="k-album k-trunc">
                {track.album.name}
                {track.album.year === null ? "" : ` · ${track.album.year}`}
              </div>
              <Caterpillar player={player} onSeek={actions.seek} />
            </>
          )}
          {player.status === "no-device" ? (
            <NoDevice onLaunch={actions.launchApp} />
          ) : (
            <div className="k-controls">
              <button type="button" className="k-candy" style={vars({ "--fill": "var(--sky)" })} onClick={actions.previous} aria-label="Previous song">
                <Icon name="prev" />
              </button>
              <button type="button" className="k-candy k-big" style={vars({ "--fill": "var(--pink)" })} onClick={actions.toggle} aria-label={player.isPlaying ? "Pause" : "Play"}>
                <Icon name={player.isPlaying ? "pause" : "play"} />
              </button>
              <button type="button" className="k-candy" style={vars({ "--fill": "var(--sky)" })} onClick={actions.next} aria-label="Next song">
                <Icon name="next" />
              </button>
              <button
                type="button"
                className={`k-candy ${player.liked ? "k-liked" : ""}`}
                style={vars({ "--fill": "var(--lilac)" })}
                onClick={actions.like}
                disabled={track === null}
                aria-pressed={player.liked === true}
                aria-label={player.liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
              >
                <Icon name="heart" />
              </button>
              <VolumeDial volume={volume} onChange={actions.setVolume} />
            </div>
          )}
          {track === null ? null : (
            <div className="k-shares">
              {SHARES.map((share) => (
                <button key={share.how} type="button" className="k-chip" style={vars({ "--fill": share.fill, "--tilt": `${share.tilt}deg` })} onClick={() => onShare(share.how)}>
                  <Icon name={share.icon} /> {share.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="k-jelly">
        <JellyBand player={player} />
        <span className="k-jelly-note">
          {spinning ? "the jelly band" : "the jelly band is napping, z z"} <Doodle kind="note" fill="var(--butter)" size={14} className="k-inline" />
        </span>
      </div>
    </section>
  );
}

function Ingredient({ on, name, note, fill, onToggle, children }: { on: boolean; name: string; note: string; fill: string; onToggle(): void; children?: React.ReactNode }) {
  return (
    <div className={`k-ing ${children ? "k-extra" : ""}`}>
      <button type="button" className="k-ing-toggle" role="checkbox" aria-checked={on} onClick={onToggle}>
        <span className={`k-check ${on ? "k-yes" : ""}`} style={stuck(name, 3, fill)}>
          <Tick />
        </span>
        <span>
          <span className="k-ing-name">{name}</span>
          <span className="k-ing-note">{note}</span>
        </span>
      </button>
      {children}
    </div>
  );
}

function Recipe({ props, onShake, onLeave }: { props: SkinProps; onShake(): void; onLeave(): void }) {
  const { data, actions } = props;
  const options = data.shuffleOptions;
  const session = data.session;
  const source = data.selection.playlist?.readable ? data.selection.playlist.name : "Liked Songs";
  const days = (direction: 1 | -1) => actions.setShuffleOptions({ freshDays: stepDays(options.freshDays, direction) });
  return (
    <section className="k-recipe k-stk">
      <span className="k-tape">smart shuffle</span>
      <div className="k-recipe-for">
        a mixtape recipe for <b>{source}</b>
      </div>
      <Ingredient on={options.spread} name="Spread it out" note="no artist or album twice in a row" fill="var(--mint)" onToggle={() => actions.setShuffleOptions({ spread: !options.spread })} />
      <Ingredient on={options.fresh} name="Keep it fresh" note="favor songs you haven't heard lately" fill="var(--butter)" onToggle={() => actions.setShuffleOptions({ fresh: !options.fresh })}>
        <span className="k-days">
          <button type="button" onClick={() => days(-1)} disabled={!options.fresh} aria-label="Fewer days">
            −
          </button>
          <b>{options.freshDays} days</b>
          <button type="button" onClick={() => days(1)} disabled={!options.fresh} aria-label="More days">
            +
          </button>
        </span>
      </Ingredient>
      <Ingredient on={options.noSkips} name="No skips" note="leave out songs you usually skip" fill="var(--pink)" onToggle={() => actions.setShuffleOptions({ noSkips: !options.noSkips })} />
      <label className="k-bubble">
        <input
          value={options.vibe ?? ""}
          placeholder="what's the vibe?"
          aria-label="Describe the vibe"
          maxLength={300}
          onChange={(event) => actions.setShuffleOptions({ vibe: event.target.value === "" ? null : event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") onShake();
            else if (event.key === "Escape") onLeave();
            else return;
            event.stopPropagation();
          }}
        />
      </label>
      <button type="button" className={`k-shake ${data.shuffling ? "k-busy" : ""}`} onClick={onShake} disabled={data.shuffling}>
        <Doodle kind="sparkle" fill="var(--butter)" size={22} />
        {data.shuffling ? "Shaking…" : "Shake it up!"}
      </button>
      <div className="k-session">
        {data.shuffling
          ? "shaking the jar…"
          : session === null
            ? "pick your ingredients, then shake it"
            : `${session.tracks.length} songs from ${session.sourceName} · ${session.dropped} skip-prone ${session.dropped === 1 ? "song" : "songs"} left out${session.vibeError === null ? "" : " · the vibe didn't stick, so this one's a plain smart shuffle"}`}
      </div>
    </section>
  );
}

function UpNext({ props }: { props: SkinProps }) {
  const upcoming = upNext(props.data).slice(0, 6);
  return (
    <section className="k-upnext k-stk">
      <span className="k-tape">up next</span>
      {upcoming.length === 0 ? (
        <div className="k-next-empty">nothing queued yet. shake something up and the next songs land here, each with a little note on why.</div>
      ) : (
        <div className="k-next-list">
          {upcoming.map((entry, index) => (
            <div key={`${entry.track.id}-${index}`} className="k-next" style={stuck(entry.track.id, 1.2)}>
              <span className="k-next-n" style={vars({ "--fill": fillOf(entry.track.name) })}>
                {index + 1}
              </span>
              <span className="k-label-text">
                <span className="k-next-name k-trunc">
                  {entry.track.name}
                  <small>{artists(entry.track)}</small>
                </span>
                {entry.reason === null ? null : <span className="k-next-why k-trunc">↳ {entry.reason}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PastelPage(props: SkinProps) {
  const { data, actions, palette } = props;
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("songs");
  const [cursor, setCursor] = useState<number | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [status, setStatus] = useState<Finder["status"]>("idle");
  const [summon, setSummon] = useState(0);
  const playlists = useMemo(() => ordered(data.playlists), [data.playlists]);
  const selected = playlists.findIndex((entry) => entry.id === data.selection.playlist?.id);
  const track = data.player.track;

  useEffect(() => {
    if (note === null) return;
    const timer = setTimeout(() => setNote(null), 2400);
    return () => clearTimeout(timer);
  }, [note]);

  useEffect(() => {
    if (summon > 0) input.current?.focus();
  }, [summon, tab]);

  const say = (text: string, bad = false) => setNote({ id: Date.now(), text, bad });
  const rest = () => root.current?.focus({ preventScroll: true });

  const pick = (index: number) => {
    const playlist = playlists[index];
    if (playlist === undefined) return;
    setCursor(null);
    actions.select(playlist.id);
    setTab("songs");
    if (!playlist.readable) say(`${playlist.name} is play only. press p to play it`);
  };

  const playList = (playlist: Playlist | null | undefined) => {
    if (!playlist) return;
    actions.playPlaylist(playlist);
    say(`playing ${playlist.name}`);
  };

  const shake = () => {
    if (data.shuffling) return;
    const chosen = data.selection.playlist;
    const sourceId = chosen?.readable ? chosen.id : LIKED_ID;
    actions.smartShuffle({ sourceId });
    say(`shaking up ${chosen?.readable ? chosen.name : "Liked Songs"}…`);
  };

  const share = (how: Share) => {
    if (track === null) return say("nothing is spinning to share", true);
    if (how === "link") actions.copyLink(track);
    if (how === "uri") actions.copyUri(track);
    if (how === "thread") actions.mention(track);
    if (how === "card") actions.shareCard(track, root.current);
  };

  const openTab = (next: Tab) => {
    setTab(next);
    if (next === "search") setSummon((value) => value + 1);
  };

  const finder: Finder = {
    input,
    query,
    result,
    status,
    setQuery,
    run: () => {
      const text = query.trim();
      if (text === "") return;
      setStatus("busy");
      actions.search(text).then(
        (found) => {
          setResult(found);
          setStatus("idle");
        },
        () => setStatus("error"),
      );
    },
    leave: () => {
      input.current?.blur();
      rest();
    },
  };

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (transportKey(event, data, actions)) return true;
      const at = cursor ?? selected;
      switch (event.key) {
        case "j":
          setCursor(Math.min(playlists.length - 1, at + 1));
          return true;
        case "k":
          setCursor(Math.max(0, at - 1));
          return true;
        case "Enter":
          if (cursor === null) return false;
          pick(cursor);
          return true;
        case "p":
          playList(cursor === null ? data.selection.playlist : playlists[cursor]);
          return true;
        case "n":
          actions.next();
          return true;
        case "b":
          actions.previous();
          return true;
        case "h":
          if (track !== null) actions.like();
          return true;
        case "s":
          shake();
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
        case "/":
          openTab("search");
          return true;
        case "Escape":
          if (cursor === null) return false;
          setCursor(null);
          return true;
        default: {
          const index = Number(event.key) - 1;
          if (!Number.isInteger(index) || TABS[index] === undefined) return false;
          openTab(TABS[index]!.id);
          return true;
        }
      }
    },
    [data, actions, cursor, selected, playlists, track],
  );
  useKeys(root, onKey);

  return (
    <div ref={root} tabIndex={0} className={`sp-pastel s-${toneOf(palette)}`} onMouseDown={(event) => !isTyping(event.target) && event.currentTarget.focus({ preventScroll: true })}>
      <div className="k-scroll">
        <div className="k-grid">
          <Shelf
            props={props}
            playlists={playlists}
            cursor={cursor}
            onPick={(index) => {
              pick(index);
              rest();
            }}
          />
          <Stage props={props} onShare={share} />
          <div className="k-side">
            <Recipe props={props} onShake={shake} onLeave={rest} />
            <UpNext props={props} />
          </div>
          <Notebook props={props} tab={tab} onTab={openTab} finder={finder} />
        </div>
      </div>
      {note === null ? null : (
        <div key={note.id} className={`k-toast k-stk ${note.bad ? "k-bad" : ""}`} role="status">
          {note.text}
        </div>
      )}
    </div>
  );
}

function PastelMini({ data, actions, palette, close }: MiniProps) {
  const root = useRef<HTMLDivElement>(null);
  const { player } = data;
  const track = player.track;
  const art = useArt(track?.album.imageUrl, data.demo);
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (transportKey(event, data, actions)) return true;
      if (event.key === "n") actions.next();
      else if (event.key === "b") actions.previous();
      else if (event.key === "h" && track !== null) actions.like();
      else if (event.key === "y" && track !== null) actions.copyLink(track);
      else if (event.key === "@" && track !== null) actions.mention(track);
      else return false;
      return true;
    },
    [data, actions, track],
  );
  useKeys(root, onKey);
  return (
    <div ref={root} tabIndex={0} className={`sp-pastel s-${toneOf(palette)} k-mini ${player.isPlaying && track !== null ? "k-on" : ""}`}>
      <div className="k-mini-disc" data-sp-drag="" title="Drag to move">
        <MiniDisc art={track === null ? null : art} />
      </div>
      <div className="k-mini-body">
        <button type="button" className="k-tape k-mini-title" onClick={actions.openPage} title="Open the Spotify page">
          {track?.name ?? "nothing spinning"}
        </button>
        <span className="k-mini-artist k-trunc">{track === null ? "press space to play" : `${artists(track)} · ${track.album.name}`}</span>
      </div>
      <div className="k-mini-jelly">
        <JellyBand player={player} mini />
      </div>
      <div className="k-mini-ctl">
        <button type="button" className="k-candy" style={vars({ "--fill": "var(--sky)" })} onClick={actions.previous} aria-label="Previous song">
          <Icon name="prev" />
        </button>
        <button type="button" className="k-candy k-big" style={vars({ "--fill": "var(--pink)" })} onClick={actions.toggle} aria-label={player.isPlaying ? "Pause" : "Play"}>
          <Icon name={player.isPlaying ? "pause" : "play"} />
        </button>
        <button type="button" className="k-candy" style={vars({ "--fill": "var(--sky)" })} onClick={actions.next} aria-label="Next song">
          <Icon name="next" />
        </button>
        <button type="button" className={`k-candy ${player.liked ? "k-liked" : ""}`} style={vars({ "--fill": "var(--lilac)" })} onClick={actions.like} disabled={track === null} aria-label={player.liked ? "Remove from Liked Songs" : "Save to Liked Songs"}>
          <Icon name="heart" />
        </button>
        <button type="button" className="k-close" onClick={close} aria-label="Close the mini player">
          ×
        </button>
      </div>
      {player.duck.active ? <span className="k-mini-shh k-stk">shh, an agent needs you</span> : null}
    </div>
  );
}

export const pastelSkin: Skin = { id: "pastel", Page: PastelPage, Mini: PastelMini };
