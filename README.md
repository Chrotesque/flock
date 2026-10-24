# flock

> [!IMPORTANT]
> ## 🚧 In active development 🚧
>
> I use flock every day while I build it, and `master` moves fast. Now and
> then a commit breaks something; a fix usually follows within hours. If
> something stops working, check the latest commits or pull again later.

flock schedules a video out to YouTube, Instagram, TikTok and Facebook, with
its own text and its own release time for each platform.

- **Write for each platform separately.** YouTube takes a title and a
  description, Instagram, TikTok and Facebook a caption.
- **Automate the edits you always make.** Each platform can have "replace X
  with Y" rules, applied when you confirm.
- **See exactly what goes out** before anything is sent.
- **Your PC can be off at release time.** The video and the schedule go to a
  PocketBase instance (on a NAS, say), and a worker publishes from there.

All four publish for real. Facebook takes reels on a Page.

## Requirements

- Node 22+ and pnpm
- A PocketBase instance of its own, reachable from your PC and from the
  machine the worker runs on (port 8091 in the examples)
- A developer app for each platform you want to publish to — see
  [The worker](#the-worker)

## Install

Get the code:

```bash
git clone https://github.com/Chrotesque/flock.git
cd flock
pnpm install
```

Put the PocketBase superuser details in `scripts/.pb-creds.json`:

```json
{ "url": "http://<host>:8091", "email": "you@example.com", "password": "…" }
```

Create the collections. This is safe to re-run; run it again after every
update, since a new version may add collections or fields:

```bash
pnpm setup-pb
```

Point the app at the same instance in `.env` (start from `.env.example`):

```bash
PUBLIC_POCKETBASE_URL=http://<host>:8091
```

## Run the app

For development:

```bash
pnpm dev
```

To publish it, set `FLOCK_DEPLOY_DEST` in `.env` to PocketBase's `pb_public`
folder, then:

```bash
pnpm deploy
```

This builds the app and mirrors it into that folder. PocketBase serves it
straight away, with no restart.

> [!WARNING]
> The mirror deletes anything in that folder that is not part of the build.
> Point it only at a `pb_public` that belongs to flock. `pnpm deploy:dry` shows
> what would change.

**Showing flock inside another site (iframe):**

1. Copy `pb_hooks/strip_xframe.pb.js` into PocketBase's `pb_hooks/` folder (a
   container mounts it at `/pb/pb_hooks`).
2. Set `FLOCK_FRAME_ANCESTORS` in PocketBase's environment to that site's
   origin.
3. Restart PocketBase.

## The worker

Confirming an upload only queues it. The worker is a separate process that
keeps running when no browser is open. It:

- publishes each release. YouTube gets the video right away and releases it at
  the slot itself; TikTok and Instagram are held until their slot.
- lists the watch and project folders, copies videos from your PC to the
  network, and files finished videos into their NAS folder.
- reads YouTube's, Instagram's, TikTok's and Facebook's numbers for the
  Dashboard (followers included),
- looks up the TikTok accounts a caption @mentions, so the compose screen
  shows whose each one is before it goes out, and
- scores titles with vidIQ if you set that up.

A platform you have not set up just leaves its releases waiting in the queue.

Start from the example config. It will hold your client secrets, and git
ignores it:

```bash
cp worker/.worker-config.example.json worker/.worker-config.json
```

### YouTube

In the [Google Cloud console](https://console.cloud.google.com):

1. Create a project and enable **YouTube Data API v3** and **YouTube Analytics
   API** (*APIs & Services → Library*).
2. Set up the **OAuth consent screen** as **External**, and add each Google
   account that owns a channel as a **test user**.
3. Under *Credentials*, create an **OAuth client ID** of type **Desktop app**.

Put the client ID and secret in the config, then connect a channel:

```bash
pnpm worker:auth
```

Run it once per channel. `pnpm worker:youtube` lists the channels the worker
can upload to; with several, each brand picks its own in Settings → Brands.

Good to know:

- **Publish the consent screen.** While it is in *Testing*, Google ends the
  connection after 7 days and you would re-run `worker:auth` every week.
- **Playlists need a broader permission.** Connect with
  `pnpm worker:auth --with-playlists` to have videos added to playlists.
  Without it they are skipped, and the Review step says so.
- **Subscribers per video** and the Dashboard's YouTube **skip rate** (plays
  that never became an engaged view) come from YouTube Analytics, about two
  days late. A channel connected before flock asked for Analytics (0.16.40)
  keeps flock's own subscriber estimate and shows no YouTube skip rate until it
  is connected again.
- **Thumbnails and paid promotion are set in YouTube Studio**, not by flock,
  and **Instagram's Paid partnership label in the Instagram app** on a phone.
  *To finish* in the sidebar links each video's Studio page and reminds of the
  label.
- **Stats cost API quota.** The Dashboard's YouTube numbers come from the
  newest 50 videos, read every 30 seconds, and each channel's subscriber count,
  read every 10 minutes: under half of the 10,000 units a day. Uploads have
  their own allowance of 100 a day; the units also pay for playlist adds, renames
  and Calendar edits. At 8,000 units the automatic reads stop until the quota
  resets (Refresh on the Dashboard still reads until 9,000), so the last 1,000
  are always left for those. `statsSeconds`, `statsVideos`, `statsBudget` and
  `statsCeiling` in the config adjust it.

### TikTok

TikTok cannot schedule, so the worker uploads at the slot and TikTok posts once
it has processed the video, usually a minute or two later.

On the [TikTok for Developers](https://developers.tiktok.com) portal:

1. Create an app with **Login Kit** and the **Content Posting API**, turn on
   **Direct Post**, and tick the `user.info.basic` and `video.publish` scopes.
2. Under Login Kit's **Desktop** tab, register the redirect URI
   `http://localhost:8765/tiktok`. Put the same address in the config as
   `tiktok.redirectUri`.
3. Put the **client key** and **client secret** in the config as
   `tiktok.clientKey` and `tiktok.clientSecret`. Until the app is reviewed, use
   its **sandbox** keys and add your account as a **target user**.

Then connect, signed in to the TikTok account that will post:

```bash
pnpm worker:auth --tiktok
```

- To add another account, switch accounts in TikTok in that browser and run it
  again.
- If the browser lands on a page that does not load, paste that page's address
  into the terminal.
- `pnpm worker:tiktok` shows who each account posts as, which audiences it
  offers and whether the Dashboard reads its numbers.

**TikTok on the Dashboard** (optional): add the **Display API** to the app and
tick `video.list` and `user.info.stats` too — on a live app that is a
portal revision TikTok reviews; a sandbox can grant them straight away. Then
sign each account in again with them:

```bash
pnpm worker:auth --tiktok --with-stats
```

The worker then reads the account's newest public videos (views, likes,
comments, shares) and its follower count every 10 minutes into PocketBase's
`post_stats` (`ttStatsPosts`, `ttStatsSeconds`; 0 turns it off), and links
each post flock made to its video. Without `--with-stats` the sign-in asks for
posting only, and TikTok shows no videos on the Dashboard.

To try it on a sandbox without touching your running worker's config:
`pnpm tiktok:demo init` writes `worker/.worker-config.demo.json` (TikTok key,
secret and redirect URI and the PocketBase address copied from your config —
put the sandbox's key and secret there if yours is the live app's), `pnpm
tiktok:demo sign-in` signs a sandbox target user in with the reading scopes,
and `pnpm tiktok:demo read` reads its videos and followers once. A brand whose
TikTok account has the same handle shows them.

Limits:

- **Private accounts only, until TikTok approves your app for public posting**
  (its app review, then its Content Posting API audit). Until then, posts are
  visible to the account alone.
- **Videos:** MP4, MOV or WebM, under 4 GB.
- **Cover:** TikTok takes no cover image, only a moment in the video. When the
  upload has a *Cover* image (picked while writing for Instagram or Facebook),
  the worker holds it for 0.2 s at the end of the TikTok video (or the
  beginning) and makes that moment the cover; this needs ffmpeg
  and ffprobe where the worker runs (on the PATH, beside the config, or named
  by `ffmpegPath` / `FLOCK_FFMPEG`). Without an image, or without ffmpeg, the
  cover is the *Cover frame* set in TikTok's options, and the post says why.

### Instagram

Every video goes out as a Reel: MP4 or MOV, under 1 GB, 3 seconds to 15
minutes. The worker uploads it ten minutes before its slot
(`instagramLeadSeconds`) and publishes it on the minute. Instagram sometimes
refuses an upload it had accepted in full, and a connection can drop. In
either case the worker starts the upload again, pausing longer each time,
until 15 minutes past the slot. A reel that gets through late goes out at
once.

You need:

- a **professional** (Business or Creator) Instagram account, **linked to a
  Facebook Page** you manage;
- a Meta app of type **Business** on
  [developers.facebook.com](https://developers.facebook.com), with Instagram set
  up for Facebook login. In Development mode, having a role on the app is
  enough; no App Review is needed.

Put the app's **App ID** and **App secret** (*App settings → Basic* — not the
Instagram app ID) in the config as `instagram.appId` and
`instagram.appSecret`, then run:

```bash
pnpm worker:auth --instagram --token
```

It lists the permissions you need and waits for a token. To make one, in the
[Graph API Explorer](https://developers.facebook.com/tools/explorer):

1. Set *Meta App* to your app and choose *User Token*.
2. Add the listed permissions.
3. Click *Generate Access Token* and allow the Page and the Instagram account.
4. Paste the token at the prompt.

The worker keeps each Page's own token, which does not expire.

- **Several accounts:** with more than one Page, it lists them; answer `1,2` or
  `all`. Running it again adds or refreshes accounts and drops none.
- **Consent screen instead of a token:** leave out `--token`. That needs the
  *Facebook Login for Business* product; a configuration id goes in
  `instagram.configId`. Once the app is Live, Facebook only sends you back to
  an address registered on the app, so the token route is the simpler one.
- `pnpm worker:instagram` shows each account and how much of its daily
  allowance (100 posts) is used.
- **Covers:** a cover image is placed on your Page as an *unpublished* photo
  (it never appears there), handed to Instagram, then deleted. A failed
  connection is tried again for up to five minutes; after that the reel uses
  its *Cover frame*, and *To finish* warns that it went out without its cover.
- **Paid partnership:** Meta's API takes Instagram's label but does not show
  it, so flock does not send it. Add it in the Instagram app; *To finish* lists
  each reel for it.
- **Reel views:** with `instagram_manage_insights` granted, the worker also
  reads each account's newest 100 posts, their views and each reel's skip rate
  every 10 minutes, into PocketBase's `post_stats` (`igStatsPosts`,
  `igStatsSeconds`; 0 turns it off), and the Dashboard shows them.

### Facebook

Every video goes out as a public Reel on a Facebook **Page**: MP4 (or MOV),
3 to 90 seconds. Facebook holds a reel for its release time itself, so the
worker uploads it as soon as the slot is within four weeks; a slot less than
ten minutes away goes out at once. A Page allows 30 reels a day through the
API.

It uses the same Meta app as Instagram, which has to be **Live** (*App Mode* at
the top of the app's dashboard): in Development mode, Facebook shows the reels
only to people with a role on the app. Going Live needs the privacy policy,
terms and data deletion addresses filled in under *App settings → Basic*;
posting to your own Pages needs no App Review.

The Pages your Instagram accounts are linked to are ready to use without
another step. For other Pages, or to choose which:

```bash
pnpm worker:auth --facebook --token
```

It works like the Instagram setup: it lists the permissions (`pages_show_list`,
`pages_read_engagement`, `pages_manage_posts`), takes a token from the
Graph API Explorer, lists every Page the token can post to, and keeps each
Page's own token. Running it again adds or refreshes Pages and drops none.
`pnpm worker:facebook` shows which Pages the worker posts to.

Then choose each brand's Page in Settings → *Brands*.

- **Covers:** a cover image becomes the reel's cover on the Page. A failed
  connection is tried again for up to five minutes. If Facebook refuses it, or
  the five minutes pass, the reel goes out with a frame Facebook picks, the
  post's entry in the Log says why, and *To finish* warns of it.
- **Reel numbers:** the worker reads each Page's newest 100 reels every 10
  minutes — every reel on the Page, including the ones Instagram shares there —
  with their likes and comments, for the Dashboard (`fbStatsPosts`,
  `fbStatsSeconds`; 0 turns it off). Their **views** need one more permission,
  `read_insights`: add it in the Graph API Explorer and run the setup again
  (`pnpm worker:auth --instagram --token`, or `--facebook --token` if you
  listed your Pages that way). Until then the Dashboard says the views are not
  read.

### vidIQ (optional)

Make a key at `app.vidiq.com/account/settings/mcp`, put it in the config as
`vidiqKey`, and check it without spending credits:

```bash
pnpm worker:vidiq
```

The Details step then has a **Score title** button beside the YouTube title.
Each score costs credits.

### Run it

```bash
pnpm worker:dry    # show what is queued, upload nothing
pnpm worker        # run
pnpm worker:once   # one pass, then exit
pnpm worker:stats  # one stats read, then exit
```

If it starts with *Cannot reach http://…:8091*, PocketBase is not reachable yet.
The worker keeps retrying for five minutes.

#### One worker or two

- **No NAS:** run one worker on your PC with `"role": "all"` (the default). It
  does everything.
- **A NAS that stays on:** run a `"role": "nas"` worker there and a
  `"role": "local"` worker on your PC.
  - The NAS worker publishes, files videos, keeps the stats, scores titles and
    lists the network folders.
  - The PC worker lists your PC's folders, opens the folder dialog, plays
    previews and fetches files named in a pasted block. Its config needs only
    `pocketbaseUrl` and `"role": "local"`.
- **Keep the platform logins in one config.** A PC worker with them takes over
  while the NAS worker is down, but TikTok replaces its login on every use, so
  two copies soon stop working.
- **Never run an `all` worker beside the others.** One worker per role runs on
  a machine; starting a second does nothing.

The sidebar shows one dot per worker (PC left, NAS right): green running, red
stopped, amber with a ring while the PC does the NAS worker's work as well.

#### Without Node: a single program

```bash
pnpm build:worker
```

This writes `dist/worker/flock-worker.exe`. Copy it and your
`.worker-config.json` into one folder on the other machine.

- It takes the same flags as `pnpm worker`, and `flock-worker auth --tiktok`
  connects an account.
- It reads the config beside itself, or wherever `FLOCK_WORKER_CONFIG` points.
  A downloaded copy saved as `worker-config.json` (browsers drop the leading
  dot) is read too.
- It is unsigned, so Windows may warn the first time.

On Windows the build also writes **`flock-worker-background.exe`**, which runs
without a window:

- It shows the flock icon in the notification area: double-click to open
  flock, right-click to open the log, the warning settings or stop it.
- **When a post did not go out** (it failed, or its slot passed unsent), a
  warning slides in on your second screen and stays on top until you press
  *Dismiss*. *Open in flock* opens that upload, where *Retry* is. Dismissing
  it only hides it on this PC: the post stays in flock's *To finish*. A post
  dismissed or retried in flock leaves the warning by itself.
- *Warning settings…* in the icon's menu picks the screen (second, main, the
  one with the mouse, or a particular one), where on it, the size, pulsing,
  sliding in, and whether the posts are named (off for screen recordings).
  *Show a test warning* shows how it looks.
- **Start with Windows** in the same menu starts it when you sign in. It shows
  in Windows' Settings → Apps → Startup too. If you used to start it from a
  shortcut in the Startup folder, delete that shortcut.
- `flock-worker-background.exe --stop` stops it too.
- It logs to `flock-worker.log` beside itself. If it cannot start (no config,
  flock out of reach for five minutes, one already running), a message box
  says why.
- Hovering a worker dot in the sidebar shows the machine and the worker's
  version.

Local folders are paths on the worker's own machine: after moving the worker,
set them again in Settings.

#### On a NAS, in a container

`pnpm build:worker` also writes `dist/worker/flock-worker.cjs`, the whole
worker for plain Node. Put it and the config in one folder on the NAS, and
create a container from `node:24-alpine` with:

- that folder mounted at `/config`, running `node /config/flock-worker.cjs`;
- `FLOCK_WORKER_ROLE=nas`, and `FLOCK_PB_URL` set to an address of PocketBase
  the container can reach (a LAN address is safest);
- every share holding a network folder or a destination mounted at
  `/mnt/user/<share>`. A folder typed in Settings as `\\server\share\folder` is
  read as `/mnt/user/share/folder`;
- `--restart unless-stopped`, and on Unraid `--user 99:100` with `UMASK=000`
  so copied videos stay editable over SMB;
- `FLOCK_RESTART_ON_UPDATE=1`, so it restarts itself on a new version;
- for TikTok cover images, static Linux `ffmpeg` and `ffprobe` binaries in
  the config folder, executable by the container's user (`chmod 755`). Not
  `apk add`: it needs root, which `--user` takes away;
- for the Dashboard's player: port 8790 mapped, `FLOCK_PREVIEW_HOST=0.0.0.0`,
  an https address in front of that port (Tailscale Serve, for example — the
  page is https, so the browser will not play from plain http), and
  `FLOCK_PREVIEW_URL` set to that address.

To update it, set `FLOCK_WORKER_DEST` in `.env` to that folder (as your PC
reaches it) and run:

```bash
pnpm deploy:worker
```

It copies the new worker in and waits until the worker has finished what it
was doing and restarted. To connect another account to the NAS config:

```bash
FLOCK_WORKER_CONFIG=\\nas\appdata\flock_worker\.worker-config.json pnpm worker:auth --tiktok
```

Then restart the container.

## Using flock

### First start

**Name the browser.** Nothing can be uploaded or changed until you do: the Log
records which machine made each change. The name is unique across your
machines and cannot be changed later. Each browser needs its own; opening
flock from another address counts as another browser.

### Brands and accounts

- **Everything belongs to a brand:** platform defaults, rules, release times,
  templates. A fresh install has one, *My brand*; rename it and add more under
  Settings → Brands. A new brand starts as a copy of the one in view.
- **One brand in view, everywhere.** With several, brand buttons sit on the
  upload screen and in Settings; both are the same choice.
- **Switching brand mid-upload** keeps the video and the text, and resets each
  platform's options and schedule to that brand's.
- **Each brand posts as its own accounts.** Settings → Brands lists every
  account the worker can post as; pick one per platform. A platform without an
  account is not offered for that brand, and a post never goes out on another
  brand's account.
- **Instagram's daily allowance** (100 posts per account per 24 hours) shows
  beside the account in Settings and on the Review step.

### Giving flock a video

- **Upload it in the browser.** Drop a file on the picker. Fine up to a few
  hundred MB; there is no resume, and the limit is 5 GB.
- **Use a watch folder.** Add folders in Settings → *Watch folders*: *Choose
  folder…* opens the folder dialog on the PC the worker runs on, *Type a path*
  takes a network path like `\\nas\videos\incoming`. Their videos appear in one
  *Watch folders* list on the Upload step.
  - A **network** folder (*LAN*) is used where it lies: no upload, and no size
    limit.
  - A **local** folder's video is copied to a network watch folder when you
    confirm. With several network folders, a radio button in Settings picks
    which.
- **Use a project folder.** See [Project folders](#project-folders).

Right-click a file in any list to play it. Previews come from the PC worker
(port 8790), so they work while it runs, in a browser on that PC.

The lists are as fresh as the worker's last scan; nothing shows before it has
run once. A file that has been uploaded before is hidden; *Show N uploaded
before* brings it back.

### Uploading, step by step

Upload has four steps: Upload, Details, Schedule, Review.

**1. Upload.** Drop a video on the picker, or drag one from a list on the right
onto a video box. One video goes to every platform. Press a platform under *Own
file* to give it a video of its own; that arrangement is remembered.

**2. Details.** The platform buttons in the top bar switch which platform you
are writing for.

- A yellow **!** means that platform still needs something; a green check
  means it is done.
- Hover a button for two controls: turn the platform on or off for this upload
  (left), and its options for this upload (right).
- Type a template's name in braces, like `{outro}`, to drop it in.
- While writing a TikTok caption, the part past about 100 characters turns
  red: that is what TikTok hides behind "more".

At the top of the boxes on the right, *Product name* takes what the video is
about, such as the game's name, for the whole upload. It is optional. The
boxes below it follow the platform you are writing for:

- **Instagram and Facebook:** an optional *Cover* image (JPEG or PNG, up to
  8 MB for Instagram and 10 MB for Facebook). One image serves both; the switch
  in the box's corner gives each its own. TikTok takes the same image
  (Instagram's, when the two have their own); its *Cover Time* box only asks
  where in the video it goes, *Beginning* or *End* (the default).
- **YouTube:** playlists, from the channel's own. Click the field, tick as
  many as you like, then *Done*; each shows as a tag with an × to take it off.
- **TikTok:** the *Post to TikTok* box, with the choices TikTok wants made on
  every post:
  - who can view the video, from what the account offers, with nothing
    preselected;
  - whether viewers may comment, Duet or Stitch, all off until ticked;
  - the *Content Disclosure Setting*, for promotional or branded content.

  The box reads the account afresh from TikTok each time it is shown. If TikTok
  says the account cannot post right now, the box says so and the upload
  waits.

Continue unlocks once every platform you ticked is written for and has a video.

**3. Schedule.** A calendar of the coming days, starting today: 14 days, or 7 to
14 with *Show N days* (at most 12 while a second time zone is shown). Drag a
platform's icon to another day or hour — a label beside it names the slot under
the pointer — then pick :00, :15, :30 or :45 from the bar that opens; or type
the exact date and time underneath.

- A platform set to *Profiles* in Settings shows its profiles as buttons here:
  pick one to fill in its next day and time.
- *Release immediately* takes a platform off the hours: it shows under today's
  date instead.
- Striped hours are taken: another video of the same brand goes out in them
  (hover one to see which), so nothing of this upload can land there. Continue
  waits while a slot sits in one. Other brands' videos do not count. Tick
  *Override* beside *Today* to use them anyway, for this upload only.
- The dropdown above the hours adds a second time zone's clock.

**4. Review.** The video plays beside exactly what each platform gets and when,
and which account each post goes out as. Warnings show here too, such as a
playlist the channel's connection cannot add to, or another brand's name in a
post's text, the video's file name or its project folder.

- To confirm, press the tick, then press it again within two seconds while it
  shows **!!!**.
- With TikTok in the upload, the tick waits until TikTok's video has played on
  the stage: TikTok asks for a preview before posting. A video from a folder
  plays through the PC worker, so it has to be running.

### Pasting a prepared upload

Text written elsewhere, in a chat with an assistant say, goes in with one
**Ctrl+V** anywhere in flock, as a *flock block*: a JSON object starting with
`"flock": 1`.

```json
{
  "flock": 1,
  "brand": "My brand",
  "product": "The game: its subtitle",
  "thumbnail": "C:/Users/me/Pictures/cover.png",
  "youtube": { "title": "…", "description": "…", "tags": ["…"], "playlists": ["…", "…"], "schedule": "2026-10-13 18:00" },
  "instagram": { "caption": "…", "schedule": "2026-10-13 19:30" },
  "tiktok": { "caption": "…", "schedule": "now" }
}
```

flock opens Upload, switches to the brand, ticks each platform named and fills
it in. A note in the corner says what was filled. With several brands, a
`brand` that matches none (a typo) fills nothing: the note asks which brand it
is for, suggesting the closest one.

- **`product`** fills the *Product name* box on Details.
- **Tags** go into YouTube's *Other* box.
- **`playlists`** takes one title or a list (`"playlist"` works too). A title
  the channel has no playlist for is named in the note.
- **`schedule`** is local time, or `"now"`. It fills the Schedule step, where
  you can still change it.
- **`thumbnail`** is the cover image for Instagram, Facebook and TikTok, read
  by the worker from its own disk (JPEG or PNG, up to 8 MB).
- **Never filled:** TikTok's audience, interaction and disclosure choices.
  Those are picked by hand on every post.

Anything else on the clipboard pastes as usual.

### Project folders

A project folder holds one subfolder per video. Add project folders in
Settings, local or on the network, like watch folders.

- **A subfolder becomes a project when a `flock.json` appears in it**, within
  a second or two (the worker watches the folders). That file is a flock
  block, as above. In it, a bare file name like `"thumb.png"`
  means an image in the same subfolder.
- **New projects** in the sidebar lists them. Click one to open Upload, filled
  from the file, with the subfolder's videos in a *Project Folder* box.
- **One video for every platform:** a folder with a single video has it picked;
  with several, you choose.
- **Progress is kept.** Click the project again later, after a restart or on
  another computer, and it is where you left it. TikTok's choices are made
  again.
- **If `flock.json` changes**, the Project Folder box offers to fill from it
  again.
- **Once uploaded**, the project leaves the list and the worker renames
  `flock.json` to `flock_uploaded.json`. A new `flock.json` in the same folder
  starts a new project.
- **Not uploading it?** *Take it off the list* in the Project Folder box.

### Other screens

**Dashboard**, at the top of the sidebar, opens over whatever page you are on,
and flock opens on it; its arrow points back while it is open. Click it again,
press Esc or go to another page to close it. For the brand in view it shows
what follows. Right-click a brand's button for its **month over month**:
views, likes and comments in each whole month of the last year against the
month before, all platforms together and each below, with the month still
running on top, judged by what its days so far come to over the whole month —
YouTube's from YouTube Analytics, Instagram's from its account insights,
Facebook's and TikTok's only for months flock read from their first day.
*Graph* at the top draws each of the three as a line over every month flock
has.

- **One filter for all of it:** the timeframe (the last 30 days by default,
  up to 180), which platforms (all of them is *Combined*), which kinds (Shorts,
  long form, live) and whether unlisted, private and hidden videos are shown. Every
  number on the page counts only the videos out in the timeframe. Click it to
  change it; the choice is kept per browser.
- **Today, this week, this month, this quarter and this year:** videos out,
  the views on them and the followers gained (or lost) on every platform
  together, shortened from 1,000 up (80.6k). Hover the views for the exact
  figure, the views gained and each platform's share, and the followers for
  each platform's. These count every video the filter
  keeps, whatever its timeframe. Followers count from when the worker first
  read each account.
- **Every video:** YouTube videos and Instagram reels, with a video posted to
  both as one row (the same upload, or posted within two hours of each other).
  Followers, views, likes and comments show the total and each platform's
  below. *Followers* are those a video brought: Facebook counts them per reel
  itself. YouTube and Instagram only say how many an account has, so each rise
  in that count is credited to the videos gaining views at the time, in
  proportion (the newest video when none was). Hover a number to see where it
  came from. Videos out before the worker first read an account show —. Counts
  from 1,000 up are shortened (1.2k, 85.8k, 102k); hover one for the exact
  figure. A line shows its views from release, with what is usual for its kind
  dashed. *vs usual* gives one arrow for every platform together, with how far
  off the usual it is, and each platform's arrow below it: ahead (green), about
  usual (grey) or behind (yellow). *Skipped* is the share of views dropped at
  the start: Instagram's estimate of those skipped within the first 3 seconds,
  and YouTube's plays that never became an engaged view, together on top and
  each below (weighed by views). A fresh reel shows — until Instagram has a
  figure, a Short until YouTube Analytics has caught up, about two days. Sort by
  any column — best first, click it again for the other way round; click a video for everything YouTube
  and Instagram report about it, and to play it. It plays the copy flock filed
  in the upload's NAS folder, streamed by the NAS worker; a video sent from the
  browser plays from flock's own copy when the worker cannot. Click the
  picture to play or pause. Hover the speaker for the volume (top right
  before it plays, so you can set it first; ↑ ↓ work too, and the browser
  remembers it). The full-screen button, a double-click or F goes full
  screen and Esc comes back. A video that did not go out through flock has no
  copy to play. A number that has moved since you opened the
  dashboard turns green, as in `940 (+9)`; the refresh button (the two
  arrows at the top right) resets those.
- **The status icon** (ⓘ, top right): green when all is well, yellow when a
  limit is half used, orange when it is nearly used, red on an error or a
  limit used up. Hover it for when each platform was last read, YouTube's
  quota for the day and Instagram's posts in the last 24 hours.
- **Stored on the NAS**, folded away at the bottom: the newest uploads, with a
  delete per upload (press it twice).
- **Renaming a video:** press the pencil at the top right twice within two
  seconds (■ stops editing), then the pencil beside a title. Type the new name and tick where it
  goes — *All platforms*, or some only; the worker renames it within seconds
  and each platform's line says when it is done. YouTube renames the title
  (51 units of the day's quota); on Facebook the caption's first line is the
  name and the rest of the caption stays. Instagram and TikTok are listed but
  cannot be ticked: neither lets an app change a post once it is out.
- **Hiding a video**, a test post say: in edit mode, press the eye in front of
  its title. It leaves the list, the totals, the periods and what counts as
  usual, for every browser; *Undo* in the pink banner brings the last one back.
  The eye hides the video's posts on the platforms in view: with all of them
  (*Combined*) that is the whole video, with one platform chosen only its post
  there — the way to take a test reel off a real Short it was paired with by
  time. In edit mode hidden videos stay in the list, faded and left out of the
  totals, so you can press their (shut) eye to bring one back for good;
  *Hidden* in the filter shows them outside edit mode too.
- **Jestr campaigns**, with the Jestr integration on: a *Jestr* column ticks
  the videos that are campaign videos. An upload is marked with the *Jestr
  campaign* box on the Details step (shown for YouTube, Instagram and TikTok);
  older videos are marked in edit mode (the pencil at the top right) with a
  click per video.

TikTok's numbers are read once its accounts are signed in with
`--with-stats`, and Facebook's views once its Pages grant `read_insights`.
When each platform was last read, and today's YouTube quota, sit behind the
ⓘ at the top right.

**Calendar** shows every release on a grid of all 24 hours, starting two days
before today: 14 days, or 7 to 14 from *Show N days*. Each upload is one small
box of its platforms' icons in its hour, past ones without a fill, and the
current hour is marked in pink; hover a box to read every post of that upload.
It opens read-only: press *Edit* twice within two seconds, then drag an icon
to move that platform's post, or a box's grip (its left edge) to move the
whole upload, to another day or hour at least 15 minutes ahead. In Edit mode
each box also shows its upload's product name under the icons: the part
before a colon, and a name typed in capitals in normal capitals. A YouTube
video or Facebook reel already uploaded moves there too: the worker gives the
platform the new time within seconds. Right-click any post of an upload to
release all of it at once or delete it, or tick the platforms to release or
delete just those; each button takes three presses within two seconds apiece,
and a post already out is left out and says why on hover. A YouTube video or
Facebook reel waiting on the platform is put out or deleted there by the
worker. A post that can no longer move, because it is out or
about to go out, shakes and says why. With several brands, buttons on top show
one brand or all.

The same menu's *Edit this upload* opens it in Upload with everything filled
in — each post's text as typed, its options, time and cover, and the video
already stored — and confirming there saves over it; Review lists what saving
will change first. A post flock still holds (Instagram and TikTok until just
before their time) changes completely, a different video included. A YouTube
video already uploaded takes a new title, description, tags and playlists,
and a Facebook reel a new caption and cover, from the worker; given another
video, either is deleted there and uploaded again. A post that is out, or about to go out, opens locked and
says why. TikTok's audience and the other choices it wants made by hand are
picked again.

**Log** lists every change with its time and the machine that made it. Filter
by category, search, or click a machine to see only its entries. It cannot be
edited or cleared. Its *Worker* tab shows the worker's output live, kept for 14
days: the place to look when a post did not come out as asked.

Each upload in the Log says, per post, whether it was sent to go out
*Immediately* or *Scheduled* for a slot. Click it to open its overview. It
shows the video (click its name to play it), each post's text as typed and as
sent, every setting, the account and the slot as confirmed, and the warnings
the Review step showed. Beside that is what happened next: each post's state
and link, and everything the worker logged about the upload. Uploads from
before flock 0.12.0 show what their stored upload still holds, with
*Immediately* or *Scheduled* worked out from the stored times (dashed).

**An upload made for the wrong brand** can be moved from its overview: under
*Brand*, pick where it goes (with two brands, the button already names the
other one), read what will happen to each post, and press *Move to …* three
times, each within two seconds. The worker does it within seconds:

- A post nothing was sent for yet just goes out as the new brand's account.
- A YouTube video or Facebook reel already on the old account is deleted
  there, then uploaded again to the new one. Before its slot nobody has seen
  it; after, its views and comments go with it. The YouTube channel needs the
  connection made with `--with-playlists`, which can delete.
- An Instagram reel held for its slot is stopped before it is posted. One
  already live stays up (flock cannot delete it; do it in Instagram) and is
  posted again on the new account.
- TikTok posts are not moved.

**To finish**, in the sidebar, is a box for what needs attention and for
YouTube videos with something left to do by hand: green with a check when
nothing needs doing now, a yellow-to-pink outline with an exclamation mark when
something does, and **solid red, slowly pulsing, when a post did not go out**
(it failed, or its slot passed and it was never sent). It turns **gold, with a
wobbling medal, when a video is doing far better than usual** (below); only red
outranks that. The number under it is how many things are listed. Click it to
open the list over the page.

- **Needs attention** comes first, for every brand: failed posts, posts never
  sent, uploads that hang, videos not yet copied to the NAS, a private YouTube
  video given a slot, a reel that went out without its cover, a stopped
  worker, a TikTok or Instagram account that
  cannot post while posts wait for it, and YouTube's stats or quota. Each post
  shows its platform and brand and links to the upload's overview in the Log;
  *Dismiss* takes it off the list once dealt with (the Log keeps it). The rest
  go by themselves once fixed.
- A failed post has **Retry** too, here and on its overview in the Log: press it
  twice within two seconds to send it again. It goes out at its slot if that is
  still ahead (the button shows the time), or at once if it has passed. A post
  the platform already has a link for is never retried.
- A **gold row** celebrates a video doing far better than usual: its views on
  YouTube, Instagram and TikTok added up (Facebook is not counted) are at least
  half as much again as the middle of the brand's top 15% from the last 30 days.
  It shows the views per platform and how much better it did; the gold
  checkmark takes it off the list. Only the brands chosen under *Finishing steps
  for* are celebrated, and a brand needs at least ten other videos in those 30
  days before any is.
- Each video row has the thumbnail (hover it to see it larger), the title (opens the
  video), whether YouTube reports paid promotion (green $ ticked, red not) and,
  beside it, whether the reel's Paid partnership label was marked done here
  (Instagram does not report it), and
  what is left by hand: the YouTube mark for Studio and, when the upload has
  an Instagram reel, the Instagram mark for its Paid partnership label (only
  the Instagram app can add it) — each a yellow dot while open, a check once
  done, a grey ring while the reel is not out yet. *Open in Studio* opens the
  video in YouTube Studio and counts both as done; the label itself is added
  in the Instagram app on a phone (the website cannot). Reels going out from
  20 Oct 2026 on are listed. A legend in the list's top right says what
  each mark and colour means. Only Shorts get a row: long videos and live
  streams are never listed.
- From confirm until YouTube has the video, the row shows a turning ring:
  the upload went through, and YouTube is still to answer.
- With the **Jestr integration** on (off by default; its switch is not part
  of the published app), every Short on a
  connected channel is listed with a *Jestr* button; press it once the video is
  linked on [Jestr](https://jestr.gg). A scheduled video's button works once it
  is public.
- With several brands, the chips at the top (*Finishing steps for*) choose
  whose finishing steps and Jestr buttons are listed; the brands left out show
  only posts that failed or were never sent. The choice applies to every
  computer using flock.
- Settings → *Other* can hide it, for a clean screen recording, say.
  Nothing on it is lost.

### Settings

**General** is shared by every brand:

- *Storage and defaults:* the NAS folders finished videos are copied to (the
  filled circle marks the default), the watch folders, the project folders, and
  this browser's name.
- *Brands:* add, rename, order and delete brands, and pick each brand's
  accounts. Deleting a brand keeps its uploads, and anything queued still goes
  out.
- *Dashboard:* the columns of the Dashboard's list of videos. Drag them into
  order in the preview, or move them one place at a time below it, and untick
  any you do not want. The thumbnail and the title always lead.
- *Other:* YouTube's official branding, whether the *To finish* Indicator
  shows (each of its states is drawn there with what it means), and extra time
  zones for the calendar.

**The brand in view** has:

- *Templates:* reusable text, dropped in on Details by typing `{name}`.
- **Per platform:** display order, release timing, default options and
  adaptation rules.
  - A platform switched off here starts unticked on a new upload; you can still
    tick it.
  - **Release timing** is one fixed time, or *Profiles*: named patterns like
    "Horror", each with an optional time and set of weekdays.
  - **Adaptation rules** run top to bottom, each on the result of the one
    before. A box at the bottom tries them on sample text.
  - YouTube's defaults include the video's language and the title's (English
    (US) unless changed).

## The website

`site/` is the source of [flock's website](https://flock-scheduler.netlify.app),
which the developer portals link to: an overview, how it works, the privacy
policy and the terms. It is plain HTML, uploaded by hand to a static host; edit
it here and upload the folder again.

## Where things live

- **Videos, schedules, settings and the log** are in PocketBase. A video copied
  to a NAS folder is copied, never moved.
- **Nothing is written before you confirm an upload**, except a project's
  progress, which is kept as you go.
- **In the browser** only: its name, the brand in view, the video arrangement
  and view choices such as filters.
