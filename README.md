# ULTRA GURU WhatsApp Bot

This repository contains the bot code from the supplied Flash-Md-V3 archive, adapted for the existing `cleanplata/ULTRA-GURU-MD` deployment. Runtime defaults retain the current bot name, owner name, profile image, WhatsApp channel JID/link, and GitHub repository. Existing Heroku config vars remain in place when the source is updated.

## WhatsApp session and LID

A WhatsApp session credential is required to connect the bot. Set **one** of `SESSION` or `SESSION_ID` in Heroku Config Vars. The bot accepts both formats:

- `SESSION`: the Flash-Md-V3 format, base64-encoded `creds.json`.
- `SESSION_ID`: the existing ULTRA GURU format, `GURU~` followed by base64-encoded gzip-compressed `creds.json`. For compatibility, `SESSION_ID` also accepts the plain base64 format.

The bot converts either accepted value to the local Baileys credential file at startup. A session ID is a secret login credential: keep it in Heroku Config Vars, never paste it into source code or commit it to GitHub.

`USER_LID` is **optional**. A LID is WhatsApp's account identifier used to resolve messages in newer WhatsApp addressing modes; it is not a login credential and is not needed to create the WhatsApp connection. When the bot connects, it learns the linked account's LID automatically. `OWNER_NUMBER` is also optional if commands are run from the linked bot account; set it only if you want to identify a separate owner contact. Do not commit a real phone number or LID to the repository.

## Heroku

The included `Procfile` starts the bot with `node index.js`. Existing Heroku config vars persist when Heroku deploys a new commit. Check that either `SESSION_ID` or `SESSION` is configured before restarting the dyno. Useful optional vars include `OWNER_NAME`, `BOT_NAME`, `BOT_PIC`, `CHANNEL_JID`, and `CHANNEL_URL`; defaults are provided in `config.js` and `app.json`.

The root route (`/`) confirms the Node process is responding. `/health` reports the WhatsApp connection state (`503` while disconnected, `200` after it connects). In Heroku logs, look for `[AUTH] Session format accepted: ...` followed by `Connected to WhatsApp` to confirm session decoding and connection. A deployment can succeed while WhatsApp authentication still fails, so both log messages matter.

## Local development

Use Node.js 20 or newer. Copy `.env-sample` to `.env`, set a valid session in one supported format, then run:

```sh
npm install
npm start
```

`.env`, auth files, and generated logs are excluded by `.gitignore`.
