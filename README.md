# flock

Write one title, one description, point it at a video file, and schedule that video
out to YouTube, Instagram, TikTok and Facebook — each with its own release day and
time, and its own text adaptations.

Each platform has quirks: a link that works on one gets a post buried on another, a
hashtag style that reads fine here looks broken there. Rather than maintaining four
copies of every description, you write one and give each platform a list of
"replace X with Y" rules. flock applies them and shows you exactly what each
platform will receive before anything is sent.

On confirmation the video is uploaded to a PocketBase instance on the NAS, along
with one scheduled entry per platform. The idea is that publishing happens later
from the NAS, so this machine does not need to be online at release time.

**The platform connections do not exist yet.** Nothing is published anywhere. The
per-platform publish options are invented placeholders that exist so the interface
can be judged before the real APIs are wired up. Uploads to the NAS, the schedules
and the adaptation rules are all real and persist.

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

## Using it

**Name the browser first.** Nothing can be uploaded or changed until you do — the
Log records which machine made every change, and it cannot do that for an unnamed
browser. flock asks on first open. The name is unique across your machines and
cannot be changed afterwards, so pick one you will recognise later. Each browser
needs its own; the name is stored locally, so opening flock from a different
address counts as a different browser.

**Upload** is a three-step flow. Enter a title, a description and a video file, and
tick the platforms you want. Clicking a platform opens its options and a preview of
its adapted title and description. Continue to a week calendar showing a card per
platform: drag a card to another day or hour to move that release, or use the exact
date and time fields underneath. The final
screen shows a still of the video with what each platform gets and when; confirming
takes two clicks, and the copy to the NAS starts there.

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
