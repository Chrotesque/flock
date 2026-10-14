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
- reads YouTube's and Instagram's numbers for the Dashboard, and scores titles
  with vidIQ if you set that up.

A platform you have not set up just leaves its releases waiting in the queue.

Start from the example config. It will hold your client secrets, and git
ignores it:

```bash
cp worker/.worker-config.example.json worker/.worker-config.json
```

### YouTube

In the [Google Cloud console](https://console.cloud.google.com):

1. Create a project and enable **YouTube Data API v3** (*APIs & Services →
   Library*).
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
  `pnpm worker:auth --with-playlists` to have videos added to a playlist.
  Without it the playlist is skipped, and the Review step says so.
- **Thumbnails and paid promotion are set in YouTube Studio**, not by flock.
  *To finish* in the sidebar links each video's Studio page.
- **Stats cost API quota.** The Dashboard's YouTube numbers come from the
  newest 50 videos, read every 30 seconds: about a third of the daily quota
  that uploads also use. `statsSeconds`, `statsVideos` and `statsBudget` in the
  config adjust it; at the budget, polling pauses until the quota resets, so
  uploads are never short.

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
- `pnpm worker:tiktok` shows who each account posts as and which audiences it
  offers.

Limits:

- **Private accounts only, until TikTok approves your app for public posting**
  (its app review, then its Content Posting API audit). Until then, posts are
  visible to the account alone.
- **Videos:** MP4, MOV or WebM, under 4 GB.
- **Cover:** a frame of the video, set as *Cover frame* in TikTok's options.
  TikTok takes no cover image.

### Instagram

Every video goes out as a Reel: MP4 or MOV, under 1 GB, 3 seconds to 15
minutes. The worker uploads it ten minutes before its slot
(`instagramLeadSeconds`) and publishes it on the minute.

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
  `instagram.configId`.
- `pnpm worker:instagram` shows each account and how much of its daily
  allowance (100 posts) is used.
- **Covers:** a cover image is placed on your Page as an *unpublished* photo
  (it never appears there), handed to Instagram, then deleted. If that fails,
  the reel uses its *Cover frame*.
- **Reel views:** with `instagram_manage_insights` granted, the worker also
  reads each account's newest 100 posts and their views every 10 minutes, into
  PocketBase's `post_stats` (`igStatsPosts`, `igStatsSeconds`; 0 turns it off).
  No screen shows them yet.

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

- **Covers:** a cover image becomes the reel's cover on the Page. If Facebook
  refuses it, the reel goes out with a frame Facebook picks, and the post's
  entry in the Log says why.

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
- `FLOCK_RESTART_ON_UPDATE=1`, so it restarts itself on a new version.

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

The boxes on the right follow the platform you are writing for:

- **Instagram and Facebook:** an optional *Cover* image for the reel (JPEG or
  PNG, up to 8 MB for Instagram and 10 MB for Facebook). One image serves both;
  the switch in the box's corner gives each its own.
- **YouTube:** a playlist, from the channel's own playlists.
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
- The dropdown above the hours adds a second time zone's clock.

**4. Review.** The video plays beside exactly what each platform gets and when,
and which account each post goes out as. Warnings show here too, such as a
playlist the channel's connection cannot add to.

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
  "thumbnail": "C:/Users/me/Pictures/cover.png",
  "youtube": { "title": "…", "description": "…", "tags": ["…"], "playlist": "…", "schedule": "2026-10-13 18:00" },
  "instagram": { "caption": "…", "schedule": "2026-10-13 19:30" },
  "tiktok": { "caption": "…", "schedule": "now" }
}
```

flock opens Upload, switches to the brand, ticks each platform named and fills
it in. A note in the corner says what was filled.

- **Tags** go into YouTube's *Other* box.
- **`schedule`** is local time, or `"now"`. It fills the Schedule step, where
  you can still change it.
- **`thumbnail`** is the reel cover for Instagram and Facebook, read by the
  worker from its own disk (JPEG or PNG, up to 8 MB).
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
press Esc or go to another page to close it. For the brand in view it shows:

- **One filter for all of it:** which platforms (all of them is *Combined*),
  which kinds (Shorts, long form, live) and whether unlisted and private videos
  are shown. Click it to change it; the choice is kept per browser.
- **Today, this week and this month:** videos out, the views on them and the
  views gained, with each platform's share below.
- **Coming up:** the next three days, each upload a cluster of platform icons.
  Hover one for its title and each post's time and state; click it for the
  upload's overview. The Calendar has the rest.
- **Every video:** YouTube videos and Instagram reels, with a video posted to
  both as one row (the same upload, or posted within two hours of each other).
  Views, likes and comments show the total and each platform's below. A line
  shows its views from release, with what is usual for its kind dashed, and
  an arrow per platform says whether it is ahead (green), about usual (grey)
  or behind (yellow). Sort by any column; click a video for everything YouTube
  and Instagram report about it. A number that has moved since you opened the
  dashboard turns green, as in `940 (+9)`; *Refresh* resets those.
- **Stored on the NAS**, folded away at the bottom: the newest uploads, with a
  delete per upload (press it twice).

TikTok and Facebook views are not read yet. When each platform was last read,
and today's YouTube quota, sit at the top right.

**Calendar** shows every release on a week grid; past ones are greyed out, and
a toggle hides them. It opens read-only: press *Edit* twice within two seconds,
then drag an upcoming release to another day or hour. Past releases stay
locked. With several brands, buttons on top show one brand or all.

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

**To finish**, in the sidebar, is a box for what needs attention and for
YouTube videos with something left to do by hand: green with a check when
nothing needs doing now, a yellow-to-pink outline with an exclamation mark when
something does, and **solid red, slowly pulsing, when a post did not go out**
(it failed, or its slot passed and it was never sent). The number under it is
how many things are listed. Click it to open the list over the page.

- **Needs attention** comes first, for every brand: failed posts, posts never
  sent, uploads that hang, videos not yet copied to the NAS, a private YouTube
  video given a slot, a stopped worker, a TikTok or Instagram account that
  cannot post while posts wait for it, and YouTube's stats or quota. Each post
  shows its platform and brand and links to the upload's overview in the Log;
  *Dismiss* takes it off the list once dealt with (the Log keeps it). The rest
  go by themselves once fixed.
- A failed post has **Retry** too, here and on its overview in the Log: press it
  twice within two seconds to send it again. It goes out at its slot if that is
  still ahead (the button shows the time), or at once if it has passed. A post
  the platform already has a link for is never retried.
- Each video row has the thumbnail (hover it to see it larger), the title (opens the
  video), whether YouTube reports paid promotion (green $ ticked, red not), and
  a *Studio* button opening the video in YouTube Studio — a yellow dot until it
  was opened from here, a check after.
- From confirm until YouTube has the video, the row shows a turning ring:
  the upload went through, and YouTube is still to answer.
- With the **Jestr integration** on (Settings → *Other*), every video on a
  connected channel is listed with a *Jestr* button; press it once the video is
  linked on [Jestr](https://jestr.gg). A scheduled video's button works once it
  is public.
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
- *Other:* YouTube's official branding, the Jestr integration, whether
  *To finish* shows, and extra time zones for the calendar.

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
