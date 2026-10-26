# bb-plugin-spotify

Spotify inside bb: a mini player on a hotkey, your playlists, a smarter
shuffle, sharing into threads, a private listening history, and music that
steps aside when an agent needs you. Pick one of four looks, each with its own
palettes.

## Set up

Spotify asks every listener to register a free app of their own, and its
developer mode only works for Premium accounts.

1. Open the [Spotify developer dashboard](https://developer.spotify.com/dashboard),
   create an app, and choose **Web API**.
2. Add the redirect URI that the plugin's settings page shows, for example
   `http://127.0.0.1:38886/api/v1/plugins/spotify/http/callback`.
3. Paste the app's **Client ID** into the plugin's settings.
4. Click **Connect Spotify** and approve access in the page that opens.

Sign-in uses PKCE, so there is no client secret. Tokens stay in this plugin's
database on the bb server. Until you connect, **Preview the looks with sample
songs** shows every look with sample data.

## Use it

**Play**

- Open **Spotify** in the sidebar. The page controls the Spotify app on this
  Mac or any device signed in to your account; the header's device menu moves
  playback and can open the Spotify app.
- Browse playlists and Liked Songs, play a playlist or any song in it, seek,
  change the volume, save to Liked Songs, and search Spotify.
- Spotify only lists the songs of playlists you own or collaborate on.
  Followed playlists show as **play only**.

**Mini player**

- `⌘⇧S` (Ctrl+Shift+S elsewhere) shows or hides a small player that floats over
  any thread. Drag it by its handle; `Esc` closes it. The sidebar footer has
  the same toggle. Rebind it in Settings → Keyboard.
- The quick palette (`⌘⇧P`) also has **Spotify: play or pause**, **next
  song**, **previous song**, **save or remove the song**, and **copy the song
  link**. Each can get its own shortcut.

**Smart shuffle**

Spotify's recommendation and audio-feature APIs are closed to new apps, so the
plugin shuffles from your own library and history:

- **Spread**: no artist or album twice in a row.
- **Fresh**: favors songs you haven't played in N days (30 by default).
- **No skips**: leaves out songs you skip most of the time.
- **Vibe**: describe a shape such as "start mellow, end euphoric" and the
  local `claude` CLI orders up to 250 songs to match, with a short note on
  each. If Claude fails, you get a regular smart shuffle and a notice.

A shuffle plays up to 100 songs in order with Spotify's own shuffle off, and
the up-next list shows why each song is there.

**Share**

- Copy the song's link or `spotify:` URI, or make a share card image in the
  current look's colors.
- **@ thread** puts the song into the open thread's composer as a mention; the
  agent receives its title, artists, album, and link. In any composer you can
  also type `@` and pick from the song playing now, recent plays, or a Spotify
  search, or use **Mention the Spotify song** in the `+` menu.

**When an agent needs you**

When a thread asks for your approval, the plugin lowers the volume (20% by
default) or pauses, and restores it once no thread is waiting. It leaves the
volume alone if you changed it in the meantime.

**History and stats**

While bb runs, the plugin records what you play, how long you listened, and
what you skipped, and fills gaps every 20 minutes from Spotify's recently
played list. The stats view shows listening time for the week and month, top
artists and songs, listening by hour, skip rate, and playlists you haven't
opened in a month.

**Launcher**

With the [Launcher](../bb-plugin-launcher) plugin, `⌘K` finds Spotify
playlists, songs, artists, and albums, and runs play, pause, next, previous,
and save. `⌘K` on a result offers **Add to queue** or **Smart shuffle**.

## Looks

| Look | Palettes | Keys |
| --- | --- | --- |
| Console (default) | Cape, Phosphor, Glacier, Daylight | Vim-style: `j`/`k`, `⏎`, `h`/`l`, `yy`, `@`, `R`, `/`, `:` commands, `?` for help |
| Receiver | Silver, Midnight, Brass | `←`/`→` tune playlists, `1`–`6` presets |
| Liner Notes | Vermilion, Cobalt, Night Edition, Riso | `j`/`k` contents, `s` reshuffle |
| Sticker Book | Sherbet, Matcha, Lavender Dusk, Peach | `j`/`k` playlists, `s` shake it up |

Every look also takes `space` (play or pause), `+`/`-` (volume), and `,`/`.`
(seek 10 seconds). Switch looks and palettes from the page header or the plugin
settings. The visualizers are animated from the song's position, not its audio.

Console fits short or narrow windows: below 720px tall or 900px wide it trades
the spectrum for a compact now-playing strip with clickable controls, moves Up
Next into a `6` tab when its column doesn't fit, and under 620px wide shows a
single pane with a `1` playlists tab.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Spotify app Client ID | (empty) | The app you registered for sign-in |
| Look | Console | Which of the four looks to show |
| Palette per look | the first one | Colors for each look |
| When an agent thread needs your approval | Lower the volume | Lower, pause, or do nothing |
| Lowered volume (%) | 20 | Volume while ducked |
| Keep a listening history | on | Powers stats and the Fresh and No-skips shuffles |
| Model for vibe shuffles | `sonnet` | Passed to `claude --model` |
| claude CLI path | `claude` | Binary used for vibe shuffles |

## How it works

The server talks to the Spotify Web API with PKCE tokens it refreshes on its
own. A background service polls the player every 4 seconds while music plays
(10 when paused, 15 with no device) and publishes changes to open pages over
realtime; the pages interpolate progress between polls. Plays, a track cache,
and playlist caches keyed by snapshot live in the plugin's SQLite database.
Cover art is fetched by the server from Spotify's image CDN only.

## Develop

```
npm install
npm run check          # typecheck, tests, build
bb plugin install .    # register this checkout in bb
bb plugin dev          # rebuild and reload on save
```

Tests use an in-process fake of the Spotify API; nothing leaves the machine.
`/plugins/spotify/spotify/preview/<look>/<palette>` renders any look with
sample songs.
