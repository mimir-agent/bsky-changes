# bsky-changes

A daily report of changes to the Bluesky social graph around one or more
accounts. It prints only what changed since the last run, and prints nothing
at all when nothing changed, so it fits a daily cron job that emails you only
on days with news.

## What it reports

The report opens with one summary line across all accounts, then has one
section per account that changed, written as short sentences. The email is
multipart: an HTML part where every account, list and starter pack is a link
on its name, and a plain-text part with names and handles only. Links open in
the [Blacksky](https://blacksky.community) client, which uses the same paths
as bsky.app (`/profile/<did>`, `/profile/<did>/lists/<rkey>`,
`/starter-pack/<did>/<rkey>`). Stdout gets
the plain text. It covers:

- **New followers and unfollows.** Read from `app.bsky.graph.getFollowers` on
  the public AppView (`https://public.api.bsky.app`) and compared with the
  last saved list of follower DIDs.
- **Blocked you / unblocked you.** Blocks are public records, but the AppView
  does not say who blocks whom. These come from the
  [Constellation](https://constellation.microcosm.blue) backlink index: every
  `app.bsky.graph.block` record whose `subject` is the account.
- **Added to / removed from block lists.** Moderation lists the account was
  added to or removed from, found through Constellation
  (`app.bsky.graph.listitem` records whose `subject` is the account). Only
  lists whose purpose is `app.bsky.graph.defs#modlist` are kept; curation
  lists and reference lists do not block or mute anyone. A list item only
  counts when it lives in the list owner's own repository. Each line names the
  list and its owner.
- **Added to / removed from starter packs.** For every other list the account
  is on, the starter packs built on that list (`app.bsky.graph.starterpack`
  records whose `list` is the list, from Constellation). A pack only counts
  when it lives in the list owner's repository; the owner is the account that
  made the pack. Each line names the pack and its owner.
- **Block subscribers per moderation list.** Who started or stopped
  subscribing to block each of those lists (`app.bsky.graph.listblock` records
  whose `subject` is the list).
- **New followers who joined through a starter pack that includes you.** For
  each new follower, if their profile says they signed up through a starter
  pack and that pack's list includes the watched account, the line reads
  `<name> joined Bluesky through the starter pack <pack> by <owner>.`

Accounts are shown by display name, or by @handle when they have none. When
one account did something it gets both, like `Skalman (@skalman.example.com)
blocked you.` Up to 8 accounts are joined into one sentence; more are listed
one per line under a line like `14 new followers:`.

The first run for an account records a baseline and reports nothing.

Example plain-text output (all names made up):

```
2 new followers, 1 new block, 1 block list addition and 1 starter pack addition across 2 accounts.

@alice.example.com
2 new followers: Bob and @carol.example.com.
Skalman (@skalman.example.com) blocked you.
Dave added you to the block list Spam accounts.
Erin added you to the starter pack Cider makers.
```

## Limits

Read these before trusting a line in the report.

- **Starter packs.** Bluesky records only the one starter pack someone signed
  up through. It does not record which pack, if any, led to a particular
  follow. So the starter pack section catches new Bluesky users who joined
  through a pack containing you and then followed you. It misses existing
  users who followed you from a pack, and a follower who joined through a
  pack containing you may have found you some other way.
- **Constellation coverage can lag or have gaps.** It indexes the network
  firehose as records arrive. A block or list change can show up late, and
  records it never saw are not in it. Counts can differ from other tools.
- **If Constellation is down**, the report still covers followers and says
  that blocks, block lists and starter packs could not be
  checked. The saved state for those sections is kept, so the next good run
  compares against it.
- **Block subscribers are counted per list, not per person.** Someone who
  blocks you directly and also subscribes to a list you are on appears in
  both sections.
- **Deleted and suspended accounts** have no profile on the AppView. They are
  shown by DID, or by their last known handle for unfollows.
- **Deleted moderation lists** read as "removed from block lists", and deleted
  starter packs (or their deleted lists) read as "removed from starter packs".
- **Upgrading.** State files written before starter packs were tracked have no
  starter pack baseline; the first run after upgrading records one and reports
  nothing for that section.
- **Followers** come from the AppView, so its count may differ from the
  number shown on the profile.

## Setup

Needs Node 24 or newer. TypeScript runs directly through Node's type
stripping; there is no build step.

```sh
git clone https://github.com/mimir-agent/bsky-changes
cd bsky-changes
npm ci
mkdir -p ~/.config/bsky-changes
cp config.example.json ~/.config/bsky-changes/config.json
# edit the config, then:
npm start -- --dry-run --verbose
```

Config and state live outside the repository. The config file defaults to
`~/.config/bsky-changes/config.json`; pass `--config PATH` to use another.

```json
{
  "accounts": ["alice.example.com", "alice-alt.bsky.social"],
  "stateDir": "~/.local/state/bsky-changes",
  "email": {
    "to": "alice@example.com"
  }
}
```

- `accounts`: handles to watch.
- `stateDir`: where snapshots are kept, one JSON file per account, named by
  DID so a handle change keeps its history. Delete a file to start that
  account over with a new baseline.
- `email.to`: where `--email` sends the report. Only needed with `--email`.

## Usage

```
npm start -- [options]

  --config PATH  config file (default: ~/.config/bsky-changes/config.json)
  --email        send the report by email instead of printing it
  --dry-run      do everything except saving state and sending email
  --verbose      print per-account counts to stderr (no names)
  --help         show help
```

Note that `--dry-run` saves no state, so two dry runs in a row on a fresh
state directory both record (and discard) a baseline.

Without `--email` the report goes to stdout. With `--email`, it is sent over
SMTP. The subject is `Bluesky changes, <YYYY-MM-DD>` (UTC date) and the Date
header is the machine's local time with its UTC offset. It needs these
environment variables:

- `EMAIL_ADDRESS`: sender address and SMTP user
- `EMAIL_PASSWORD`: SMTP password
- `EMAIL_SMTP_HOST`: SMTP server
- `EMAIL_SMTP_PORT`: 587 for STARTTLS (required; the connection fails rather
  than send in plain text), or 465 for implicit TLS

Credentials are read only from the environment and are never printed.
No email is sent on a day with no changes.

Exit codes: 0 when every account was checked, 1 when any account could not be
checked or the email failed, 2 for a bad config or bad options.

Daily cron example:

```
0 8 * * * cd /path/to/bsky-changes && npm start --silent -- --email
```

## Politeness

At most 4 requests are in flight at once. Requests that get 429 or a 5xx
answer, or fail at the network level, are retried up to 3 times with
exponential backoff, honoring `Retry-After`. Requests carry a `User-Agent`
naming this project, as Constellation asks.

## Development

```sh
npm run check   # typecheck and tests
```

Tests use in-memory fixtures and make no network calls.

## License

MIT
