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

**Upload** is a three-step flow. Enter a title, a description and a video file, and
tick the platforms you want. Clicking a platform opens its options and a preview of
its adapted title and description. Continue to pick a release day and time per
platform — click a platform on the right, then a day in the calendar. The final
screen lists what each platform gets and when; confirming takes two clicks, and the
upload to the NAS starts there.

**Analytics** is empty for now. Below the placeholder it lists what is currently
stored on the NAS, which is where you check that an upload actually landed.

**Settings** has two parts. *Storage and defaults* holds the NAS folders a finished
video can be moved into (the filled circle marks the default) and the time a newly
scheduled release starts at. Below it, each platform has its display order, its
default publish options, and its adaptation rules; rules run top to bottom and
chain, so order matters, and there is a box at the bottom to try them against
sample text. Unticking a platform there removes it from new uploads entirely — it
stops being listed on the compose screen, though its defaults and rules are kept.

## Where things live

Videos and schedules live in PocketBase on the NAS, in the collections
`upload_jobs`, `upload_targets`, `platform_settings` and `app_settings`. The chosen
destination is recorded on each upload, so changing the destination list later never
moves something already queued. Nothing is stored in the browser, and nothing is
written until you confirm an upload.
