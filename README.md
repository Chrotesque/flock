# flock

Write each platform's text, point it at a video file, and schedule that video out to
YouTube, Instagram, TikTok and Facebook — each with its own release day and time.

Every platform reads differently: a link that works on one gets a post buried on
another, a hashtag style that looks fine here looks broken there. So you compose for
them one at a time, switching between them with a row of platform icons — YouTube and Facebook
take a title and a description, Instagram and TikTok are caption-only. On top of that
each platform can carry a list of "replace X with Y" rules for the edits you would
otherwise make every single time. flock shows you exactly what each platform will
receive before anything is sent.

On confirmation the video is uploaded to a PocketBase instance on the NAS, along
with one scheduled entry per platform. The idea is that publishing happens later
from the NAS, so this machine does not need to be online at release time.

**YouTube, TikTok and Instagram are connected; Facebook is not.** A worker
process picks up scheduled releases and publishes them for real — see *The
worker* below. YouTube is handed the video early and releases it itself at the
slot; TikTok and Instagram cannot do that, so the worker holds each of those
until its slot and posts then. Facebook publishes nowhere, and its options are
invented placeholders that exist so the interface can be judged before that API
is wired up. Uploads to the NAS, the schedules and the adaptation rules are real
for every platform.

## Requirements

- Node 22+ and pnpm
- A PocketBase instance of its own, reachable from this machine and from the
  machine the worker runs on (port 8091 in the examples below)

## Setup

Get the code and its dependencies:

```bash
git clone https://github.com/Chrotesque/flock.git
cd flock
pnpm install
```

Put the PocketBase superuser details in `scripts/.pb-creds.json`:

```json
{ "url": "http://<host>:8091", "email": "you@example.com", "password": "…" }
```

Create the collections (safe to re-run):

```bash
pnpm setup-pb
```

Point the app at the same instance in `.env` (start from `.env.example`):

```bash
PUBLIC_POCKETBASE_URL=http://<host>:8091
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

That builds and mirrors `build/` into the `pb_public` directory named by
`FLOCK_DEPLOY_DEST` in `.env`, which needs write access to it. The sync deletes
whatever is in that directory and not in the build, so point it only at a
`pb_public` that belongs to flock. `pnpm deploy:dry` shows what would change
without touching anything. PocketBase serves the files straight from disk, so
there is no restart.

To show flock inside another site of yours in an iframe, copy
`pb_hooks/strip_xframe.pb.js` into the PocketBase directory's `pb_hooks/` (a
container has to mount it at `/pb/pb_hooks`), set `FLOCK_FRAME_ANCESTORS` in
PocketBase's environment to that site's origin, and restart PocketBase. Without
the variable only flock itself and a local dev server may embed it. Deploy does
not do this for you.

## Two ways to give flock a video

**Upload it in the browser.** Drop a file on the picker. Simple, and fine up to a
few hundred megabytes — but it is one HTTP request with no resume, and PocketBase
caps a stored file at 5 GB.

**Or drop it on the NAS.** Set a *watch folder* in Settings, copy videos into it
over SMB, and the Upload step lists what is there. Picking one references the
file where it lies rather than transferring it, so nothing goes through the
browser and the 5 GB cap does not apply. This is the only route for a large
video, and the transfer is a normal file copy you can resume or retry.

**Or leave it where it is on this PC.** Add any number of *local watch folders*
in Settings — *Add folder…* opens the Windows folder dialog on the PC the worker
runs on, so the worker has to be running; their videos are pooled into one *Locally* list above the NAS one. On
confirm, the worker copies the chosen file into the NAS watch folder and
publishes from that copy, so it needs a watch folder set and has to run on this
PC (it does today). The original stays where it was.

Both listings come from the worker, which scans the folders each time it polls —
so nothing appears until the worker has run at least once, and the Upload step
shows when it last looked. A file that has gone out in an upload before is
hidden from both lists from then on; *Show N uploaded before* under a list
brings those back.

Right-click a file in either list to play it in the page. The worker streams it
from the PC it runs on (port 8790, reachable from that PC only), so previews
work while the worker is running and in a browser on the same PC. The Review
step plays a file picked from either list the same way.

## The worker

Confirming an upload only queues it. A separate process does the publishing, and
it has to keep running when no browser is open — so it belongs on the NAS beside
PocketBase, not in the app. It handles YouTube, TikTok and Instagram; each is
set up separately below, and a platform that is not set up simply leaves its
releases waiting in the queue, with a note in the worker's log.

It also scans the watch folder and the local folders, copies local picks into
the watch folder, and copies finished videos into their NAS destination, both of which happen regardless of which platforms a job is bound
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

**Running the worker on a machine without Node.** On a machine that has the
checkout, build it once:

```bash
pnpm build:worker
```

That writes `dist/worker/flock-worker.exe`, a single program with Node baked
in, and the example config beside it. Copy the program and your own
`.worker-config.json` into one folder on the other machine and run it there;
it takes the same flags as `pnpm worker` (`--once`, `--dry`, `--stats`,
`--tiktok`, `--instagram`), and `flock-worker auth --tiktok` runs a consent
flow. It reads the config beside itself, or wherever `FLOCK_WORKER_CONFIG`
points. It is built for the platform it was built on and is not signed, so
Windows may show a SmartScreen notice the first time. Local watch folders
are paths on the machine the worker runs on, so set them again in Settings
after moving it, and run only one worker at a time.

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

### TikTok

TikTok cannot hold a video for a release time, so the worker holds it: at the
slot it uploads the file, and TikTok posts it the moment its processing
finishes, usually a minute or two later. It needs an app of your own on the
[TikTok for Developers](https://developers.tiktok.com) portal:

1. Create an app, add the **Login Kit** and **Content Posting API** products,
   turn on **Direct Post**, and tick the `user.info.basic` and `video.publish`
   scopes.
2. Under Login Kit, on the **Desktop** tab, register the redirect URI
   `http://localhost:8765/tiktok` and put exactly that in the worker config as
   `tiktok.redirectUri`. The consent script listens there.
3. Copy the app's **client key** and **client secret** into the config as
   `tiktok.clientKey` and `tiktok.clientSecret`. While the app is unreviewed,
   use its **sandbox** and add your account as a target user.

Then authorise once, signed in to the TikTok account that will post:

```bash
pnpm worker:auth --tiktok
```

If the redirect URI is not on this machine, the browser lands on a page that
may not load; paste its full address into the terminal and the code is read
out of it. The worker keeps the refresh token current on its own.

Until TikTok has reviewed the app, it can only post to a TikTok account set to
**private**, whose audiences are Friends, Followers and Private — the *Post to
TikTok* box on the compose screen offers exactly what the account offers, so a
public choice cannot be made for it. Posting to a public account needs TikTok's
app review and then its Content Posting API approval, both applied for on the
app's page with a website and a demo video; TikTok does not approve apps it
considers personal or internal use. Videos must be MP4, MOV or WebM and under
4 GB; the cover is the frame at the *Cover frame* time, not the thumbnail image.

```bash
pnpm worker:tiktok
```

shows who the token posts as and which audiences the account offers.

### Instagram

Instagram publishes in two steps, so the worker uploads a reel ten minutes
ahead of its slot (`instagramLeadSeconds` in the config) and publishes it on
the minute. Every video goes out as a Reel — that is the only kind of video
Instagram's API still publishes — MP4 or MOV, under 1 GB, between 3 seconds
and 15 minutes. It needs a Meta app with the **Instagram** product and a
**professional** (Business or Creator) Instagram account:

1. In the [Meta app dashboard](https://developers.facebook.com/apps), add the
   Instagram product and choose *API setup with Instagram login*.
2. Add the account as an **Instagram tester** there, and accept the invite in
   the Instagram app under *Settings → Apps and websites → Tester invites*.
3. Press **Generate token** beside the account, copy the token, and run:

```bash
pnpm worker:auth --instagram --token <paste>
```

Or fill in `instagram.appId`, `instagram.appSecret` and a registered
`instagram.redirectUri` in the config and run `pnpm worker:auth --instagram`
for the consent flow instead. Either way the token lasts sixty days, and the
worker renews it by itself as long as it runs at least once a month.

```bash
pnpm worker:instagram
```

shows who the token posts as and how much of the day's allowance (100 posts)
is used.

**A custom cover for the reel.** The image in the Details step's *Thumbnail /
Cover* box is also the reel's cover (portrait JPEG or PNG, up to 8 MB, for
Instagram); without one, Instagram uses the frame at the *Cover frame* time. Instagram fetches a custom cover from a public
address rather than taking the image itself, so the worker serves it: a small
server on the worker's own machine, reachable only from that machine, which you
expose under one public hostname for Instagram to reach. With Tailscale, allow
Funnel in your tailnet's access rules, then run once on the worker's machine:

```bash
tailscale funnel --bg 8791
```

and put the hostname it prints into the worker config as
`instagram.coverPublicBase`, for example `https://pc.tailnet-name.ts.net`.
Each cover is served under a random address only while that reel is being
published, and nothing else on the machine is exposed. Without the setting the
cover box still works, but the worker says in its log that it used the cover
time instead, and the box says so too.

## Using it

**Name the browser first.** Nothing can be uploaded or changed until you do — the
Log records which machine made every change, and it cannot do that for an unnamed
browser. flock asks on first open. The name is unique across your machines and
cannot be changed afterwards, so pick one you will recognise later. Each browser
needs its own; the name is stored locally, so opening flock from a different
address counts as a different browser.

**Upload** is a four-step flow: Upload, Details, Schedule, Review. flock opens
on Analytics; Upload lives at `/upload`. The first step takes the video: drop
one on the picker on the left, or drag one from the *Locally* or *On the NAS*
list on the right onto a video box. By
default one video goes to every platform. Press a platform under *Own file* to
give it a video of its own — the rest keep sharing one — and repeat for as many
as need a different cut. The boxes follow the platform order from Settings.
That arrangement is remembered for the next upload until you change it.

On Details, the platform icons centred in the top bar switch which platform you
are writing for — a title and a description for YouTube and Facebook, a caption
for Instagram and TikTok; a green check on an icon means that platform is done.
Tick the platforms you want in the list on the right. The boxes under it follow
the platform being written for. For YouTube and Instagram, one *Thumbnail /
Cover* image, used as YouTube's thumbnail and as the reel's cover (optional;
YouTube takes JPEG, PNG, GIF or WebP up to 2 MB, Instagram JPEG or PNG up to
8 MB — if the image misses one platform's limits the box says so, and that
platform picks a frame; TikTok takes a cover *time* in its options instead;
see *Instagram* under *The worker* for what lets the worker send the cover).
For YouTube, a playlist dropdown listing the channel's own playlists as the
worker last read them. For YouTube and TikTok, a paid-promotion checkbox,
off on every new upload, that covers both platforms' disclosures at once. For
TikTok, a *Post to TikTok* box names the account the worker posts as and holds
the choices TikTok insists are made per post rather than saved: who can view the
video, picked from the audiences that account offers with nothing preselected;
whether viewers may comment, Duet or Stitch, all off until ticked and greyed out
where the account forbids them; and, once the paid-promotion box is on, whether
it is your brand or branded content, with TikTok's own wording for how the post
will be labelled. The line TikTok requires about its Music Usage Confirmation
sits underneath, and Continue stays off until the box is complete. While writing
a TikTok caption, everything past roughly the first hundred characters turns
red: that is the part TikTok hides behind "more" under the video. The whole
caption is still published. The thumbnail and playlist boxes fold to a single
line with a green check once they are done; click the line to open one again.
Continue unlocks once every ticked platform has been written for and has a
video. Clicking a platform in the
right-hand list opens its options and a preview of its adapted text. Next comes a
week calendar showing a card per platform: drag a card to another day or hour to move
that release, or use the exact date and time fields underneath. While a card is held
the grid scrolls with the wheel, or on its own near the top and bottom edges. A
dropdown above the time column shows a second zone's clock beside the local one —
US West, US East, or any zone added under Settings → Other — and the night and
evening hours are tinted. The review screen
plays the video — a tab per video when platforms have their own — with a tab for the thumbnail at the same size, beside
what each platform gets and when — and, once the worker has read the accounts,
which TikTok and Instagram account each goes out as; confirming is the tick
button, pressed once and then again within two seconds while it shows "!!!", and
the copy to the NAS starts there.

**Calendar** shows every release ever scheduled on a week grid. Things already
released — or whose slot has passed — are greyed out, and there is a toggle to hide
them. It opens read-only; press *Edit* twice within two seconds to unlock it, then
drag an upcoming release to another day or hour. Released and past-due posts stay
locked either way.

**Log** lists every change — uploads, calendar moves and settings — with the date,
time and the machine that made it. Filter by category, search, or click a device
tag to see only that machine. It cannot be edited or cleared. The *Worker* tab
shows what the worker printed, live as it prints it, kept for 14 days — the place to
look when a thumbnail, playlist or post did not come out as asked. It needs
`pnpm setup-pb` run once, and fills from the next worker start.

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

**Settings** has four parts. *Storage and defaults* holds the NAS folders a
finished video is copied into (the filled circle marks the default), the NAS watch
folder, the local watch folders listed under *Locally*, and this browser's device name. *Templates* holds reusable blocks of text: on the upload
screen they appear under the details, and typing a template's name in braces —
`{outro}` — swaps it in as you write. *Other* holds the compliance switch and any
extra time zones for the calendar's second clock.

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

## The website

`site/` is the source of [flock's website](https://flock-scheduler.netlify.app),
which the Google and TikTok developer portals link to: an overview with
screenshots, a how-it-works page, the privacy policy and the terms of service,
plus the app icon as the site's favicon. Plain HTML and one stylesheet,
uploaded by hand to a static host that can serve a file at its root, which is
what TikTok's URL-prefix verification needs; edit here and upload the folder
again. Replace the files in `site/img/` to update the screenshots.

## Where things live

Videos and schedules live in PocketBase on the NAS, in the collections
`upload_jobs`, `upload_targets`, `platform_settings`, `app_settings`,
`activity_log`, `devices`, `video_stats` and `worker_log`. The chosen destination is recorded on each upload, so
changing the destination list later never redirects something already queued —
and the file is copied there, never moved. Nothing is written until you confirm an
upload; the only things kept in the browser are this device's name and which
platforms get a video of their own. A split upload is stored as one upload per
video.
