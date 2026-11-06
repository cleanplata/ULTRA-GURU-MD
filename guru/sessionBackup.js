// ════════════════════════════════════════════════════════════════════════════
//  SESSION BACKUP
//
//  Hosts like Heroku wipe the filesystem on every restart, which deleted
//  guru/session/session.db. The bot then restarted from the old SESSION_ID
//  snapshot taken on pairing day. Its signal keys no longer matched what
//  WhatsApp had on record, so the bot looked online but could not decrypt
//  messages, or WhatsApp rejected it as a bad session.
//
//  When DATABASE_URL (PostgreSQL) is set, this module keeps a compressed copy
//  of the live session in the database and restores it on a fresh filesystem.
//  Without DATABASE_URL it does nothing, because the SQLite file would live on
//  the same wiped disk and backing it up there would help no one.
//
//  Every function is wrapped so a backup problem can never stop the bot.
// ════════════════════════════════════════════════════════════════════════════

"use strict";

const fs   = require("fs");
const path = require("path");
const zlib = require("zlib");

const config = require("./config");

const SESSION_DB_PATH = path.join(__dirname, "session", "session.db");
const BACKUP_ID       = "main";
const BACKUP_EVERY_MS = 5 * 60 * 1000;

let _timer = null;
let _lastBackupAt = 0;
let _ready = false;

const enabled = () => !!config.DATABASE_URL;

const getDb = () => require("./database/database").DATABASE;

const gmd = () => require("./gmdFunctions");

async function ensureTable() {
    if (_ready) return;
    await getDb().query(
        "CREATE TABLE IF NOT EXISTS session_backup (" +
        "id VARCHAR(20) PRIMARY KEY, " +
        "sid_hash VARCHAR(64), " +
        "payload TEXT, " +
        "updated_at BIGINT)"
    );
    _ready = true;
}

// Call once after the database is up and BEFORE the socket starts.
async function restoreIfNeeded() {
    if (!enabled()) return false;
    try {
        const { sessionDbHasCreds, importSessionRows, hashSessionId } = gmd();

        // The disk still has a session: it is newer than any backup.
        if (sessionDbHasCreds(SESSION_DB_PATH)) return false;

        const sidHash = hashSessionId(process.env.SESSION_ID);
        if (!sidHash) return false;

        await ensureTable();
        const [rows] = await getDb().query(
            "SELECT sid_hash, payload, updated_at FROM session_backup WHERE id = :id",
            { replacements: { id: BACKUP_ID } },
        );
        const row = rows && rows[0];
        if (!row || !row.payload) return false;

        // Only restore a backup that belongs to THIS SESSION_ID. If the owner
        // pasted a new one, the old backup must not come back.
        if (row.sid_hash !== sidHash) {
            console.log("ℹ️ [SessionBackup] Backup belongs to a different SESSION_ID — ignoring it.");
            return false;
        }

        const json = zlib.gunzipSync(Buffer.from(row.payload, "base64")).toString("utf8");
        const data = JSON.parse(json);
        if (!Array.isArray(data) || data.length === 0) return false;

        importSessionRows(SESSION_DB_PATH, data, sidHash);
        const ageMin = Math.round((Date.now() - Number(row.updated_at || 0)) / 60000);
        console.log(`♻️ [SessionBackup] Restored session from database (${data.length} entries, saved ${ageMin} min ago).`);
        return true;
    } catch (err) {
        console.error("⚠️ [SessionBackup] Restore failed:", err.message);
        return false;
    }
}

// Save the live session now (skips when nothing changed unless force is set).
async function backupNow(force = false) {
    if (!enabled()) return false;
    try {
        const { exportSessionRows, hashSessionId } = gmd();

        if (!force) {
            // Skip when session.db and its WAL file have not been touched since the last backup.
            const times = [SESSION_DB_PATH, SESSION_DB_PATH + "-wal"].map((f) => {
                try { return fs.statSync(f).mtimeMs; } catch (_) { return 0; }
            });
            if (Math.max(...times) <= _lastBackupAt) return false;
        }

        const rows = exportSessionRows();
        if (!rows || rows.length === 0) return false;

        // Never overwrite a good backup with a session that has no creds yet.
        if (!rows.some((r) => r.id === "creds")) return false;

        const sidHash = hashSessionId(process.env.SESSION_ID);
        if (!sidHash) return false;

        const payload = zlib.gzipSync(Buffer.from(JSON.stringify(rows), "utf8")).toString("base64");
        const now = Date.now();

        await ensureTable();
        await getDb().query(
            "INSERT INTO session_backup (id, sid_hash, payload, updated_at) " +
            "VALUES (:id, :hash, :payload, :ts) " +
            "ON CONFLICT (id) DO UPDATE SET " +
            "sid_hash = EXCLUDED.sid_hash, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at",
            { replacements: { id: BACKUP_ID, hash: sidHash, payload, ts: now } },
        );
        _lastBackupAt = now;
        return true;
    } catch (err) {
        console.error("⚠️ [SessionBackup] Backup failed:", err.message);
        return false;
    }
}

function start() {
    if (!enabled() || _timer) return;
    _timer = setInterval(() => { backupNow(false); }, BACKUP_EVERY_MS);
    _timer.unref();
    console.log("💾 [SessionBackup] Session is backed up to the database every 5 minutes.");
}

// Remove the stored copy (used when WhatsApp logs the device out).
async function clearBackup() {
    if (!enabled()) return;
    try {
        await ensureTable();
        await getDb().query("DELETE FROM session_backup WHERE id = :id", { replacements: { id: BACKUP_ID } });
    } catch (err) {
        console.error("⚠️ [SessionBackup] Clear failed:", err.message);
    }
}

module.exports = { restoreIfNeeded, backupNow, start, clearBackup };
