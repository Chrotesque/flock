# flock

Write each platform's text, point it at a video file, and schedule that video out to
YouTube, Instagram, TikTok and Facebook — each with its own release day and time.

Every platform reads differently: a link that works on one gets a post buried on
another, a hashtag style that looks fine here looks broken there. So you compose for
them one at a time, switching between them with a row of pills — YouTube and Facebook
take a title and a description, Instagram and TikTok are caption-only. On top of that
each platform can carry a list of "replace X with Y" rules for the edits you would
otherwise make every single time. flock shows you exactly what each platform will
receive before anything is sent.

On confirmation the video is uploaded to a PocketBase instance on the NAS, along
with one scheduled entry per platform. The idea is that publishing happens later
from the NAS, so this machine does not need to be online at release time.

**YouTube is connected; the other three are not.** A worker process picks up
scheduled YouTube releases and uploads them for real — see *The worker* below.
Instagram, TikTok and Facebook publish nowhere, and their per-platform options are
invented placeholders that exist so the interface can be judged before those APIs
are wired up. Uploads to the NAS, the schedules and the adaptation rules are real
for every platform.

## Requirements

- Node 22+ and pnpm
- A PocketBase instance reachable from this machine (flock uses its own, on port
  8091 — not the one cortex uses)

## Setup

Put the PocketBase superuser details in `scripts/.pb-creds.json`:

```json
{ "url": "http://<host>:8091", "email": "you@example.com", "password": "…" }
```

Create the collections (safe to re-run):

```bash
pnpm setup-pb
```

Point the app at the same instance in `.env`:

```bash
PUBLIC_POCKETBASE_URL=http://<host>:8091
```

Then:

```bash
pnpm install
```

## Running

```bash
pnpm dev
```

`pnpm build` produces a static site in `build/`, intended to be served by
PocketBase itself.

To publish it:

```bash
pnpm deploy
```

That builds and mirrors `build/` into flock's PocketBase at
`\\nas\appdata\pocketbase_flock\pb_public`, which needs write access to that
share. `pnpm deploy:dry` shows what would change without touching anything.
PocketBase serves the files straight from disk, so there is no restart.

## Two ways to give flock a video

**Upload it in the browser.** Drop a file on the picker. Simple, and fine up to a
few hundred megabytes — but it is one HTTP request with no resume, and PocketBase
caps a stored file at 5 GB.

**Or drop it on the NAS.** Set a *watch folder* in Settings, copy videos into it
over SMB, and the compose screen lists what is there. Picking one references the
file where it lies rather than transferring it, so nothing goes through the
browser and the 5 GB cap does not apply. This is the only route for a large
video, and the transfer is a normal file copy you can resume or retry.

The listing comes from the worker, which scans the folder each time it polls — so
nothing appears there until the worker has run at least once, and the compose
screen shows when it last looked.

## The worker

Confirming an upload only queues it. A separate process does the publishing, and
it has to keep running when no browser is open — so it belongs on the NAS beside
PocketBase, not in the app. Today it handles YouTube only.

It also scans the watch folder and copies finished videos into their NAS
destination, both of which happen regardless of which platforms a job is bound
for.

**vidIQ title scoring** runs through the worker too, because vidIQ has no REST
API — an MCP server is their whole public surface, and its key is a credential.
Generate one at `app.vidiq.com/account/settings/mcp`, put it in the worker config
as `vidiqKey`, then check it without spending credits:

```bash
pnpm worker:vidiq
```

The compose screen then shows a **Score title** button beside the YouTube title.
It scores on demand rather than as you type, since each call costs credits.

vidIQ scores titles and thumbnails only. There is no tag rating in their API,
whatever the browser extension shows on YouTube's own pages.

It needs a Google OAuth client. In the [Google Cloud console](https://console.cloud.google.com):

1. Create a project and enable **YouTube Data API v3** under *APIs & Services →
   Library*.
2. Under *APIs & Services → OAuth consent screen*, set it up as **External** and
   add the Google account that owns the channel as a **test user**.
3. Under *Credentials*, create an **OAuth client ID** of type **Desktop app**.
   That gives you a client ID and client secret.

Copy the example config and paste those two values in:

```bash
cp worker/.worker-config.example.json worker/.worker-config.json
```

Then authorise once — this opens a consent URL and writes the refresh token back
into that file:

```bash
pnpm worker:auth
```

That asks for **upload permission plus read-only access** to the channel. Upload
is all `videos.insert` needs; read-only is what the Analytics screen's stats
need, and it cannot change anything. An authorisation made before Analytics
existed has read the channel fine too, so re-run this only if the worker reports
a scope error. The one exception is the playlist box on the compose screen:
putting a video in a playlist requires Google's broader
`youtube` scope, which the consent screen describes as permanently deleting
videos, comments and captions. If you want that to work, authorise with:

```bash
pnpm worker:auth --with-playlists
```

Otherwise the playlist is skipped and the worker says so in its log.

Check the queue without uploading anything:

```bash
pnpm worker:dry
```

Run it:

```bash
pnpm worker
```

If it starts with *Cannot reach http://…:8091*, the NAS or the Tailscale link to
it is not up yet. The worker keeps retrying for five minutes before giving up, so
it can be started before the connection is.

`pnpm worker:once` does a single pass and exits, which is the easier one to watch
while testing. `pnpm worker:stats` runs one stats poll on its own, which is the
quickest way to confirm the read scope works. The config file holds a client
secret and is gitignored.

The stats poll reads the newest fifty videos every 30 seconds by default, which
is about a third of the daily API quota that uploads also draw on. `statsSeconds`,
`statsVideos` and `statsBudget` in the worker config adjust it; when a day's
polling reaches the budget it pauses until Google's reset at midnight Pacific,
so it can never leave an upload without quota.

**One limit worth knowing.** While the OAuth consent screen sits in *Testing*,
Google expires the refresh token after **7 days**, so you would be re-running
`pnpm worker:auth` every week. Publishing the consent screen stops that.

Google's docs also say uploads from an API project that has not passed their
compliance audit are locked to private. That was tested here and does not
happen — private, scheduled-public and immediately-public all worked. The
worker still reports the locked case if it ever appears, since the behaviour
being relied on is not the documented one.

## Using it

**Name the browser first.** Nothing can be uploaded or changed until you do — the
Log records which machine made every change, and it cannot do that for an unnamed
browser. flock asks on first open. The name is unique across your machines and
cannot be changed afterwards, so pick one you will recognise later. Each browser
needs its own; the name is stored locally, so opening flock from a different
address counts as a different browser.

**Upload** is a three-step flow. flock opens on Analytics; Upload lives at `/upload`.
Tick the platforms you want on the right and choose a video underneath them. With
YouTube ticked, three more boxes appear below it: a thumbnail (optional; JPEG,
PNG, GIF or WebP up to 2 MB), a paid-promotion checkbox that is off on every new
upload, and a playlist dropdown listing the channel's own playlists as the worker
last read them. The video, thumbnail and playlist boxes fold to a single line with
a green check once they are done; click the line to open one again. Then
work along the row of platform pills writing the text for each one — a title and a
description for YouTube and Facebook, a caption for Instagram and TikTok. Continue
unlocks once every ticked platform has been written for. Clicking a platform in the
right-hand list opens its options and a preview of its adapted text. Next comes a
week calendar showing a card per platform: drag a card to another day or hour to move
that release, or use the exact date and time fields underneath. The final screen
plays the video beside what each platform gets and when; confirming is the tick
button, pressed once and then again within two seconds while it shows "!!!", and
the copy to the NAS starts there.

**Calendar** shows every release ever scheduled on a week grid. Things already
released — or whose slot has passed — are greyed out, and there is a toggle to hide
them. It opens read-only; press *Edit* twice within two seconds to unlock it, then
drag an upcoming release to another day or hour. Released and past-due posts stay
locked either way.

**Log** lists every change — uploads, calendar moves and settings — with the date,
time and the machine that made it. Filter by category, search, or click a device
tag to see only that machine. It cannot be edited or cleared.

**Analytics** shows the newest fifty videos on the channel as YouTube reports
them, refreshed every 30 seconds while the worker runs: views, likes and
comments in a row per video, and everything else the API returns underneath
when you click one. The buttons on the left narrow it to Shorts (under three
minutes), long form, live streams, or whatever fits none of those; tick any
combination, and untick *Hide unlisted* or *Hide private* to see those too —
every choice is remembered. A total row at the top adds up whatever is shown. A
counter that has moved since you opened the page turns green and shows the
change beside it, as in `940 (+9)`; Refresh resets those markers. It needs
the worker running. Below that it lists what is currently stored on the NAS,
which is where you check that an upload actually landed.

**Settings** has three parts. *Storage and defaults* holds the NAS folders a
finished video is copied into (the filled circle marks the default) and shows this
browser's device name. *Templates* holds reusable blocks of text: on the upload
screen they appear under the details, and typing a template's name in braces —
`{outro}` — swaps it in as you write.

Below those, each platform has its display order, its release timing, its default
publish options, and its adaptation rules. YouTube's defaults include the language
spoken in the video and the language of the title and description, English (US)
unless changed. Release timing is either one fixed time
for that platform, or *Profiles* — named patterns like "Horror", each with an
optional time and an optional set of weekdays. Choosing Profiles adds a Profiles
tab to that platform, and the profiles you define there appear as buttons on the
schedule step: pick one and it fills in the next matching day and the time.

Adaptation rules run top to bottom and chain, so order matters; there is a box at
the bottom to try them against sample text. Unticking a platform removes it from
new uploads entirely — it stops being listed on the compose screen, though its
defaults and rules are kept.

## Where things live

Videos and schedules live in PocketBase on the NAS, in the collections
`upload_jobs`, `upload_targets`, `platform_settings`, `app_settings`,
`activity_log`, `devices` and `video_stats`. The chosen destination is recorded on each upload, so
changing the destination list later never redirects something already queued —
and the file is copied there, never moved. Nothing is written until you confirm an
upload; the only thing kept in the browser is this device's name.
