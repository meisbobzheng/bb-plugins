import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIKED_ID } from "../../../contract";
import { artists } from "../../format";
import { isTyping, transportKey, useKeys } from "../../keys";
import type { MiniProps, Skin, SkinProps } from "../../model";
import { Cassette, HistoryCard, Processor, SearchCard, StatsCard, TapeCard, useSearch } from "./deck";
import { KNOB, knobOf, knobPatch, knobText, MODES, stationsOf, wrap, type KnobMode, type Mode } from "./dial";
import { Dial, Group, idleText, Key, LiveClock, Meters, Rotary, Screws, Spectrum, Unit, Vfd, VolumeKnob } from "./panel";
import "./receiver.css";

type Share = "link" | "uri" | "thread" | "card";

const DEFAULT_VIBE = "start mellow, build to hype";

const LEGEND: [string, string][] = [
  ["← →", "Tune"],
  ["⏎", "Play station"],
  ["1–6", "Presets"],
  ["Space", "Play · Pause"],
  ["N P", "Next · Prev"],
  [", .", "Seek"],
  ["+ −", "Volume"],
  ["S", "Shuffle knob"],
  ["⇧S", "Run shuffle"],
  ["F", "Save"],
  ["Y ⇧Y", "Link · URI"],
  ["@", "Thread"],
  ["C", "Card"],
  ["M", "Mode"],
  ["/", "Search"],
  ["⌘⇧S", "Mini player"],
];

function Device({ props }: { props: SkinProps }) {
  const { data, actions } = props;
  const { player } = data;
  if (player.status === "no-device")
    return (
      <div className="r-device r-engrave">
        <span className="r-led r-blink" />
        <span className="r-alert">No device</span>
        <Key className="r-small" onClick={actions.launchApp}>
          Open Spotify
        </Key>
      </div>
    );
  return (
    <div className="r-device r-engrave">
      <span className={`r-led ${player.isPlaying ? "" : "r-off"}`} />
      {data.demo ? "Preview" : "Spotify Connect"} · {player.device?.name ?? "Standby"}
    </div>
  );
}

function ReceiverPage(props: SkinProps) {
  const { data, actions, palette } = props;
  const { player, selection } = data;
  const options = data.shuffleOptions;
  const root = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const wantSearch = useRef(false);
  const vibe = useRef(DEFAULT_VIBE);
  const [mode, setMode] = useState<Mode>("tracks");
  const [flash, setFlash] = useState<string | null>(null);
  const search = useSearch(actions);
  const stations = useMemo(() => stationsOf(data.playlists), [data.playlists]);
  const tuned = stations.findIndex((entry) => entry.id === selection.playlist?.id);
  const knob = knobOf(options);
  const track = player.track;
  const source = selection.playlist?.readable ? selection.playlist : null;
  if (options.vibe) vibe.current = options.vibe;

  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    if (!wantSearch.current || mode !== "search") return;
    wantSearch.current = false;
    searchInput.current?.focus();
  }, [mode]);

  const tune = (index: number) => {
    const station = stations[wrap(index, stations.length)];
    if (station === undefined) return;
    actions.select(station.id);
    setMode("tracks");
    setFlash(`Tuned ▸ ${station.name} · ${station.readable ? `${station.trackCount.toLocaleString()} tracks` : "play only"}`);
  };

  const playTuned = () => {
    if (selection.playlist === null) return setFlash("Tune a station first");
    actions.playPlaylist(selection.playlist);
    setFlash(`Playing ▸ ${selection.playlist.name}`);
  };

  const turn = (next: KnobMode) => {
    actions.setShuffleOptions(knobPatch(next, vibe.current));
    setFlash(knobText(next, options, vibe.current));
  };

  const runShuffle = () => {
    actions.smartShuffle({ sourceId: source?.id ?? LIKED_ID });
    setFlash(`Smart shuffle ▸ ${source?.name ?? "Liked Songs"}`);
  };

  const share = (how: Share) => {
    if (track === null) return setFlash("Nothing on air to share");
    if (how === "link") actions.copyLink(track);
    else if (how === "uri") actions.copyUri(track);
    else if (how === "thread") actions.mention(track);
    else actions.shareCard(track, root.current);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setFlash(`Mode ▸ ${next}`);
  };

  const focusSearch = () => {
    if (searchInput.current !== null) return searchInput.current.focus();
    wantSearch.current = true;
    setMode("search");
  };

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (transportKey(event, data, actions)) return true;
      if (/^[1-6]$/.test(event.key)) {
        if (Number(event.key) <= stations.length) tune(Number(event.key) - 1);
        return true;
      }
      switch (event.key) {
        case "ArrowRight":
          tune(tuned + 1);
          return true;
        case "ArrowLeft":
          tune(tuned < 0 ? 0 : tuned - 1);
          return true;
        case "Enter":
          playTuned();
          return true;
        case "n":
          actions.next();
          return true;
        case "p":
          actions.previous();
          return true;
        case "s":
          turn(KNOB[(KNOB.indexOf(knob) + 1) % KNOB.length]!);
          return true;
        case "S":
          runShuffle();
          return true;
        case "f":
          actions.like();
          return true;
        case "y":
          share("link");
          return true;
        case "Y":
          share("uri");
          return true;
        case "@":
          share("thread");
          return true;
        case "c":
          share("card");
          return true;
        case "m":
          switchMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]!);
          return true;
        case "/":
          focusSearch();
          return true;
        default:
          return false;
      }
    },
    [data, actions, stations, mode],
  );
  useKeys(root, onKey);

  return (
    <div ref={root} tabIndex={0} className={`sp-receiver r-page r-${palette}`} onMouseDown={(event) => !isTyping(event.target) && event.currentTarget.focus({ preventScroll: true })}>
      <div className="r-rack">
        <Unit>
          <div className="r-face">
            <Screws />
            <header className="r-head">
              <div className="r-brand r-engrave">
                bb·FM<small>SR-1 Stereo Receiver</small>
              </div>
              <Device props={props} />
            </header>
            <div className="r-top">
              <Vfd data={data} knob={knob} flash={flash} onSeek={actions.seek} onRepeat={actions.cycleRepeat} />
              <Meters player={player} />
            </div>
            <div className="r-lower">
              <Dial stations={stations} selectedId={selection.playlist?.id ?? null} playingUri={player.context?.uri ?? null} loading={data.playlists === null} onTune={tune} />
              <div className="r-controls">
                <Group label="Presets">
                  {stations.slice(0, 6).map((station, index) => (
                    <Key key={station.id} pip lit={index === tuned} className="r-preset" onClick={() => tune(index)} title={station.name}>
                      {index + 1}
                    </Key>
                  ))}
                </Group>
                <Group label="Transport" className="r-transport">
                  <Key dark onClick={actions.previous} kbd="P" aria-label="Previous song">
                    ◀◀
                  </Key>
                  <Key dark onClick={actions.toggle} kbd="␣" aria-label={player.isPlaying ? "Pause" : "Play"}>
                    {player.isPlaying ? "❚❚" : "▶"}
                  </Key>
                  <Key dark onClick={actions.next} kbd="N" aria-label="Next song">
                    ▶▶
                  </Key>
                  <Key pip lit={Boolean(player.liked)} onClick={actions.like} kbd="F" disabled={track === null} title={player.liked ? "Remove from Liked Songs" : "Save to Liked Songs"}>
                    Save
                  </Key>
                </Group>
                <Group label="Share">
                  <Key pip onClick={() => share("link")} kbd="Y" disabled={track === null} title="Copy the song link">
                    Link
                  </Key>
                  <Key pip onClick={() => share("uri")} kbd="⇧Y" disabled={track === null} title="Copy the Spotify URI">
                    URI
                  </Key>
                  <Key pip onClick={() => share("thread")} kbd="@" disabled={track === null} title="Mention the song in the thread composer">
                    @Thread
                  </Key>
                  <Key pip onClick={() => share("card")} kbd="C" disabled={track === null} title="Copy a share card image">
                    Card
                  </Key>
                </Group>
              </div>
              <div className="r-knobs">
                <Rotary label="Shuffle" options={KNOB} value={knob} onChange={turn} />
                <VolumeKnob volume={player.device?.volumePercent ?? null} enabled={player.device?.supportsVolume ?? false} onChange={actions.setVolume} />
              </div>
            </div>
          </div>
        </Unit>
        <Unit>
          <Processor data={data} actions={actions} source={source?.name ?? "Liked Songs"} onRun={runShuffle} />
        </Unit>
        <Unit className="r-deck">
          <div className="r-face r-deck-face">
            <Screws />
            <div className="r-deck-side">
              <Cassette player={player} label={selection.playlist?.name ?? "Blank"} />
              <div className="r-deck-keys">
                <Group label="Deck">
                  <Key dark className="r-play" onClick={playTuned} kbd="⏎" disabled={selection.playlist === null}>
                    ▶ Play
                  </Key>
                </Group>
                <Rotary label="Mode" options={MODES} value={mode} onChange={switchMode} className="r-mode" />
              </div>
            </div>
            <div className="r-jcard">
              {mode === "tracks" ? <TapeCard data={data} actions={actions} onPlay={playTuned} /> : null}
              {mode === "stats" ? <StatsCard data={data} actions={actions} onTune={(id) => tune(stations.findIndex((entry) => entry.id === id))} /> : null}
              {mode === "history" ? <HistoryCard data={data} actions={actions} /> : null}
              {mode === "search" ? <SearchCard search={search} input={searchInput} actions={actions} onLeave={() => root.current?.focus()} /> : null}
            </div>
            <div className="r-legend r-engrave">
              {LEGEND.map(([keys, what]) => (
                <span key={keys}>
                  <b>{keys}</b>
                  {what}
                </span>
              ))}
            </div>
          </div>
        </Unit>
      </div>
    </div>
  );
}

function ReceiverMini({ data, actions, palette, close }: MiniProps) {
  const root = useRef<HTMLDivElement>(null);
  const { player } = data;
  const track = player.track;
  const idle = idleText(player);
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (transportKey(event, data, actions)) return true;
      if (event.key === "n") actions.next();
      else if (event.key === "p") actions.previous();
      else if (event.key === "f") actions.like();
      else if (event.key === "o") actions.openPage();
      else if (event.key === "y" && track !== null) actions.copyLink(track);
      else if (event.key === "@" && track !== null) actions.mention(track);
      else return false;
      return true;
    },
    [data, actions, track],
  );
  useKeys(root, onKey);
  return (
    <div ref={root} tabIndex={0} className={`sp-receiver r-mini r-${palette}`}>
      <div className="r-wood" data-sp-drag="" title="Drag to move" />
      <div className="r-face">
        <div className="r-glass r-vfd">
          <button type="button" className="r-mini-title" onClick={actions.openPage} title="Open the Spotify page">
            <span className="r-title r-glow">{track?.name ?? idle.title}</span>
            <span className="r-artist r-glow">
              {track === null ? idle.line : artists(track)}
              {track === null ? null : (
                <>
                  {" · "}
                  <LiveClock player={player} />
                </>
              )}
            </span>
          </button>
          <Spectrum player={player} bands={16} rows={6} />
        </div>
        <div className="r-keys">
          <Key dark onClick={actions.previous} aria-label="Previous song">
            ◀◀
          </Key>
          <Key dark onClick={actions.toggle} aria-label={player.isPlaying ? "Pause" : "Play"}>
            {player.isPlaying ? "❚❚" : "▶"}
          </Key>
          <Key dark onClick={actions.next} aria-label="Next song">
            ▶▶
          </Key>
          <Key lit={Boolean(player.liked)} className="r-heart" onClick={actions.like} disabled={track === null} aria-label={player.liked ? "Remove from Liked Songs" : "Save to Liked Songs"}>
            ♥
          </Key>
          <Key className="r-close" onClick={close} aria-label="Close the mini player">
            ×
          </Key>
        </div>
      </div>
      <div className="r-wood" data-sp-drag="" />
    </div>
  );
}

export const receiverSkin: Skin = { id: "receiver", Page: ReceiverPage, Mini: ReceiverMini };
