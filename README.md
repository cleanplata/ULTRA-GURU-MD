# ULTRA GURU WhatsApp Bot

This is the ULTRA GURU bot repository: [`cleanplata/ULTRA-GURU-MD`](https://github.com/cleanplata/ULTRA-GURU-MD). Runtime defaults use the configured ULTRA GURU name, GuruTech owner label, bot image, WhatsApp channel, and current GitHub repository. Existing Heroku config vars remain in place when a new commit is deployed.

## Folder layout

- `Guru Tech/` contains the bot runtime, configuration, startup helpers, and utility modules.
- `Guru/` contains command modules and shared feature/translation code.
- The repository root keeps the Heroku/npm manifests, environment sample, and deployment documentation.

## Reply style and menu

Text and media replies use the quoted contact-card style from the supplied mini-bot, branded as ULTRA GURU with the configured owner label. It does not claim Meta/WhatsApp verification or include another project's identity or a hard-coded phone number. Reactions, deletions, and standalone contact payloads are not changed by the reply wrapper.

The `.menu` command displays a numbered category index. Reply to that menu with a category number (for example, `1`) within 10 minutes to see its commands. You can also use `.menu <number>` or `.menu <category>` directly.

## WhatsApp session and LID

A WhatsApp session credential is required to connect the bot. Set **one** of `SESSION` or `SESSION_ID` in Heroku Config Vars. Both accepted formats are:

- `SESSION`: base64-encoded `creds.json`.
- `SESSION_ID`: `GURU~` followed by base64-encoded gzip-compressed `creds.json`. For compatibility, `SESSION_ID` also accepts plain base64-encoded `creds.json`.

The bot converts either accepted value to the local Baileys credential file at startup. A session ID is a secret login credential: keep it in Heroku Config Vars; never paste it into source code or commit it to GitHub.

`USER_LID` is **optional**. A LID is WhatsApp's account identifier used to resolve messages in newer WhatsApp addressing modes; it is not a login credential and is not needed to create the WhatsApp connection. When the bot connects, it learns the linked account's LID automatically. `OWNER_NUMBER` is also optional if commands are run from the linked bot account; set it only if you want to identify a separate owner contact. Do not commit a real phone number or LID to the repository.

## Heroku

The included `Procfile` starts the bot with `node "Guru Tech/index.js"`. Existing Heroku config vars persist when Heroku deploys a new commit. Check that either `SESSION_ID` or `SESSION` is configured before restarting the dyno. Useful optional vars include `OWNER_NAME`, `BOT_NAME`, `BOT_PIC`, `CHANNEL_JID`, `CHANNEL_URL`, and `GITHUB_REPO`; defaults are provided in `Guru Tech/config.js` and `app.json`.

The root route (`/`) confirms the Node process is responding. `/health` reports the WhatsApp connection state (`503` while disconnected, `200` after it connects). In Heroku logs, look for `[AUTH] Session format accepted: ...` followed by `Connected to WhatsApp` to confirm session decoding and connection. A deployment can succeed while WhatsApp authentication still fails, so both log messages matter.

## Local development

Use Node.js 20 or newer. Copy `.env-sample` to `.env`, set a valid session in one supported format, then run:

```sh
npm install
npm start
```

`.env`, auth files, and generated logs are excluded by `.gitignore`.
