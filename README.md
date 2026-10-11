# flock

> [!IMPORTANT]
> ## 🚧 In active development 🚧
>
> I use flock every day while I build it, and `master` moves fast. Now and then
> a commit breaks something. When that happens I'm very likely on it already,
> and a fix usually follows within hours. If something stops working, check the
> latest commits or pull again a little later.

Write each platform's text, point it at a video file, and schedule that video out to
YouTube, Instagram, TikTok and Facebook — each with its own release day and time.

Every platform reads differently: a link that works on one gets a post buried on
another, a hashtag style that looks fine here looks broken there. So you compose for
them one at a time, switching between them with a row of platform buttons — YouTube and Facebook
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

Create the collections (safe to re-run, and run it again after updating flock,
since a new version may add collections or fields):

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

**Or point flock at a folder.** Add *watch folders* in Settings — *Choose
folder…* opens the Windows folder dialog on the PC the worker runs on, *Type a
path* takes a network folder such as `\\nas\videos\incoming`. Their videos are
pooled into one *Watch folders* list on the Upload step. A folder on the
network (*LAN*: a `\\server\share` path) is referenced where it lies, so
nothing goes through the browser and the 5 GB cap does not apply — the only
route for a large video. A folder on the PC (*local*: a drive path) is copied
by the worker into a LAN watch folder on confirm, and published from that
copy; with several LAN folders, a radio button in Settings picks which one.
The original always stays where it was.

The listings come from the worker, which scans the folders each time it polls —
so nothing appears until the worker has run at least once, and the Upload step
shows when it last looked. A file that has gone out in an upload before is
hidden from the list from then on; *Show N uploaded before* under the list
brings those back.

**Or keep each video in a project folder.** Add *project folders* in Settings
the same way: folders that hold one subfolder per video project. A subfolder
is ignored until a `flock.json` file appears in it (a flock block, see
*Pasting a prepared upload* below). Then it is listed in the sidebar under
**New projects**; clicking it opens Upload filled from that file, with the
subfolder's videos listed in a *Project Folder* box above the watch folders
and one video for every platform: a folder holding a single video has it
picked already, one holding several leaves the choice to you. Everything done to
that upload is kept on the project as you go, so clicking it again — after a
restart, or on another computer — picks it up where it was left; TikTok's
audience and interaction choices and paid promotion are chosen again then.
Once the upload is confirmed the project leaves the list, and the worker
renames its `flock.json` to `flock_uploaded.json` — kept beside the video,
never read as a project again; a new `flock.json` in the same folder later
starts a new project. *Take it off the list*, in the Project Folder box,
drops one that will not be uploaded and leaves its file as it is.

Right-click a file in any list to play it in the page.Right-click a file in either list to play it in the page. The worker streams it
from the PC it runs on (port 8790, reachable from that PC only), so previews
work while the worker is running and in a browser on the same PC. The Review
step plays a file picked from any list the same way.

## The worker

Confirming an upload only queues it. A separate process does the publishing, and
it has to keep running when no browser is open — so it runs outside the app,
on your PC, your NAS or both (see *One worker or two* below). It handles YouTube, TikTok and Instagram; each is
set up separately below, and a platform that is not set up simply leaves its
releases waiting in the queue, with a note in the worker's log.

It also scans the watch folders and project folders, copies local picks into
a LAN watch folder, and copies finished videos into their NAS destination, both of which happen regardless of which platforms a job is bound
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
   add the Google account that owns the channel as a **test user** — every
   such account, if your channels belong to different Google logins.
3. Under *Credentials*, create an **OAuth client ID** of type **Desktop app**.
   That gives you a client ID and client secret.

Copy the example config and paste those two values in:

```bash
cp worker/.worker-config.example.json worker/.worker-config.json
```

Then authorise once per channel — this opens a consent URL and adds the channel
you pick in Google's account chooser to that file:

```bash
pnpm worker:auth
```

Run it again for each further channel; a channel connected again just gets its
new grant. `pnpm worker:youtube` lists the channels the worker can upload to.
With more than one, each brand picks its channel in Settings → Brands.

That asks for **upload permission plus read-only access** to the channel. Upload
is all `videos.insert` needs; read-only is what the Analytics screen's stats
need, and it cannot change anything. An authorisation made before Analytics
existed has read the channel fine too, so re-run this only if the worker reports
a scope error. The exception is the playlist box on the compose screen:
putting a video in a playlist means editing it, which requires Google's broader
`youtube` scope — the consent screen describes it as permanently deleting
videos, comments and captions. If you want that to work, authorise each channel
with:

```bash
pnpm worker:auth --with-playlists
```

Otherwise the playlist is skipped, and the review screen says so before you
confirm.

flock sets no thumbnail and no **paid promotion** on YouTube: the API accepts
paid promotion but viewers never see the notice, and the thumbnail it sets is
only the 16:9 one, never the vertical cover a Short shows in the Shorts feed.
Set both in YouTube Studio; the sidebar's *To finish* list links each video's
edit page there.

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
in, the example config beside it, and `flock-worker.cjs`, the same worker for
a machine that has Node (see the container below). Copy the program and your own
`.worker-config.json` into one folder on the other machine and run it there;
it takes the same flags as `pnpm worker` (`--once`, `--dry`, `--stats`,
`--tiktok`, `--instagram`), and `flock-worker auth --tiktok` runs a consent
flow. It reads the config beside itself, or wherever `FLOCK_WORKER_CONFIG`
points. It is built for the platform it was built on and is not signed, so
Windows may show a SmartScreen notice the first time. On Windows the build
also writes `flock-worker-background.exe`, the same program with no console
window, for a PC worker that should simply run: put a shortcut to it in the
Startup folder (Win+R, `shell:startup`) and it starts with Windows. It shows
the flock icon in the notification area — double-click to open flock,
right-click to open the log or stop the worker — and
`flock-worker-background.exe --stop` stops it too. Both keep everything they print
in `flock-worker.log` beside themselves, and only one polling worker of a
role runs on a machine — starting a second does nothing. Local watch and
project folders are paths on the machine the worker runs on, so set them again
in Settings after moving it, and run only one worker at a time — unless you
split them as below. A single worker (`all`) with no LAN watch folder publishes
a local pick from where it lies instead of copying it.

**One worker or two.** With no NAS, run one worker on your PC and leave
`"role"` in its config at `"all"` (the default): it does everything. With a
NAS or any other machine that stays on, you can run two: one there with
`"role": "nas"` (publishing, filing videos into their destinations, stats,
title scoring, LAN watch and project folders) and one on the PC with
`"role": "local"` (local watch and project folders, the folder dialog, video
previews, a pasted block's thumbnail).
`FLOCK_WORKER_ROLE` sets the role too. The PC worker needs nothing but
`pocketbaseUrl` and `"role": "local"` in its config — no client secrets or
tokens — and then leaves publishing to the NAS worker entirely. Given the
platform credentials as well, it takes over the NAS worker's work while that
one is down and hands it back once it returns; the catch is that TikTok
replaces its tokens as they are used, so two configs holding them drift
apart, and one of them stops working. The sidebar shows **Worker** with one
dot per worker (PC left, NAS right): green running, red not, amber with a
ring while the PC is doing the NAS worker's work as well; underneath, what
each is doing. Never run an `all` worker beside either of the others.

**The NAS worker in a container.** The worker is one file for plain Node,
`dist/worker/flock-worker.cjs` (written by `pnpm build:worker`), so any
`node:22` or newer image runs it with nothing to install. Put it and the
worker's `.worker-config.json` in one folder on the NAS, then create a
container from `node:24-alpine` with:

- that folder mounted at `/config`, and the command `node /config/flock-worker.cjs`;
- `FLOCK_WORKER_ROLE=nas`, and `FLOCK_PB_URL` set to an address of
  PocketBase the container can reach (a LAN address is safest);
- each share holding a LAN watch or project folder or a destination mounted at
  `/mnt/user/<share name>`: the worker turns a folder typed in Settings as
  `\\server\share\folder` into `/mnt/user/share/folder`, matching the case of
  what it finds there. That is Unraid's own layout, so on Unraid mount
  `/mnt/user/<share>` at the same path; on another NAS mount the share's own
  path there instead;
- a restart policy (`--restart unless-stopped`), and on Unraid
  `--user 99:100` with `UMASK=000`, so copied videos stay editable over SMB;
- `FLOCK_RESTART_ON_UPDATE=1`, so the worker restarts itself on a new
  version (below). Leave it out anywhere nothing would restart the worker.

Its console shows in the container's log and on flock's Log screen. To
update it, set `FLOCK_WORKER_DEST` in `.env` to that folder as this machine
reaches it (`\\nas\appdata\flock_worker`, say) and run:

```bash
pnpm deploy:worker
```

That bundles the worker, copies it beside the config, and waits until the
worker has finished what it holds and restarted on the new file.
`pnpm deploy:worker:dry` shows where it would go. To connect another account
later, point the consent flow at the NAS config — for example
`FLOCK_WORKER_CONFIG=\\nas\appdata\flock_worker\.worker-config.json pnpm worker:auth --tiktok`
— and restart the container.

`pnpm worker:once` does a single pass and exits, which is the easier one to watch
while testing. `pnpm worker:stats` runs one stats poll on its own, which is the
quickest way to confirm the read scope works. The config file holds a client
secret and is gitignored.

The stats poll reads the newest fifty videos every 30 seconds by default, which
is about a third of the daily API quota that uploads also draw on. With several
channels they take turns, so each is read less often and the cost stays the
same — the quota belongs to the Google Cloud project, not to a channel. `statsSeconds`,
`statsVideos` and `statsBudget` in the worker config adjust it; when a day's
polling reaches the budget it pauses until Google's reset at midnight Pacific,
so it can never leave an upload without quota.

**One limit worth knowing.** While the OAuth consent screen sits in *Testing*,
Google expires the refresh token after **7 days**, so you would be re-running
`pnpm worker:auth` every week, once per channel. Publishing the consent screen
stops that.

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
out of it. The worker keeps each account's refresh token current on its own.

Each run adds the TikTok account signed in at TikTok to the worker. To connect
another, sign out of TikTok in that browser (or switch accounts) and run it
again; with more than one, each brand picks its account in Settings → Brands.
While the app uses its sandbox, only the sandbox's **target users** can sign in
(the app's page → Sandbox settings → Target users, up to ten).

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

shows who each account posts as and which audiences it offers.

### Instagram

Instagram publishes in two steps, so the worker uploads a reel ten minutes
ahead of its slot (`instagramLeadSeconds` in the config) and publishes it on
the minute. Every video goes out as a Reel — that is the only kind of video
Instagram's API still publishes — MP4 or MOV, under 1 GB, between 3 seconds
and 15 minutes. flock reaches the account through **Facebook**, which needs:

- a **professional** (Business or Creator) Instagram account, **linked to a
  Facebook Page** you manage (Instagram app: *Settings → Accounts Center*, or
  the Page's settings under *Linked accounts*);
- a Meta app of type **Business** on
  [developers.facebook.com](https://developers.facebook.com), with Instagram
  set up for Facebook login. While the app is in Development mode, your
  Facebook account having a role on the app is enough; no App Review is needed.

Put the app's own **App ID** and **App secret** (*App settings → Basic* in the
app's dashboard — not the Instagram app ID shown under the Instagram product)
into the worker config as `instagram.appId` and `instagram.appSecret`, then run:

```bash
pnpm worker:auth --instagram --token
```

It lists the permissions to tick and waits for a token, which you make in the
[Graph API Explorer](https://developers.facebook.com/tools/explorer): set
*Meta App* to your app, choose *User Token*, add the listed permissions, click
*Generate Access Token* and allow the Page and the Instagram account, then
paste the token at the prompt. The worker checks what was granted, turns the
token into each Page's own token, which does not expire, and keeps only those.
**Several Instagram accounts** come in through the same login: with more than
one Page that has an Instagram account it lists them and takes several at once
(`1,2` or `all`). Running it again adds accounts or refreshes their tokens and
never drops the others. Which brand posts as which account is chosen in
Settings → Brands once the worker has run and listed them.

Without `--token`, `pnpm worker:auth --instagram` runs Facebook's consent
screen instead, which needs the **Facebook Login for Business** product added
to the app. Its settings page may warn that it requires Advanced Access on
`public_profile`; that is for an app that goes live, and in Development mode
the consent works for anyone with a role on the app. If you use a Login for
Business *configuration*, put its id in `instagram.configId`.

```bash
pnpm worker:instagram
```

shows who each account's token posts as and how much of its day's allowance
(100 posts) is used.

**A custom cover for the reel.** The image in the Details step's *Cover* box
is the reel's cover (portrait JPEG or PNG, up to 8 MB, for
Instagram); without one, Instagram uses the frame at the *Cover frame* time.
Instagram only takes a cover as an address it downloads, so the worker puts the
image on your Page as an **unpublished** photo — it never appears on the Page —
hands Instagram that photo's address, and deletes the photo once Instagram has
it. If that fails, the reel still goes out with the frame at the cover time, and
the worker's log says why.

## Using it

**Name the browser first.** Nothing can be uploaded or changed until you do — the
Log records which machine made every change, and it cannot do that for an unnamed
browser. flock asks on first open. The name is unique across your machines and
cannot be changed afterwards, so pick one you will recognise later. Each browser
needs its own; the name is stored locally, so opening flock from a different
address counts as a different browser.

**Brands.** Everything you set up — platform defaults, adaptation rules, release
times and templates — belongs to a brand, and every upload is made for one. A
fresh install has one brand, *My brand*; rename it and add more under Settings →
Brands, where a new brand starts as a copy of the one in view. With more than
one, a row of brand buttons sits under the heading of the upload screen (labelled *Brand*) and
above the brand's part of Settings; both are the same choice, remembered per
browser. Switching brand in the middle of an upload keeps the video and the
text but resets each platform's options and schedule to that brand's.

Each brand also has its own accounts. The worker lists every account it can
post as under Settings → Brands, and each brand picks one per platform. With a
single brand there is nothing to pick: it posts as each platform's only
account. With more than one, a platform is offered on an upload only for a
brand that has an account chosen for it — the upload screen says which are
missing — and the worker publishes each post through exactly the account it
was made for, or refuses it. So one brand's post can never go out on another
brand's account.

Instagram allows 100 posts through its API in any 24 hours, per account. The
count used so far shows beside each brand's Instagram account in Settings →
Brands and on the Review step's Instagram row, which warns when a post due
within the day would find the allowance used up. The worker reads the count
every half hour and right after each post.

**Upload** is a four-step flow: Upload, Details, Schedule, Review. flock opens
on Analytics; Upload lives at `/upload`. The first step takes the video: drop
one on the picker on the left, or drag one from the *Locally* or *On the NAS*
list on the right onto a video box. By
default one video goes to every platform. Press a platform under *Own file* to
give it a video of its own — the rest keep sharing one — and repeat for as many
as need a different cut. The boxes follow the platform order from Settings.
That arrangement is remembered for the next upload until you change it.

On Details, a row of platform buttons sits in the top bar, level with the
brands. Click one to write for it — a title and a description for YouTube and
Facebook, a caption for Instagram and TikTok; a platform that is off gets
turned on as you open it. A yellow ! on a button means that platform still
needs something, a green check that it is done. Hovering a button shows two
controls above it: a tick on the left, which turns the platform on or off for
this upload, and a gear on the right for its options on this upload. Platforms
switched off in Settings start off and greyed out. One the brand has no account
for cannot be used, and its controls say to choose the account in Settings →
Brands first. The boxes on the right follow the platform being written for. For Instagram, a *Cover* image for the reel (optional;
JPEG or PNG up to 8 MB — without one Instagram uses the frame at its cover
time; see *Instagram* under *The worker* for what lets the worker send it).
TikTok's API takes no cover image, only a cover *time*, set in its options.
For YouTube, a playlist dropdown listing the channel's own playlists as the
worker last read them. For TikTok, a paid-promotion checkbox, off on every new
upload — TikTok's commercial-content disclosure. For
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
caption is still published. The cover and playlist boxes fold to a single
line with a green check once they are done; click the line to open one again.
Continue unlocks once every ticked platform has been written for and has a
video. Clicking a platform in the
right-hand list opens its options and a preview of its adapted text. Next comes a
calendar of the coming days — today first, 14 days unless *Show N days* above it
says otherwise (7 to 21, remembered per browser) — showing a card per platform:
drag a card to another day or hour to move that release, or use the exact date
and time fields underneath. While a card is held
the grid scrolls with the wheel, or on its own near the top and bottom edges. A
dropdown above the time column shows a second zone's clock beside the local one —
US West, US East, or any zone added under Settings → Other — and the night and
evening hours are tinted. The review screen
plays the video — a tab per video when platforms have their own — with a tab for the reel's cover at the same size, beside
what each platform gets and when — and, once the worker has read the accounts,
which TikTok and Instagram account each goes out as, and a warning when the
YouTube channel's authorisation cannot add the playlist after upload;
confirming is the tick
button, pressed once and then again within two seconds while it shows "!!!", and
the copy to the NAS starts there.

**Pasting a prepared upload.** Text written elsewhere — in a chat with an
assistant, say — can go in with one Ctrl+V anywhere in flock, as a *flock
block*: a JSON object with `"flock": 1` at the top. flock opens Upload,
switches to the brand named, ticks each platform named and fills its text;
YouTube's tags go into the *Other* box and its playlist is picked, and a
platform's `schedule` — `"2026-10-13 18:00"` in local time, or `"now"` —
fills its slot on the Schedule step, where it can still be changed. A
`thumbnail` path is the reel's cover, read by the worker from its own disk
(JPEG or PNG, up to 8 MB), so it has to be running on the PC that holds the
image.
A note in the bottom corner says what was filled and what was ignored.
Anything else on the clipboard pastes as usual. The video is still picked on
the Upload step, and TikTok's audience and interaction choices and paid
promotion are never filled: those are chosen by hand on every post.

```json
{
  "flock": 1,
  "brand": "My brand",
  "thumbnail": "C:/Users/me/Pictures/thumbnail.png",
  "youtube": { "title": "…", "description": "…", "tags": ["…", "…"], "playlist": "…", "schedule": "2026-10-13 18:00" },
  "instagram": { "caption": "…", "schedule": "2026-10-13 19:30" },
  "tiktok": { "caption": "…", "schedule": "2026-10-14 17:00" }
}
```

The same block saved as `flock.json` in a project folder's subfolder makes
that subfolder a project (see *Or keep each video in a project folder*). There
a `thumbnail` without a drive or share — `"thumb.png"` — means the file next
to `flock.json`. If `flock.json` changes after the upload was opened, the
Project Folder box offers to fill from it again.

**Calendar** shows every release ever scheduled on a week grid. Things already
released — or whose slot has passed — are greyed out, and there is a toggle to hide
them. It opens read-only; press *Edit* twice within two seconds to unlock it, then
drag an upcoming release to another day or hour. Released and past-due posts stay
locked either way. With more than one brand, buttons at the top show one brand's
releases or all of them, and each card names its brand while all are shown.

**Log** lists every change — uploads, calendar moves and settings — with the date,
time and the machine that made it. Filter by category, search, or click a device
tag to see only that machine. It cannot be edited or cleared. A YouTube release's
entry ends with *Set by hand in Studio: …* and the video's Studio link when
something has to be finished there (paid promotion, a Short's cover, or a
thumbnail or playlist that failed). The *Worker* tab
shows what the worker printed, live as it prints it, kept for 14 days — the place to
look when a thumbnail, playlist or post did not come out as asked. It needs
`pnpm setup-pb` run once, and fills from the next worker start.

**Analytics** shows the newest fifty videos on one channel — the one the brand
in view uploads to, with the brand buttons on top when there is more than one
brand — as YouTube reports them, refreshed every 30 seconds while the worker
runs (less often per channel with several): views, likes and
comments in a row per video, and everything else the API returns underneath
when you click one. The buttons on the left narrow it to Shorts (under three
minutes), long form, live streams, or whatever fits none of those; tick any
combination, and untick *Hide unlisted* or *Hide private* to see those too —
every choice is remembered. A total row at the top adds up whatever is shown. A
counter that has moved since you opened the page turns green and shows the
change beside it, as in `940 (+9)`; Refresh resets those markers. It needs
the worker running. Below that it lists what is currently stored on the NAS,
which is where you check that an upload actually landed, with each upload's
brand once there is more than one.

**Settings** shows flock's version beside its title, and comes in two halves.
*General* is shared by every brand: *Storage
and defaults* holds the NAS folders a finished video is copied into (the filled
circle marks the default), the watch folders, the project folders, and this
browser's device name; *Brands* adds, renames, orders
and deletes brands and chooses each brand's account per platform (deleting one
removes its settings and templates, while its uploads stay and anything queued
still goes out); *Other* holds the compliance
switch, the Jestr integration and any extra time zones for the calendar's
second clock.

**To finish**, in the sidebar, lists YouTube videos with something left to do
by hand, from the day flock first showed it. Each line has the video's title
(it opens the video), a YouTube icon that opens its edit page in Studio, and —
with the Jestr integration on — a *Jestr* button. From the moment an upload is
confirmed until YouTube has the video, its line is a placeholder with a turning
ring instead of the icon, so it is clear the upload went through and only
YouTube is still to answer. A yellow dot on the icon (on videos uploaded before
0.11.7) means paid promotion or a Short's cover was still to be set in Studio;
clicking it opens Studio and counts that as done.

**Jestr integration** (off unless ticked under Settings → *Other*) is for
creators paid through [Jestr](https://jestr.gg) campaigns, where each video's
link has to be handed to Jestr by hand. With it on, *To finish* also lists every
video on a connected YouTube channel — uploaded through flock or not — with a
*Jestr* button: press it once the video is linked on Jestr. A scheduled video is
listed straight away, its button usable once it is public. A line leaves the
list once nothing is left on it. Jestr has no API, so flock cannot check the
link itself.

The other half belongs to the brand in view. *Templates* holds reusable blocks of
text: on the upload screen they appear under the details, and typing a
template's name in braces — `{outro}` — swaps it in as you write. Below that,
each platform has its display order, its release timing, its default
publish options, and its adaptation rules. YouTube's defaults include the language
spoken in the video and the language of the title and description, English (US)
unless changed. Release timing is either one fixed time
for that platform, or *Profiles* — named patterns like "Horror", each with an
optional time and an optional set of weekdays. Choosing Profiles adds a Profiles
tab to that platform, and the profiles you define there appear as buttons on the
schedule step: pick one and it fills in the next matching day and the time.

Adaptation rules run top to bottom and chain, so order matters; there is a box at
the bottom to try them against sample text. An unticked platform starts switched
off on a new upload, where it can still be ticked; its defaults and rules are
kept.

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
`upload_jobs`, `upload_targets`, `brands`, `accounts`, `platform_settings`, `app_settings`,
`activity_log`, `devices`, `video_stats` and `worker_log`. The chosen destination is recorded on each upload, so
changing the destination list later never redirects something already queued —
and the file is copied there, never moved. Nothing is written until you confirm an
upload; the only things kept in the browser are this device's name, the brand in
view, which platforms get a video of their own, and view choices such as the
calendar's brand filter. A split upload is stored as one upload per video.
