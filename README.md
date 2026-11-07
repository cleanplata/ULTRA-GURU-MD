# ULTRA GURU WhatsApp Bot

This is the ULTRA GURU bot repository: [`GuruhTech/ULTRA-GURU`](https://github.com/GuruhTech/ULTRA-GURU). Runtime defaults use the configured ULTRA GURU name, GuruTech owner label, bot image, WhatsApp channel, and current GitHub repository. Existing Heroku config vars remain in place when a new commit is deployed.

<p align="center">
  <a href="https://fork.gurutech.top"><img height="36" alt="Deploy ULTRA GURU" src="https://img.shields.io/badge/DEPLOY%20ULTRA%20GURU-00b8ff?style=for-the-badge&amp;logo=rocket&amp;logoColor=white"></a>
  <a href="https://dashboard.katabump.com/auth/login#f98658"><img height="36" alt="Deploy on KataBump" src="https://img.shields.io/badge/DEPLOY%20ON%20KATABUMP-4169E1?style=for-the-badge&amp;logo=rocket&amp;logoColor=white"></a>
  <a href="https://github.com/GuruhTech/ULTRA-GURU/fork"><img height="36" alt="Fork ULTRA GURU" src="https://img.shields.io/badge/FORK%20REPOSITORY-1E90FF?style=for-the-badge&amp;logo=github&amp;logoColor=white"></a>
  <a href="https://ultra-guru-pair-1.onrender.com/pair"><img height="36" alt="Get a guest session" src="https://img.shields.io/badge/GUEST%20SESSION-00b8ff?style=for-the-badge&amp;logo=link&amp;logoColor=white"></a>
</p>

## Folder layout

- `Guru Tech/` contains the bot runtime, configuration, startup helpers, and utility modules.
- `Guru/` contains command modules and shared feature/translation code.
- The repository root keeps the Heroku/npm manifests, environment sample, and deployment documentation.

## Replies, connection status, and menu

Text and media replies use a quoted contact-card style branded as ULTRA GURU with the configured owner label. It does not claim Meta/WhatsApp verification or include another project's identity or a hard-coded phone number. Reactions, deletions, and standalone contact payloads are not changed by the reply wrapper.

After each successful WhatsApp connection (including after a restart), the bot sends a short table with the bot name, connection status, current mode, detected host, `HOSTING_URL`, and a WhatsApp mention of the linked account. It sends the official WhatsApp Channel as a separate rich preview card using the bot image instead of printing the channel URL as plain text. The table is sent to `OWNER_NUMBER` when configured, otherwise to the linked account's own chat.

The `.menu` command displays the configured bot image with a numbered category index; category results also use the bot image. The menu lists each canonical command and its working aliases as separate callable names. The repository currently defines 174 primary command names plus 156 aliases (328 unique invocation names); aliases dispatch to their existing handlers rather than representing separate implementations. Reply to the menu with a category number (for example, `1`) within 10 minutes, or use `.menu <number>` / `.menu <category>` directly.

The owner-only `.mod public`, `.mod private`, and `.mod group only` commands switch modes immediately; `.mode` and `.setmode` are aliases. Group-only mode allows commands in groups and lets the owner use `.mod` in a private chat to change the mode back. A command change is runtime-only: after a dyno restart, set `MODE` in the host's Config Vars to retain the desired mode.

Owner-only administration commands include `.update` (check the configured GitHub repository for its latest commit), `.security` (show active protections), and `.antidelete`, `.antiedit`, `.autoview`, and `.autolike` with `on` or `off` (change that feature for the current process). The feature toggles reset when the process restarts; configure the corresponding host Config Vars for persistent settings. `.update` is intentionally a read-only check and never downloads or executes repository code from inside WhatsApp. To deploy an update, use the hosting provider's deployment controls; for automatic deployment after a GitHub push, enable the provider's GitHub auto-deploy integration. A process restart by itself does not fetch new source code.

## Media commands

- `.play <song name or YouTube link>` searches for the song, sends its thumbnail/details first, then sends a standard MP3 audio message (`ptt: false`) intended for native WhatsApp playback. It tries the configured downloader, then the secondary `ytDl3` API, then optional local yt-dlp; API calls are capped at 12 seconds and local extraction at 45 seconds. Final MP3s are limited to 15 MB. The two external APIs can be unavailable, and local extraction may be blocked by YouTube account verification. The optional yt-dlp wrapper needs Python 3.11+ when installed; see its [install requirements](https://github.com/microlinkhq/youtube-dl-exec/blob/main/scripts/preinstall.js).
- `.compress` on a video caption, or as a reply to a video, re-encodes it as WhatsApp-compatible H.264/AAC MP4. Source videos over 150 MB or results over 64 MB are rejected.
- `.tomp3` (also `.toaudio`) converts a video to audio; `.trim`, `.sticker`, and `.toimg` provide additional media conversion tools.

## WhatsApp session and LID

A WhatsApp session credential is required to connect the bot. Set **one** of `SESSION` or `SESSION_ID` in Heroku Config Vars. Both accepted formats are:

- `SESSION`: base64-encoded `creds.json`.
- `SESSION_ID`: `GURU~` followed by base64-encoded gzip-compressed `creds.json`. For compatibility, `SESSION_ID` also accepts plain base64-encoded `creds.json`.

The bot converts either accepted value to the local Baileys credential file at startup. A session ID is a secret login credential: keep it in Heroku Config Vars; never paste it into source code or commit it to GitHub.

`USER_LID` is **optional**. A LID is WhatsApp's account identifier used to resolve messages in newer WhatsApp addressing modes; it is not a login credential and is not needed to create the WhatsApp connection. When the bot connects, it learns the linked account's LID automatically. `OWNER_NUMBER` is also optional if commands are run from the linked bot account; set it only if you want to identify a separate owner contact. Do not commit a real phone number or LID to the repository.

## Heroku

The included `Procfile` starts the bot with `node "Guru Tech/index.js"`. Existing Heroku config vars persist when Heroku deploys a new commit. Check that either `SESSION_ID` or `SESSION` is configured before restarting the dyno. Useful optional vars include `OWNER_NAME`, `BOT_NAME`, `BOT_PIC`, `CHANNEL_JID`, `CHANNEL_URL`, `HOSTING_URL`, `HOSTING_PROVIDER`, and `GITHUB_REPO`; defaults are provided in `Guru Tech/config.js` and `app.json`.

The root route (`/`) confirms the Node process is responding. `/health` reports the WhatsApp connection state (`503` while disconnected, `200` after it connects). In Heroku logs, look for `[AUTH] Session format accepted: ...` followed by `Connected to WhatsApp` to confirm session decoding and connection. A deployment can succeed while WhatsApp authentication still fails, so both log messages matter.

## Local development

Use Node.js 20 or newer. Copy `.env-sample` to `.env`, set a valid session in one supported format, then run:

```sh
npm install
npm start
```

`.env`, auth files, and generated logs are excluded by `.gitignore`.
