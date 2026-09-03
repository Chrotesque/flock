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

## The worker

Confirming an upload only queues it. A separate process does the publishing, and
it has to keep running when no browser is open — so it belongs on the NAS beside
PocketBase, not in the app. Today it handles YouTube only.

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

That asks for **upload permission only**, which is all `videos.insert` needs and
cannot read, edit or delete anything on the channel. The one exception is the
*Add to playlist* option: putting a video in a playlist requires Google's broader
`youtube` scope, which the consent screen describes as permanently deleting
videos, comments and captions. If you want that option to work, authorise with:

```bash
pnpm worker:auth --with-playlists
```

Otherwise the playlist field is skipped and the worker says so in its log.

Check the queue without uploading anything:

```bash
pnpm worker:dry
```

Run it:

```bash
pnpm worker
```

`pnpm worker:once` does a single pass and exits, which is the easier one to watch
while testing. The config file holds a client secret and is gitignored.

**Two limits worth knowing before the first upload.** Until the Google Cloud
project passes YouTube's API audit, every video it uploads is **locked to
private** and cannot be made public afterwards — you would have to re-upload
through the site. Request the audit from the API Compliance form when you want
real releases. Separately, while the OAuth consent screen sits in *Testing*, the
refresh token expires after **7 days**; publishing the consent screen stops that.

## Using it

**Name the browser first.** Nothing can be uploaded or changed until you do — the
Log records which machine made every change, and it cannot do that for an unnamed
browser. flock asks on first open. The name is unique across your machines and
cannot be changed afterwards, so pick one you will recognise later. Each browser
needs its own; the name is stored locally, so opening flock from a different
address counts as a different browser.

**Upload** is a three-step flow. flock opens on Analytics; Upload lives at `/upload`.
Tick the platforms you want on the right, pick a video file underneath them, then
work along the row of platform pills writing the text for each one — a title and a
description for YouTube and Facebook, a caption for Instagram and TikTok. Continue
unlocks once every ticked platform has been written for. Clicking a platform in the
right-hand list opens its options and a preview of its adapted text. Next comes a
week calendar showing a card per platform: drag a card to another day or hour to move
that release, or use the exact date and time fields underneath. The final screen
shows a still of the video with what each platform gets and when; confirming takes
two clicks, and the copy to the NAS starts there.

**Calendar** shows every release ever scheduled on a week grid. Things already
released — or whose slot has passed — are greyed out, and there is a toggle to hide
them. It opens read-only; press *Edit* twice within two seconds to unlock it, then
drag an upcoming release to another day or hour. Released and past-due posts stay
locked either way.

**Log** lists every change — uploads, calendar moves and settings — with the date,
time and the machine that made it. Filter by category, search, or click a device
tag to see only that machine. It cannot be edited or cleared.

**Analytics** is empty for now. Below the placeholder it lists what is currently
stored on the NAS, which is where you check that an upload actually landed.

**Settings** has three parts. *Storage and defaults* holds the NAS folders a
finished video is copied into (the filled circle marks the default) and shows this
browser's device name. *Templates* holds reusable blocks of text: on the upload
screen they appear under the details, and typing a template's name in braces —
`{outro}` — swaps it in as you write.

Below those, each platform has its display order, its release timing, its default
publish options, and its adaptation rules. Release timing is either one fixed time
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
`activity_log` and `devices`. The chosen destination is recorded on each upload, so
changing the destination list later never redirects something already queued —
and the file is copied there, never moved. Nothing is written until you confirm an
upload; the only thing kept in the browser is this device's name.
