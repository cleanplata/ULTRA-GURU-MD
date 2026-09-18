// ─────────────────────────────────────────────────────────────────────────
//  AUTO TYPING / AUTO RECORDING TOGGLES
//
//  Thin, user-friendly wrappers around the existing DM_PRESENCE /
//  GC_PRESENCE engine (see guru/gmdFunctions2.js -> GuruPresence, and
//  guru/eventHandlers.js -> setupPresence). Those settings already accept
//  "online" / "offline" / "typing" / "recording" via .setdmpresence and
//  .setgcpresence, but require picking one value at a time per scope.
//
//  These commands give a simpler on/off switch for the "typing…" / audio
//  "recording…" indicator, applied to DMs and groups together (or one
//  scope at a time), and turning either "off" just resets presence back
//  to "online" rather than making the bot invisible.
//
//  Note: typing and recording share the same underlying presence value,
//  so enabling one for a scope replaces whichever was active there before.
// ─────────────────────────────────────────────────────────────────────────

const { gmd } = require("../guru/gmdCmds");
const { getSetting, setSetting } = require("../guru/database/settings");

function parseScope(word) {
  const w = (word || "").toLowerCase().trim();
  if (["dm", "chat", "inbox", "pm"].includes(w)) return "dm";
  if (["group", "gc", "grp", "groups"].includes(w)) return "group";
  return "all";
}

async function applyPresence(mode, scope) {
  const applied = {};
  if (scope === "dm" || scope === "all") {
    await setSetting("DM_PRESENCE", mode);
    applied.dm = mode;
  }
  if (scope === "group" || scope === "all") {
    await setSetting("GC_PRESENCE", mode);
    applied.group = mode;
  }
  return applied;
}

function scopeLabel(scope) {
  if (scope === "dm") return "DMs";
  if (scope === "group") return "groups";
  return "DMs and groups";
}

function registerAutoPresenceToggle({ pattern, aliases, presenceMode, label, emoji }) {
  gmd(
    {
      pattern,
      aliases,
      react: emoji,
      category: "owner",
      description: `Toggle auto-${label} indicator for DMs and/or groups`,
    },
    async (from, Guru, conText) => {
      const { args, reply, react, isSuperUser } = conText;
      if (!isSuperUser) return reply("❌ Owner Only Command!");

      const state = (args?.[0] || "").toLowerCase().trim();
      if (state !== "on" && state !== "off") {
        return reply(
          `❌ Usage: .${pattern} <on|off> [dm|group]\n` +
            `Example: .${pattern} on\n` +
            `Example: .${pattern} off group`,
        );
      }

      const scope = parseScope(args?.[1]);
      const mode = state === "on" ? presenceMode : "online";

      try {
        // Skip the write (and the "already set" reply below is still
        // accurate) if every targeted scope already matches.
        const currentDm = await getSetting("DM_PRESENCE");
        const currentGc = await getSetting("GC_PRESENCE");
        const alreadySet =
          (scope === "dm" && currentDm === mode) ||
          (scope === "group" && currentGc === mode) ||
          (scope === "all" && currentDm === mode && currentGc === mode);

        if (alreadySet) {
          return reply(
            `⚠️ Auto-${label} is already *${state.toUpperCase()}* for *${scopeLabel(scope)}*.`,
          );
        }

        await applyPresence(mode, scope);
        await react("✅");

        return reply(
          state === "on"
            ? `✅ Auto-${label} *enabled* for *${scopeLabel(scope)}*.`
            : `✅ Auto-${label} *disabled* for *${scopeLabel(scope)}* (presence reset to online).`,
        );
      } catch (error) {
        await react("❌");
        return reply(`❌ Error: ${error.message}`);
      }
    },
  );
}

registerAutoPresenceToggle({
  pattern: "autotyping",
  aliases: ["autotype", "typingauto"],
  presenceMode: "typing",
  label: "typing",
  emoji: "⌨️",
});

registerAutoPresenceToggle({
  pattern: "autorecording",
  aliases: ["autorecord", "recordingauto"],
  presenceMode: "recording",
  label: "recording",
  emoji: "🎙️",
});
