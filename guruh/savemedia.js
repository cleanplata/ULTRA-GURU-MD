const { gmd, getMediaBuffer, standardizeJid } = require("../guru");

gmd(
    {
        pattern: "save",
        aliases: ["inbox", "grab", "keep"],
        react: "📥",
        category: "tools",
        description: "Send quoted media to your own DM",
        usage: "Reply to any media with .save; the media is sent to your DM",
    },
    async (from, Guru, conText) => {
        const { mek, reply, react, sender } = conText;

        const rawRecipient = sender || (from?.endsWith("@g.us") ? "" : from);
        const requesterJid = standardizeJid(rawRecipient);

        if (!requesterJid || requesterJid.endsWith("@g.us")) {
            await react("❌");
            return reply("❌ I couldn't identify your private WhatsApp chat. Try using *.save* from your DM.");
        }

        const quotedRaw =
            mek.message?.extendedTextMessage?.contextInfo ||
            mek.message?.imageMessage?.contextInfo ||
            mek.message?.videoMessage?.contextInfo ||
            mek.message?.audioMessage?.contextInfo ||
            mek.message?.documentMessage?.contextInfo ||
            mek.message?.stickerMessage?.contextInfo ||
            null;

        if (!quotedRaw?.quotedMessage) {
            await react("❌");
            return reply("❌ Reply to a media message (image, video, audio, document, sticker) with *.save*");
        }

        let msg = quotedRaw.quotedMessage;

        if (msg.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
        else if (msg.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
        else if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;

        const hasMedia =
            msg.imageMessage ||
            msg.videoMessage ||
            msg.audioMessage ||
            msg.documentMessage ||
            msg.stickerMessage;

        if (!hasMedia) {
            await react("❌");
            return reply("❌ No media found in the quoted message.");
        }

        await react("⏳");

        try {
            if (msg.imageMessage) {
                const buffer = await getMediaBuffer(msg.imageMessage, "image");
                await Guru.sendMessage(requesterJid, {
                    image: buffer,
                    caption: msg.imageMessage.caption || "📥 *Saved to your inbox*",
                });

            } else if (msg.videoMessage) {
                const buffer = await getMediaBuffer(msg.videoMessage, "video");
                await Guru.sendMessage(requesterJid, {
                    video: buffer,
                    caption: msg.videoMessage.caption || "📥 *Saved to your inbox*",
                });

            } else if (msg.audioMessage) {
                const buffer = await getMediaBuffer(msg.audioMessage, "audio");
                await Guru.sendMessage(requesterJid, {
                    audio: buffer,
                    mimetype: "audio/mpeg",
                    ptt: msg.audioMessage.ptt || false,
                });

            } else if (msg.documentMessage) {
                const buffer = await getMediaBuffer(msg.documentMessage, "document");
                await Guru.sendMessage(requesterJid, {
                    document: buffer,
                    fileName: msg.documentMessage.fileName || "document",
                    mimetype: msg.documentMessage.mimetype || "application/octet-stream",
                    caption: msg.documentMessage.caption || "📥 *Saved to your inbox*",
                });

            } else if (msg.stickerMessage) {
                const buffer = await getMediaBuffer(msg.stickerMessage, "sticker");
                await Guru.sendMessage(requesterJid, { sticker: buffer });
            }

            await react("✅");
            await reply("✅ Media sent to your DM!");

        } catch (err) {
            console.error("[SaveMedia] Error:", err.message);
            await react("❌");
            await reply("❌ Failed to save media. Try again.");
        }
    }
);
