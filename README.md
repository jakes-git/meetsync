# MeetSync

A free calendar and meeting coordination tool for project teams. No accounts, no server, no bills.

1. **Create a project** with a name and get a random key like `k7qm-x3pd-9fha`.
2. **Join a project** by entering that key (or opening a join link).
3. Add yourself: name, time zone (auto-detected, changeable) and weekly hours of availability.
4. The project page shows a weekly calendar **in your own time zone**, with a colored bar for everyone who's free and a green highlight where everyone is free.
5. Click a person to see their details and availability in **their time and yours**.
6. Click a slot (or **+ New meeting**) to schedule a meeting with some people. "Find a time everyone is free" suggests slots.
7. Copy the **invite link** and send it anywhere. Whoever opens it sees the time in their own time zone and gets one-click buttons for Google Calendar, Apple Calendar, Outlook.com, Microsoft 365, the Outlook desktop app, Yahoo Calendar, and a standard `.ics` file for anything else.

There are no roles: anyone with the key can edit everything. The key isn't hidden in the app, so treat it like a shared door code.

## Why it costs nothing

| Piece | Where it lives | Cost |
|---|---|---|
| Website | Static files on GitHub Pages | Free for public repos |
| Shared project data | Public [Nostr](https://nostr.com) relays (7 of them, for redundancy) | Free, no sign-up |
| Invite pages | Everything is inside the link itself | Nothing stored at all |

There is no backend, database, build step, API key or account of any kind, so there's nothing to renew, patch, or pay for.

## How the data works

- The project key is the only secret. From it the browser derives a signing key (so anyone with the project key can write) and an AES-256-GCM encryption key. Relays only ever see encrypted blobs, and can't tell what project or people they belong to.
- Each record (project name, each person, each meeting) is its own replaceable Nostr event (kind 30078), so two people editing different things at the same time never overwrite each other. For the same record, the latest edit wins.
- Every browser that opens a project keeps a copy on the device and re-sends anything a relay is missing, so the data heals itself if a relay drops it or goes away. Edits made offline are sent once you're back online.
- Invite links carry the meeting (title, time, length, place, notes, attendee names) in the part after `#`, which browsers never send to any server.

**Caveats:** public relays are run by volunteers and make no promises; using several and re-sending on every visit is how MeetSync stays resilient. Anyone who has the project key can read and change the project. Clearing browser data removes only that device's copy and "who am I" choice.

## Files

```
index.html            app shell
invite.html           public invite page
assets/app.js         UI: home, project calendar, people, meetings
assets/store.js       encrypted sync over Nostr relays + local cache
assets/tz.js          time zone math using the browser's Intl API
assets/invite-data.js invite link encoding, calendar links, .ics files
assets/invite.js      invite page
assets/style.css      styles (light and dark)
assets/vendor/nostr.js  bundled nostr-tools 2.25.2 (signing), Unlicense
```

## Running locally

It's plain static files; serve the folder with anything, e.g. `python3 -m http.server`, and open http://localhost:8000.
To test against your own relay, add `?relays=ws://localhost:7777` to the URL.

## Deploying

Live at **https://meetandsync.github.io/**. GitHub Pages serves the `main` branch of `meetandsync/meetandsync.github.io`, so every push to `main` publishes.

To host a copy elsewhere, push to a public GitHub repo and turn on **Settings › Pages › Deploy from a branch**. Any other static host (Cloudflare Pages, Netlify, Codeberg Pages) works the same way.
