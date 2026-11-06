// ════════════════════════════════════════════════════════════════════════════
//  BOOT — auto-detects available memory on whatever host this runs on
//  (Heroku, Railway, Render, a VPS panel, bare metal, Docker, anywhere) and
//  launches index.js with a safe --max-old-space-size automatically.
//  No manual configuration required.
// ════════════════════════════════════════════════════════════════════════════

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const MIN_HEAP_MB = 150;   // never go below this, even on tiny hosts
const MAX_HEAP_MB = 2048;  // sane ceiling so a huge host doesn't over-allocate
const HEAP_FRACTION = 0.6;  // heap gets 60% of detected memory; the rest is left for buffers, sharp, ffmpeg and native code

// index.js lives one level up, at the project root
const ENTRY_FILE = path.join(__dirname, "..", "index.js");

function readCgroupLimitBytes() {
    // cgroup v2 (modern Docker, most current platforms)
    try {
        const raw = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
        if (raw && raw !== "max") {
            const n = Number(raw);
            if (Number.isFinite(n) && n > 0) return n;
        }
    } catch (_) {}

    // cgroup v1 (older Docker / some panels)
    try {
        const raw = fs
            .readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf8")
            .trim();
        const n = Number(raw);
        // cgroup v1 reports a huge sentinel value (close to 2^63) when unlimited —
        // ignore anything absurdly large, it isn't a real container limit.
        if (Number.isFinite(n) && n > 0 && n < 1e15) return n;
    } catch (_) {}

    return null;
}

function detectMemoryLimitMB() {
    const cgroupBytes = readCgroupLimitBytes();
    if (cgroupBytes) {
        return Math.floor(cgroupBytes / 1024 / 1024);
    }
    // Fall back to the host's total memory (bare VPS, no container limit found)
    return Math.floor(os.totalmem() / 1024 / 1024);
}

function computeHeapMB() {
    // Manual override still works for anyone who wants to force a value
    const override = Number(process.env.NODE_MEM_MB);
    if (Number.isFinite(override) && override > 0) {
        return Math.min(Math.max(override, MIN_HEAP_MB), MAX_HEAP_MB);
    }

    const detectedMB = detectMemoryLimitMB();
    const heapMB = Math.floor(detectedMB * HEAP_FRACTION);
    return Math.min(Math.max(heapMB, MIN_HEAP_MB), MAX_HEAP_MB);
}

const heapMB = computeHeapMB();
const detectedMB = detectMemoryLimitMB();
console.log(`[BOOT] Detected host memory limit ${detectedMB}MB, using --max-old-space-size=${heapMB}`);

// ─── Supervisor ──────────────────────────────────────────────────────────────
// The bot runs as a child process. If it exits for ANY reason (scheduled
// restart, update command, memory restart, crash, OOM-kill of the child) this
// parent starts it again, so the container/panel never goes "offline" and the
// bot never stays dead until someone restarts it by hand.
//
// Exit code 64 means "fatal configuration problem, do not restart" (for
// example no SESSION_ID was supplied).
const EXIT_FATAL = 64;
const STABLE_AFTER_MS = 60_000;   // ran this long = healthy, reset the backoff
const MAX_BACKOFF_MS = 60_000;

let child = null;
let shuttingDown = false;
let quickCrashes = 0;
let startedAt = 0;

function launch() {
    startedAt = Date.now();
    child = spawn(
        process.execPath,
        [`--max-old-space-size=${heapMB}`, "--expose-gc", ENTRY_FILE],
        {
            stdio: "inherit",
            env: {
                ...process.env,
                BOOT_SUPERVISED: "1",
                BOT_MEM_LIMIT_MB: String(detectedMB),
            },
        },
    );

    child.on("exit", (code, signal) => {
        child = null;

        if (shuttingDown) return process.exit(code ?? 0);

        if (code === EXIT_FATAL) {
            console.error("[BOOT] Bot reported a fatal configuration problem — not restarting.");
            return process.exit(0);
        }

        const ranFor = Date.now() - startedAt;
        quickCrashes = ranFor >= STABLE_AFTER_MS ? 0 : quickCrashes + 1;
        const delay = quickCrashes === 0
            ? 2_000
            : Math.min(2_000 * Math.pow(2, quickCrashes - 1), MAX_BACKOFF_MS);

        console.log(
            `[BOOT] Bot exited (code=${code}, signal=${signal}) after ${Math.round(ranFor / 1000)}s — restarting in ${Math.round(delay / 1000)}s...`,
        );
        setTimeout(launch, delay);
    });

    child.on("error", (err) => {
        console.error("[BOOT] Failed to start bot process:", err.message);
    });
}

function shutdown(sig) {
    shuttingDown = true;
    if (child) {
        child.kill(sig);
        // Safety net: never hang forever waiting for the child
        setTimeout(() => process.exit(0), 10_000).unref();
    } else {
        process.exit(0);
    }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

launch();
