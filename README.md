# flock

> [!IMPORTANT]
> ## 🚧 In active development 🚧
>
> I use flock every day while I build it, and `master` moves fast. Now and
> then a commit breaks something; a fix usually follows within hours. If
> something stops working, check the latest commits or pull again later.

flock schedules a video out to YouTube, Instagram, TikTok and Facebook, with
its own text and its own release time for each platform.

- **Write for each platform separately.** YouTube and Facebook take a title
  and a description, Instagram and TikTok a caption.
- **Automate the edits you always make.** Each platform can have "replace X
  with Y" rules, applied when you confirm.
- **See exactly what goes out** before anything is sent.
- **Your PC can be off at release time.** The video and the schedule go to a
  PocketBase instance (on a NAS, say), and a worker publishes from there.

YouTube, TikTok and Instagram publish for real. Facebook does not yet: its
options are placeholders.

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
- reads YouTube's numbers for Analytics, and scores titles with vidIQ if you
  set that up.

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
  The sidebar's *To finish* list links each video's Studio page.
- **Stats cost API quota.** Analytics reads the newest 50 videos every 30
  seconds, about a third of the daily quota that uploads also use. `statsSeconds`,
  `statsVideos` and `statsBudget` in the config adjust it; at the budget,
  polling pauses until the quota resets, so uploads are never short.

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
- It is unsigned, so Windows may warn the first time.

On Windows the build also writes **`flock-worker-background.exe`**, which runs
without a window:

- It shows the flock icon in the notification area: double-click to open
  flock, right-click to open the log or stop it.
- To start it with Windows, put a shortcut to it in the Startup folder (Win+R,
  `shell:startup`).
- `flock-worker-background.exe --stop` stops it too.
- It logs to `flock-worker.log` beside itself.

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

- **Instagram:** an optional *Cover* image for the reel (JPEG or PNG, up to
  8 MB).
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
21 with *Show N days*. Drag a platform's card to another day or hour, or type
the exact date and time underneath.

- A platform set to *Profiles* in Settings shows its profiles as buttons here:
  pick one to fill in its next day and time.
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
- **`thumbnail`** is the Instagram reel's cover, read by the worker from its own
  disk (JPEG or PNG, up to 8 MB).
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

**Dashboard** opens from the round button in the top-left corner of every
page. It comes out of the corner when the pointer gets near; click it to cover
the page, and click it again (or press Esc) to close. For the brand in view it
shows:

- **Today, this week and this month:** videos out on YouTube and the views on
  them, the views the channel gained, and posts on Instagram and TikTok.
- **Needs attention:** failed posts, posts never sent, uploads that hang,
  videos not yet copied to the NAS, a stopped worker, and the like. Each links
  to the upload's overview in the Log.
- **Coming up:** the next seven days of posts, empty days included.
- **Latest releases:** the five newest videos, their first two days as a line,
  and whether they are ahead of what the channel usually has at that age.
- **System** and **Waiting:** the workers, YouTube's quota, Instagram's daily
  posts, and what is waiting to be uploaded.

Each box is a widget. Drag it by the grip in its corner to move it (or focus
the grip and use the arrow keys), and click the width button beside it to make
it a third, half, two thirds or the full width. The arrangement is kept per
browser; *Reset layout* puts it back. The numbers are read each time the
dashboard opens and every 30 seconds while it is open.

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

**Analytics** shows the newest 50 videos on the channel of the brand in view,
refreshed every 30 seconds while the worker runs.

- Click a video for everything YouTube reports about it.
- Filter by Shorts, long form or live, and show or hide unlisted and private
  videos. Choices are remembered.
- A number that has moved since you opened the page turns green, as in
  `940 (+9)`. Refresh resets those.
- Below, a list of what is stored on the NAS, with a delete per upload.

**To finish**, in the sidebar, lists YouTube videos with something left to do
by hand.

- The title opens the video, and the YouTube icon its page in Studio.
- From confirm until YouTube has the video, the line shows a turning ring:
  the upload went through, and YouTube is still to answer.
- With the **Jestr integration** on (Settings → *Other*), every video on a
  connected channel is listed with a *Jestr* button; press it once the video is
  linked on [Jestr](https://jestr.gg). A scheduled video's button works once it
  is public.
- Settings → *Other* can hide the list, for a clean screen recording, say.
  Nothing on it is lost.

### Settings

**General** is shared by every brand:

- *Storage and defaults:* the NAS folders finished videos are copied to (the
  filled circle marks the default), the watch folders, the project folders, and
  this browser's name.
- *Brands:* add, rename, order and delete brands, and pick each brand's
  accounts. Deleting a brand keeps its uploads, and anything queued still goes
  out.
- *Other:* YouTube's official branding, the Jestr integration, whether the
  *To finish* list shows, and extra time zones for the calendar.

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
