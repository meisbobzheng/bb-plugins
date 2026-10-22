import type { RefObject } from "react";
import { artists, daysAgo, hours, monthDay } from "../../format";
import type { SkinProps } from "../../model";
import { ago, peakHour, sentence } from "./edition";

export const MATTERS = ["notes", "stats", "history"] as const;
export type Matter = (typeof MATTERS)[number];

const TITLES: Record<Matter, string> = { notes: "Notes", stats: "Statistics", history: "History" };

function Notes({ data }: SkinProps) {
  const days = data.shuffleOptions.freshDays;
  return (
    <ol className="l-notes">
      <li>
        <sup>1</sup> <i>No artist or album twice in a row.</i> The deck is dealt so the same lead artist or album never plays back to back, and an artist from the last two songs waits a turn when it can.
      </li>
      <li>
        <sup>2</sup> <i>Favor songs I haven&rsquo;t heard.</i> Songs you haven&rsquo;t played in {days} days are weighted up, songs new to your history get a lift, and the up-next list says which is which.
      </li>
      <li>
        <sup>3</sup> <i>Skip songs I usually skip.</i> A song you skipped on three of every five plays, over at least three plays, is left out of the deck.
      </li>
      <li>
        <sup>4</sup> <i>Shape it like this.</i> A plain-English shape goes to the local Claude CLI, which orders the songs; Spotify&rsquo;s own recommendation and audio-feature APIs are closed to new apps.
      </li>
      <li>
        <sup>5</sup> <i>Followed playlists.</i> Spotify only lists the songs of playlists you own or collaborate on, so followed ones can be played but not read.
      </li>
      <li>
        <sup>6</sup> <i>History.</i> Plays are recorded while bb is running. The statistics and the forgotten playlists come from that record, not from Spotify.
      </li>
    </ol>
  );
}

function Figures({ data, actions }: SkinProps) {
  const stats = data.stats;
  if (stats === null) return <p className="l-quiet">Gathering the figures…</p>;
  if (stats.since === null) return <p className="l-quiet">No history yet. Liner Notes records what you play while bb is running; come back after a few songs.</p>;
  const loudest = Math.max(1, stats.topArtists[0]?.listenedMs ?? 0);
  const busiest = Math.max(1, ...stats.byHour);
  const peak = peakHour(stats.byHour);
  return (
    <div className="l-figures">
      <div>
        <h4>The figures</h4>
        <dl className="l-tally l-num">
          <dt>{hours(stats.listenedMs7)}</dt>
          <dd>this week</dd>
          <dt>{hours(stats.listenedMs30)}</dt>
          <dd>this month</dd>
          <dt>{stats.plays30.toLocaleString()}</dt>
          <dd>plays in 30 days</dd>
          <dt>{stats.skipRate30 === null ? "—" : `${Math.round(stats.skipRate30 * 100)}%`}</dt>
          <dd>skipped</dd>
        </dl>
        <p className="l-since">Kept since {monthDay(stats.since)}.</p>
      </div>
      <div>
        <h4>By the hour</h4>
        <div className="l-hours" aria-label="Listening by hour of day">
          {stats.byHour.map((value, hour) => (
            <i key={hour} className={value === busiest ? "l-peak" : ""} style={{ height: `${Math.max(2, (value / busiest) * 100)}%` }} title={`${hour}:00`} />
          ))}
        </div>
        <div className="l-hour-axis l-num">
          <span>0</span>
          <span>6</span>
          <span>12</span>
          <span>18</span>
          <span>23</span>
        </div>
        {peak !== null ? <p className="l-since">{sentence(`You listen most around ${peak}`)}</p> : null}
      </div>
      <div>
        <h4>Most played artists</h4>
        <ol className="l-ranked l-num">
          {stats.topArtists.slice(0, 6).map((artist, index) => (
            <li key={artist.name}>
              <span className="l-i">{index + 1}</span>
              <span className="l-nm">{artist.name}</span>
              <span className="l-d">{hours(artist.listenedMs)}</span>
              <i style={{ width: `calc((100% - 22px) * ${artist.listenedMs / loudest})` }} />
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h4>Most played songs</h4>
        <ol className="l-ranked l-num">
          {stats.topTracks.slice(0, 6).map((entry, index) => (
            <li key={entry.track.id} onClick={() => actions.playTrack(entry.track)} title="Play this song">
              <span className="l-i">{index + 1}</span>
              <span className="l-nm">
                {entry.track.name} <em>{artists(entry.track)}</em>
              </span>
              <span className="l-d">{entry.plays}×</span>
            </li>
          ))}
        </ol>
        {stats.forgotten.length > 0 ? (
          <>
            <h4 className="l-gap">Gathering dust</h4>
            <ul className="l-dust">
              {stats.forgotten.map((entry) => (
                <li key={entry.playlistId} onClick={() => actions.select(entry.playlistId)}>
                  <i>{entry.name}</i>, {entry.lastPlayedAt === null ? "never played here" : `last played ${daysAgo(entry.lastPlayedAt)}`}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}

function History({ data, actions }: SkinProps) {
  if (data.recent.length === 0) return <p className="l-quiet">No plays recorded yet. Liner Notes writes each song down as it finishes.</p>;
  const now = Date.now();
  return (
    <ol className="l-history l-num">
      {data.recent.map((play) => (
        <li key={`${play.track.id}-${play.startedAt}`} className={play.skipped ? "l-skipped" : ""} onClick={() => actions.playTrack(play.track)} title="Play this song">
          <span className="l-when">{ago(play.endedAt, now)}</span>
          <span className="l-nm">
            {play.track.name} <em>{artists(play.track)}</em>
          </span>
          {play.skipped ? <span className="l-skip">skipped</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function BackMatter({ matter, onMatter, anchor, ...props }: SkinProps & { matter: Matter; onMatter(matter: Matter): void; anchor: RefObject<HTMLElement | null> }) {
  return (
    <section ref={anchor} className="l-matter">
      <div className="l-matter-h">
        <h3>Back matter</h3>
        <nav>
          {MATTERS.map((name, index) => (
            <button key={name} type="button" className={name === matter ? "l-on" : ""} onClick={() => onMatter(name)} aria-pressed={name === matter}>
              {TITLES[name]}
              <kbd>{index + 1}</kbd>
            </button>
          ))}
        </nav>
      </div>
      {matter === "notes" ? <Notes {...props} /> : matter === "stats" ? <Figures {...props} /> : <History {...props} />}
    </section>
  );
}
