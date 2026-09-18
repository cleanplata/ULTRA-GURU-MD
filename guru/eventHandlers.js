const { getContentType } = require("@whiskeysockets/baileys");
const googleTTS = require("google-tts-api");

const {
    getAllSettings,
    emojis,
    GuruAutoReact,
    GuruAutoBio,
    GuruAntiDelete,
    GuruAnticall,
    GuruPresence,
    GuruChatBot,
    createContext,
    createContext2,
    GuruAntiLink,
    GuruAntibad,
    GuruAntiBot,
    GuruAntiSticker,
    handleGameMessage,
    GuruAntiGroupMention,
    getGroupMetadata,
    GuruAntiEdit,
    DEFAULT_SETTINGS,
} = require(".");
const { buildSuperUsers } = require("./connection/commandHandler");
const { getSudoNumbers } = require("./database/sudo");
const { standardizeJid } = require("./connection/serializer");

const {
    findAntiDelete,
    removeAntiDelete,
    saveAntiDelete,
} = require("./database/messageStore");

async function resolveRealJid(Guru, jid) {
    if (!jid) return null;
    if (!jid.endsWith("@lid")) return jid;
    try {
        const { getLidMapping } = require("./connection/groupCache");
        const cached = getLidMapping(jid);
        if (cached) return cached;
    } catch (_) {}
    try {
        const resolved = await Guru.getJidFromLid(jid);
        if (resolved && !resolved.endsWith("@lid")) return resolved;
    } catch (_) {}
    try {
        const { getLidMappingFromDb } = require("./database/lidMapping");
        const fromDb = await getLidMappingFromDb(jid);
        if (fromDb) return fromDb;
    } catch (_) {}
    return jid;
}

function setupAutoReact(Guru) {
    Guru.ev.on("messages.upsert", async (mek) => {
        try {
            const ms = mek.messages[0];
            if (!ms.message) return;

            const from = ms.key.remoteJid;
            const isChannel = from?.endsWith("@newsletter");
            const s = await getAllSettings();
            const isMyChannel = isChannel && s.NEWSLETTER_JID && from === s.NEWSLETTER_JID;

            // Channel reactions are always on and not controlled by
            // AUTO_REACT / .setautoreact at all — this branch runs
            // unconditionally for the configured channel.
            if (isMyChannel) {
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                await GuruAutoReact(randomEmoji, ms, Guru);
                return;
            }

            // Everything below is normal-chat behavior, gated by AUTO_REACT.
            const autoReactMode = s.AUTO_REACT || "off";
            if (autoReactMode === "off" || autoReactMode === "false" || ms.key.fromMe)
                return;

            const isGroup = from?.endsWith("@g.us");
            const isDm = from?.endsWith("@s.whatsapp.net");

            let shouldReact = false;
            if (autoReactMode === "all" || autoReactMode === "true") {
                shouldReact = true;
            } else if (autoReactMode === "dm" && isDm) {
                shouldReact = true;
            } else if (autoReactMode === "groups" && isGroup) {
                shouldReact = true;
            }

            if (!shouldReact) return;

            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            await GuruAutoReact(randomEmoji, ms, Guru);
        } catch (err) {
            console.error("Error during auto reaction:", err);
        }
    });
}

function setupAntiDelete(Guru) {
    const botJid = `${Guru.user?.id.split(":")[0]}@s.whatsapp.net`;
    const botOwnerJid = botJid;

    const getSender = (ms) => {
        const key = ms.key;
        const realJid = (j) => j && !j.endsWith("@lid") ? j : null;
        return (
            realJid(key.participantPn) ||
            realJid(key.senderPn) ||
            realJid(ms.senderPn) ||
            realJid(key.participant) ||
            realJid(ms.participant) ||
            key.participantPn ||
            key.participant ||
            ms.participant ||
            (key.remoteJid?.endsWith("@g.us") ? null : realJid(key.remoteJid) || key.remoteJid)
        );
    };

    const getPushName = (ms) => {
        return ms.pushName || ms.key?.pushName || ms.verifiedBizName || "Unknown";
    };

    const isProtocolMessage = (ms) => {
        return (
            ms.message?.protocolMessage ||
            ms.message?.ephemeralMessage?.message?.protocolMessage ||
            ms.message?.viewOnceMessage?.message?.protocolMessage ||
            ms.message?.viewOnceMessageV2?.message?.protocolMessage
        );
    };

    const getProtocolMessage = (ms) => {
        return (
            ms.message?.protocolMessage ||
            ms.message?.ephemeralMessage?.message?.protocolMessage ||
            ms.message?.viewOnceMessage?.message?.protocolMessage ||
            ms.message?.viewOnceMessageV2?.message?.protocolMessage
        );
    };

    const getActualMessage = (ms) => {
        const msg = ms.message;
        if (!msg) return null;
        return (
            msg.ephemeralMessage?.message ||
            msg.viewOnceMessage?.message ||
            msg.viewOnceMessageV2?.message ||
            msg.documentWithCaptionMessage?.message ||
            msg
        );
    };

    Guru.ev.on("messages.upsert", async ({ messages }) => {
        for (const ms of messages) {
            try {
                if (!ms?.message) continue;

                const { key } = ms;
                if (
                    !key?.remoteJid ||
                    key.fromMe ||
                    key.remoteJid === "status@broadcast"
                )
                    continue;

                const protocolMsg = getProtocolMessage(ms);
                if (protocolMsg?.type === 0) {
                    const deleteKey = protocolMsg.key;
                    const deletedId = deleteKey?.id;
                    const chatJid = key.remoteJid;

                    if (!deletedId) continue;

                    const deletedMsg = findAntiDelete(chatJid, deletedId);
                    if (!deletedMsg?.message) continue;

                    const deleter = getSender(ms) || key.remoteJid;
                    const deleterPushName = getPushName(ms);

                    if (deleter === botJid || deleter === botOwnerJid) continue;

                    await GuruAntiDelete(
                        Guru,
                        deletedMsg,
                        key,
                        deleter,
                        deletedMsg.originalSender,
                        botOwnerJid,
                        deleterPushName,
                        deletedMsg.originalPushName,
                    );

                    removeAntiDelete(chatJid, deletedId);
                    continue;
                }

                if (isProtocolMessage(ms)) continue;

                const actualMessage = getActualMessage(ms);
                if (!actualMessage) continue;

                const sender = getSender(ms);
                const senderPushName = getPushName(ms);

                if (!sender || sender === botJid || sender === botOwnerJid)
                    continue;

                const _jid = key.remoteJid;
                const _entry = {
                    ...ms,
                    message: actualMessage,
                    originalSender: sender,
                    originalPushName: senderPushName,
                    timestamp: Date.now(),
                };
                setImmediate(() => saveAntiDelete(_jid, _entry));
            } catch (error) {
                console.error("Anti-delete system error:", error);
            }
        }
    });
}

function setupAutoBio(Guru) {
    (async () => {
        const s = await getAllSettings();
        if (s.AUTO_BIO === "true") {
            setTimeout(() => GuruAutoBio(Guru), 1000);
            setInterval(() => GuruAutoBio(Guru), 1000 * 60);
        }
    })();
}

function setupAntiCall(Guru) {
    Guru.ev.on("call", async (json) => {
        await GuruAnticall(json, Guru);
    });
}

function setupPresence(Guru) {
    Guru.ev.on("messages.upsert", async ({ messages }) => {
        if (messages?.length > 0) {
            await GuruPresence(Guru, messages[0].key.remoteJid);
        }
    });

    Guru.ev.on("connection.update", ({ connection }) => {
        if (connection === "open") {
            GuruPresence(Guru, "status@broadcast");
        }
    });
}

function setupChatBotAndAntiLink(Guru) {
    Guru.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type === "append") return;

        const firstMsg = messages[0];
        if (firstMsg?.message) {
            const s = await getAllSettings();
            const gSender = (
                firstMsg.key?.participant || firstMsg.key?.remoteJid || ""
            ).split(":")[0];
            let gIsSuperUser = false;
            try {
                const gSuperUsers = await buildSuperUsers(
                    s,
                    getSudoNumbers,
                    standardizeJid(Guru.user?.id),
                    s.OWNER_NUMBER || "",
                );
                gIsSuperUser = gSuperUsers.includes(gSender);
            } catch (_) {}
            const privateModeActive =
                s.MODE?.toLowerCase() === "private" && !gIsSuperUser;

            if (!privateModeActive && (s.CHATBOT === "true" || s.CHATBOT === "audio")) {
                GuruChatBot(
                    Guru,
                    s.CHATBOT,
                    s.CHATBOT_MODE || "inbox",
                    createContext,
                    createContext2,
                    googleTTS,
                );
            }

            var __privateModeActive = privateModeActive; // used below for handleGameMessage
        }

        for (const message of messages) {
            if (!message?.message) continue;
            const from = message.key?.remoteJid || "";
            if (message.key.fromMe && !from.endsWith("@g.us")) continue;

            if (from.endsWith("@g.us")) {
                await GuruAntiLink(Guru, message, getGroupMetadata);
                await GuruAntibad(Guru, message, getGroupMetadata);
                await GuruAntiBot(Guru, message, getGroupMetadata);
                await GuruAntiSticker(Guru, message, getGroupMetadata);
            }
            await GuruAntiGroupMention(Guru, message, getGroupMetadata);
            // Game replies (tic-tac-toe moves, WCG guesses, dice rolls) are a
            // conversational response like any command, so they must respect
            // private mode too — this listener used to call handleGameMessage
            // unconditionally for every sender, bypassing the MODE check that
            // the normal command pipeline in messageHandler.js already enforces.
            if (!__privateModeActive) {
                await handleGameMessage(Guru, message);
            }
        }
    });
}

function setupAntiEdit(Guru) {
    Guru.ev.on("messages.update", async (updates) => {
        for (const update of updates) {
            try {
                if (!update?.update?.message) continue;
                if (update.key?.fromMe) continue;
                if (update.key?.remoteJid === "status@broadcast") continue;
                await GuruAntiEdit(Guru, update, findAntiDelete);
            } catch (err) {
                console.error("Anti-edit handler error:", err.message);
            }
        }
    });
}

function setupStatusHandlers(Guru) {
    Guru.ev.on("messages.upsert", async (mek) => {
        try {
            mek = mek.messages[0];
            if (!mek || !mek.message) return;

            mek.message =
                getContentType(mek.message) === "ephemeralMessage"
                    ? mek.message.ephemeralMessage.message
                    : mek.message;

            if (mek.key?.remoteJid !== "status@broadcast") return;

            const s = await getAllSettings();

            const rawParticipant =
                mek.participant || mek.key.participantPn || mek.key.participant;
            const participantJid = await resolveRealJid(Guru, rawParticipant);

            const shouldView = s.AUTO_READ_STATUS === "true";

            const readKey =
                participantJid && participantJid !== mek.key.participant
                    ? { ...mek.key, participant: participantJid }
                    : mek.key;

            if (shouldView) {
                const delaySeconds = Number(s.STATUS_VIEW_DELAY) || 0;
                if (delaySeconds > 0) {
                    await new Promise((resolve) =>
                        setTimeout(resolve, delaySeconds * 1000),
                    );
                }
                await Guru.readMessages([readKey]);
            }

            if (
                shouldView &&
                s.AUTO_LIKE_STATUS === "true" &&
                participantJid
            ) {
                const reactSetting = (s.STATUS_REACT_EMOJI || "").trim();
                let reactContent;

                if (reactSetting.toLowerCase() === "name") {
                    // React with the sender's WhatsApp display name instead of an emoji.
                    // Note: this is unofficial — WhatsApp's reaction UI is built for emoji,
                    // so rendering of plain text can vary between client versions.
                    reactContent =
                        mek.pushName || mek.key?.pushName || "Unknown";
                } else if (reactSetting.toLowerCase() === "brand") {
                    // Branded phrase + the date/time the status was viewed, e.g.
                    // "👀 Seen by ULTRA GURU • 14:32 18/09". Same caveat as "name":
                    // unofficial, so a client may reject/mis-render the long text —
                    // the existing fallback-to-emoji retry below still applies.
                    const brandPhrase =
                        (s.STATUS_BRAND_PHRASE || "").trim() ||
                        `👀 Seen by ${s.BOT_NAME || "ULTRA GURU"}`;
                    const tz = s.TIME_ZONE || "Africa/Nairobi";
                    const now = new Date();
                    const timeStr = new Intl.DateTimeFormat("en-US", {
                        hour: "numeric",
                        minute: "numeric",
                        hour12: true,
                        timeZone: tz,
                    }).format(now);
                    const dateStr = new Intl.DateTimeFormat("en-GB", {
                        day: "2-digit",
                        month: "2-digit",
                        timeZone: tz,
                    }).format(now);
                    reactContent = `${brandPhrase} • ${timeStr} ${dateStr}`;
                } else if (reactSetting) {
                    // A fixed custom emoji/text the owner configured with .setreact
                    reactContent = reactSetting;
                } else {
                    // Default: pick randomly from the emoji pool
                    const statusEmojis = (
                        s.STATUS_LIKE_EMOJIS ||
                        "🥼,🏅,🎖️,🧧,🎐,🏅,🏆,🥇,🥈,🏆"
                    )
                        .split(",")
                        .map((e) => e.trim())
                        .filter(Boolean);
                    reactContent =
                        statusEmojis[Math.floor(Math.random() * statusEmojis.length)];
                }

                const fallbackEmoji = () => {
                    const pool = (
                        s.STATUS_LIKE_EMOJIS ||
                        "🥼,🏅,🎖️,🧧,🎐,🏅,🏆,🥇,🥈,🏆"
                    )
                        .split(",")
                        .map((e) => e.trim())
                        .filter(Boolean);
                    return pool[Math.floor(Math.random() * pool.length)];
                };

                const reactKey = { ...mek.key, participant: participantJid };
                const sendReaction = (text) =>
                    Guru.sendMessage(
                        "status@broadcast",
                        { react: { text, key: reactKey } },
                        { statusJidList: [participantJid] },
                    );

                try {
                    await sendReaction(reactContent);
                } catch (reactErr) {
                    // A custom/name reaction can be rejected by some client versions since
                    // it's not an official emoji. Don't lose the reaction — retry once with
                    // a safe emoji from the pool instead of letting it fail silently.
                    const wasCustom = reactContent !== "" && reactSetting !== "";
                    if (wasCustom) {
                        try {
                            await sendReaction(fallbackEmoji());
                        } catch (_) {
                            // give up quietly, same as pre-existing behavior for transient errors
                        }
                    } else {
                        throw reactErr;
                    }
                }
            }

            if (
                shouldView &&
                s.AUTO_REPLY_STATUS === "true" &&
                !mek.key.fromMe &&
                participantJid
            ) {
                await Guru.sendMessage(
                    participantJid,
                    {
                        text:
                            s.STATUS_REPLY_TEXT ||
                            DEFAULT_SETTINGS.STATUS_REPLY_TEXT,
                    },
                    { quoted: mek },
                );
            }
        } catch (error) {
            const code = error?.output?.statusCode || error?.code || "";
            const msg = error?.message || "";
            const transient =
                code === 428 ||
                msg === "Connection Closed" ||
                msg.includes("ECONNRESET") ||
                msg.includes("ETIMEDOUT") ||
                msg.includes("ECONNREFUSED") ||
                msg.includes("EPIPE") ||
                msg.includes("Connection Terminated") ||
                msg.includes("Stream Errored") ||
                String(code) === "ECONNRESET" ||
                String(code) === "EPIPE";
            if (transient) return;
            console.error("Error Processing Status Actions:", error);
        }
    });
}

module.exports = {
    setupAutoReact,
    setupAntiDelete,
    setupAutoBio,
    setupAntiCall,
    setupPresence,
    setupChatBotAndAntiLink,
    setupAntiEdit,
    setupStatusHandlers,
};
