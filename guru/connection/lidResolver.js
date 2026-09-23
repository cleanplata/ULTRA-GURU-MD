"use strict";

// ─────────────────────────────────────────────────────────────────────────
//  resolveTargetJid — turn an @lid identifier into a real @s.whatsapp.net
//  JID using a group's participant list, in one reusable place instead of
//  duplicating the same lookup logic inside every command that needs to
//  resolve a target user (.block, .unblock, .kick, .promote, .demote, ...).
//
//  Each group participant object can carry both its internal id (often the
//  @lid form) and its real linked number (`pn`) once WhatsApp has shared it:
//    { id: "123456789@lid", lid: "123456789@lid", pn: "15551234567@s.whatsapp.net" }
//
//  Returns:
//    - rawJid unchanged if it's already a real @s.whatsapp.net JID
//    - the matched real JID if rawJid is an @lid found in participants
//    - null if it's an @lid with no match in the given participant list
//      (caller should then try a live lookup or tell the user honestly)
// ─────────────────────────────────────────────────────────────────────────
function resolveTargetJid(rawJid, participants = []) {
    if (!rawJid) return null;
    if (!rawJid.endsWith("@lid")) return rawJid; // already a real JID

    const match = participants.find((p) => {
        const pLid = p.lid || (p.id && p.id.endsWith("@lid") ? p.id : null);
        return pLid === rawJid;
    });

    if (match) {
        const real =
            match.pn ||
            match.jid ||
            (match.id && match.id.endsWith("@s.whatsapp.net") ? match.id : null);
        if (real) return real;
    }

    return null; // no match — still unresolved
}

module.exports = { resolveTargetJid };
