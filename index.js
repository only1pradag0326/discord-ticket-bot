// ============================================
// INVINCIBLE EATS — FINAL BOT FILE (STANDARD FORMAT)
// ============================================

require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");
const express = require("express");

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  AttachmentBuilder,
  ChannelType,
} = require("discord.js");

// ============================================
// EXPRESS HOST (for transcripts + attachments)
// ============================================

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// IMPORTANT IDs (FROM YOU)
// ============================================

// Status / Orders
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID || "1386956979632734238";
const STATUS_ANNOUNCE_CHANNEL_ID = process.env.STATUS_ANNOUNCE_CHANNEL_ID || "1386924126844879008";
const ORDER_PERMS_CHANNEL_ID = process.env.ORDER_PERMS_CHANNEL_ID || "1386924125834051737";


// Status channel display names (used by Auto-Close rename)
const OPEN_STATUS_CHANNEL_NAME = process.env.OPEN_STATUS_CHANNEL_NAME || "│status-🟢";
const BREAK_STATUS_CHANNEL_NAME = process.env.BREAK_STATUS_CHANNEL_NAME || "│status-🟡";
const CLOSED_STATUS_CHANNEL_NAME = process.env.CLOSED_STATUS_CHANNEL_NAME || "│status-🔴";
// Customer base + tiers
const HERO_IN_TRAINING_ROLE_ID = process.env.HERO_IN_TRAINING_ROLE_ID || "1386924124860846131"; // everyone gets this
const VERIFIED_BUYER_ROLE_ID = "1396954121780854874";
const FREQUENT_BUYER_ROLE_ID = "1396955746108833842";
const VILTRUMITE_ROLE_ID = "1394179600187261058"; // Diamond tier
const ONE_TIME_20_OFF_ROLE_ID = "1386924124433023063"; // 20% OFF - REMOVE AFTER USE

// Staff roles (complete list)
const JUSTICE_CHEF_ROLE_ID = "1386924124873556029";          // existing
const INVINCIBLE_CHEF_ROLE_ID = "1386924124873556038";       // existing
const JUSTICE_CHEF_ON_PATROL_ROLE_ID = "1386924124873556030";
const UE_CHEF_ROLE_ID = "1386924124860846137";
const DD_CHEF_ROLE_ID = "1386924124860846135";

// Transcript log + UE tickets
const TRANSCRIPT_LOG_ID = "1386924127041880081";
const UBER_TICKETS_CHANNEL = "1386924125834051744";

// Auto-ban announcements (link spam)
// Where the bot posts the "User was banned" embed.
const AUTO_BAN_ANNOUNCE_CHANNEL_ID = "1386924127222497350";

// Bump + TicketTool
const DISBOARD_BOT_ID = "302050872383242240";
const TICKETTOOL_BOT_ID = "557628352828014614"; // Ticket Tool bot (global)

// Staff role list (used for opener detection & anti-promo bypass)
const STAFF_ROLE_IDS = [
  JUSTICE_CHEF_ROLE_ID,
  INVINCIBLE_CHEF_ROLE_ID,
  JUSTICE_CHEF_ON_PATROL_ROLE_ID,
  UE_CHEF_ROLE_ID,
  DD_CHEF_ROLE_ID
];

// ============================================
// STORAGE SYSTEM
// ============================================

const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

const payStore = readJson("pay.json", {});                // staffId -> { name, methods: { MethodName: value } }
const bumpStore = readJson("bumps.json", {});             // guildId -> { channelId, intervalMin, lastBumpTs, pingRoleId?, pingUserId? }
const ticketCfgStore = readJson("ticket_config.json", {}); // guildId -> { ticketCategoryId?, ticketNamePrefix?, ticketLogChannelId? }

// Multi-server configuration (optional). If you invite this bot to other servers,
// run /server_setup there to point the bot at that server's channels/roles.
// guildId -> {
//   statusChannelId, ordersChannelId, heroRoleId,
//   announceChannelId, patrolRoleId, justiceChefRoleId, calcRoleId
// }
const serverCfgStore = readJson("server_config.json", {});
// (Note) Only one store instance; do not duplicate this declaration.
const vouchByStaff = readJson("vouches_by_staff.json", {});  // staffId -> count
const vouchByCust = readJson("vouches_by_customer.json", {}); // customerId -> count

// Global host config (lets you set the public URL used for transcript links)
const hostCfg = readJson("host_config.json", { publicBaseUrl: "" });

// ============================================
// DIRECTORIES
// ============================================

const TRANSCRIPT_DIR = path.join(__dirname, "transcripts");
const ATTACH_DIR = path.join(__dirname, "attachments");

fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
fs.mkdirSync(ATTACH_DIR, { recursive: true });

// ============================================
// EXTERNAL BASE URL
// ============================================

function externalBase() {
  // Preferred: saved config (so you don't need to set env vars)
  if (hostCfg?.publicBaseUrl) return String(hostCfg.publicBaseUrl).replace(/\/$/, "");

  // Best practice: set PUBLIC_BASE_URL to your bot's public URL (no trailing slash).
  // Example (Replit): https://your-repl-name.your-user.replit.dev
  const explicit =
    process.env.PUBLIC_BASE_URL ||
    process.env.BOT_PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL;

  if (explicit) return String(explicit).replace(/\/$/, "");

  // Replit (dev domain)
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;

  // Replit (prod / deployments) often provide a comma-separated domain list
  if (process.env.REPLIT_DOMAINS) {
    const first = String(process.env.REPLIT_DOMAINS).split(",")[0].trim();
    if (first) return `https://${first}`;
  }

  // Some environments provide a full URL already
  if (process.env.REPLIT_URL) return String(process.env.REPLIT_URL).replace(/\/$/, "");

  return `http://localhost:${PORT}`;
}


// ============================================
// DISCORD CLIENT
// ============================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.User, Partials.GuildMember]
});

// ============================================
// UTILS
// ============================================

const sleep = ms => new Promise(res => setTimeout(res, ms));
const fmtMoney = n =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n ?? 0);

function isLikelyVouchChannel(channel) {
  try {
    const name = String(channel?.name || "").toLowerCase();
    return name.includes("vouch");
  } catch {
    return false;
  }
}

function slugifyUsername(name) {
  return (name || "user")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function extractTicketNumberFromChannel(name = "") {
  const m = name.match(/(\d{3,})$/);
  return m ? m[1] : null;
}

function isTicketChannel(name = "") {
  return /^ticket-\d+$/i.test(name) || /-invincible-\d+$/i.test(name);
}

// Simple anti-promo patterns
// IMPORTANT: Do NOT include a generic /https?:\/\// pattern.
// That deletes *every* link (including DoorDash / Uber Eats order links).
const PROMO_PATTERNS = [
  /amazon\s+review/i,
  /paypal\s+refund/i,
  /review\s+partners?/i,
  /\bcoupon\b/i,
  /\bpromo\b/i,
  /\bverification\s*service\b/i,
  /discord\.gg\//i,
  /t\.me\//i,
  /wa\.me\//i,
  /\b5\s*star\b/i,
  /\bjoin\s+my\s+server\b/i,
  /\bcash\.app\//i,
  /\bcheaper\b/i
];

// ✅ Allow customers to post THESE order links (Uber Eats group orders + DoorDash carts)
// These are allowed even though we delete most promo/URL spam.
// We intentionally allow optional protocol so "drd.sh/..." won't get nuked if Discord strips/rewrites.
// ✅ Uber Eats group order allowlist
// Matches BOTH common domains:
// - https://www.ubereats.com/group-orders/<id>/join?... (or similar)
// - https://eats.uber.com/group-orders/<id>/join?...      (common share link)
// Keep this strict so we only allow *group order* links (not random Uber links).
const UE_REGEX = /https?:\/\/((www\.)?ubereats\.com|eats\.uber\.com)\/group-?orders?\/[^\s]+/i;
const UE_SHORT_REGEX = /https?:\/\/(ubereats\.app\.link|u\.ber|t\.uber\.com)\/[^\s]+/i;

// ========================
// CALCULATOR (CUSTOMER PAY)
// ========================
// Default service fee (you can change this)
const DEFAULT_SERVICE_FEE = 9;

// Role-based fee discounts (applied to the service fee).
// Adjust these numbers to match your server's rules.
const DISCOUNT_RULES = [
  { roleId: VILTRUMITE_ROLE_ID, label: "VILTRUMITE", feeDiscount: 9 },     // fee becomes $0
  { roleId: FREQUENT_BUYER_ROLE_ID, label: "Frequent Buyer", feeDiscount: 2 },
  { roleId: VERIFIED_BUYER_ROLE_ID, label: "Verified Buyer", feeDiscount: 1 }
];

function getBestFeeDiscountForMember(member) {
  if (!member) return { label: null, amount: 0 };
  for (const rule of DISCOUNT_RULES) {
    if (!rule?.roleId) continue;
    if (member.roles?.cache?.has(rule.roleId)) {
      return { label: rule.label, amount: Number(rule.feeDiscount || 0) };
    }
  }
  return { label: null, amount: 0 };
}

const DOORDASH_REGEX = /(?:https?:\/\/)?(?:www\.)?doordash\.com\/[^\s]+/i;
const DOORDASH_SHORT_REGEX = /(?:https?:\/\/)?(?:www\.)?drd\.sh\/[^\s]+/i;

const ORDER_LINK_ALLOWLIST = [UE_REGEX,
  UE_SHORT_REGEX, DOORDASH_REGEX, DOORDASH_SHORT_REGEX];

// ========================
// AUTO-BAN LINK SPAM (NON-STAFF)
// ========================
// Enabled by default. Set BAN_LINKS_ENABLED=false to disable.
const BAN_LINKS_ENABLED = String(process.env.BAN_LINKS_ENABLED ?? "true").toLowerCase() === "true";

// Ban reason shown in the server audit log.
const BAN_LINK_REASON =
  process.env.BAN_LINK_REASON ||
  "Automatic moderation: posted a prohibited link (anti-spam).";

// Detect Discord invites even without protocol.
const DISCORD_INVITE_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s]+/i;

// Detect any http/https URL.
const ANY_HTTP_URL_REGEX = /https?:\/\/[^\s]+/i;

function firstLinkSnippet(text = "") {
  const m = text.match(DISCORD_INVITE_REGEX) || text.match(ANY_HTTP_URL_REGEX);
  return m ? m[0].slice(0, 180) : "";
}


// Avatar helper


function safeAvatarUrl(user) {
  try {
    return user.displayAvatarURL({ extension: "png", size: 64 });
  } catch {
    return "";
  }
}

// HTML escape
function escapeHTML(s = "") {
  return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Attachment helpers
function localAttachPath(name) {
  return path.join(ATTACH_DIR, name);
}
function localAttachUrl(name) {
  return `${externalBase()}/attachments/${encodeURIComponent(name)}`;
}

// File download
async function downloadTo(filePath, url) {
  const res = await axios({ method: "GET", url, responseType: "stream" });
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(filePath);
    res.data.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });
}

// ============================================
// STATUS GUARD & WATCHDOG
// ============================================

// Prevent OPEN unless Justice Chef is online
async function enforceStatusGuard(message) {
  try {
    if (!message.guild) return;
    const cfg = getServerCfg(message.guild.id);
    if (message.channel.id !== cfg.statusChannelId) return;

    const raw = (message.content || "").toLowerCase();
    const embedText =
      (message.embeds?.[0]?.description || message.embeds?.[0]?.title || "").toLowerCase();

    const text = raw + " " + embedText;

    const looksOpen =
      text.includes("🟢") ||
      text.includes("open") ||
      text.includes("status: open");

    if (!looksOpen) return;

    const members = await message.guild.members.fetch();
    const hasChef = members.some(m => m.roles.cache.has(cfg.justiceChefRoleId));
    if (hasChef) return;

    // No chef → revert to CLOSED
    let newText = message.content || "";
    newText = newText
      .replace(/🟢/g, "🔴")
      .replace(/open/gi, "CLOSED (no Justice Chef)");

    await message.edit(newText).catch(() => {});

    // Fix perms in order channel
    const orderCh = message.guild.channels.cache.get(cfg.orderChannelId);
    if (orderCh) {
      // Close orders to customers
      await orderCh.permissionOverwrites.edit(cfg.heroRoleId, {
        ViewChannel: false,
        ReadMessageHistory: false
      }).catch(() => {});
    }

    // Status announcement
    const ann = await message.guild.channels.fetch(cfg.announceChannelId).catch(() => null);
    if (ann) {
      const e = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("⚠️ Status Reverted — No Justice Chef")
        .setDescription(
          "Someone set the restaurant to **OPEN**, but no one with the configured **Justice Chef** role is online.\n\n" +
          "Status reverted to **🔴 CLOSED**, and order permissions restored."
        )
        .setTimestamp();
      ann.send({ embeds: [e] });
    }

  } catch (err) {
    console.log("Status Guard Error:", err);
  }
}

// Permission watchdog (runs every 5 seconds)
function startStatusWatchdog(client) {
  setInterval(async () => {
    try {
      for (const guild of client.guilds.cache.values()) {
        const cfg = getServerCfg(guild.id);

        const orderCh = await guild.channels.fetch(cfg.orderChannelId).catch(() => null);
        if (!orderCh) continue;

        // Only enforce when no Justice Chef is present
        const members = await guild.members.fetch().catch(() => null);
        const chefPresent = members
          ? members.some(m => m.roles.cache.has(cfg.justiceChefRoleId))
          : false;
        if (chefPresent) continue;

        // Decide desired state from status channel name (the bot renames it)
        const statusCh = await guild.channels.fetch(cfg.statusChannelId).catch(() => null);
        const statusName = (statusCh?.name || "").toLowerCase();
        const wantsOpen = statusName.includes("🟢") || statusName.includes("status-open") || statusName.includes("open");

        const desired = wantsOpen
          ? { ViewChannel: true, ReadMessageHistory: true }
          : { ViewChannel: false, ReadMessageHistory: false };

        const heroOv = orderCh.permissionOverwrites.cache.get(cfg.heroRoleId);
        const mismatch = !heroOv
          ? true
          : wantsOpen
            ? (heroOv.allow.has("ViewChannel") !== true || heroOv.allow.has("ReadMessageHistory") !== true)
            : (heroOv.deny.has("ViewChannel") !== true || heroOv.deny.has("ReadMessageHistory") !== true);

        if (!mismatch) continue;

        // IMPORTANT: Only toggle ViewChannel and ReadMessageHistory.
        // SendMessages should remain whatever the server has set (typically denied).
        await orderCh.permissionOverwrites.edit(cfg.heroRoleId, desired).catch(() => {});

        const ann = cfg.announceChannelId ? guild.channels.cache.get(cfg.announceChannelId) : null;
        if (ann) {
          const e = new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("⚠️ Unauthorized Change Reverted")
            .setDescription(
              "Order-channel visibility/history was changed without a **Justice Chef** online.\n\n" +
              "View/History permissions were restored to match the current status."
            )
            .setTimestamp();
          ann.send({ embeds: [e] }).catch(() => {});
        }
      }
    } catch (err) {
      console.log("Watchdog error:", err);
    }
  }, 5000);
}


// ============================================
// AUTO-CLOSE SCHEDULER (1:00 AM + no open tickets)
// ============================================

// Uses America/Denver by default (matches your timezone)
const AUTO_CLOSE_TZ = (() => {
  const raw = String(process.env.AUTO_CLOSE_TZ || "America/Denver").trim();
  // Common shorthand people set: "Denver" → use IANA tz name
  if (/^denver$/i.test(raw)) return "America/Denver";
  return raw || "America/Denver";
})();
// Close every night at 01:00 (24-hour time)
const AUTO_CLOSE_HOUR = Number(process.env.AUTO_CLOSE_HOUR || 1);
const AUTO_CLOSE_MINUTE = Number(process.env.AUTO_CLOSE_MINUTE || 0);

// If there are ZERO ticket channels open, optionally auto-close.
// Set to 0 to disable this behavior.
// Backwards-compatible env var names:
//   - NO_TICKETS_CLOSE_MIN
//   - AUTO_CLOSE_IF_NO_TICKETS_MINUTES
const NO_TICKETS_CLOSE_MIN = Number(
  process.env.NO_TICKETS_CLOSE_MIN ??
  process.env.AUTO_CLOSE_IF_NO_TICKETS_MINUTES ??
  5
);

// Scheduler announcements (default OFF)
// If you want the bot to post a public embed when it auto-closes, set:
// AUTO_CLOSE_ANNOUNCE=true
const AUTO_CLOSE_ANNOUNCE = String(process.env.AUTO_CLOSE_ANNOUNCE || "false")
  .toLowerCase()
  .trim() === "true";

function getTimePartsInTZ(tz) {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });

    const parts = Object.fromEntries(dtf.formatToParts(new Date()).map(p => [p.type, p.value]));
    const y = Number(parts.year);
    const mo = Number(parts.month);
    const d = Number(parts.day);
    const h = Number(parts.hour);
    const mi = Number(parts.minute);
    const s = Number(parts.second);
    return { y, mo, d, hour: h, minute: mi, second: s, ymd: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
  } catch (e) {
    // If the host Node build doesn't support the timezone, fall back to local time.
    const now = new Date();
    const y = now.getFullYear();
    const mo = now.getMonth() + 1;
    const d = now.getDate();
    const h = now.getHours();
    const mi = now.getMinutes();
    const s = now.getSeconds();
    console.log(`[AUTO-CLOSE] ⚠️ Timezone "${tz}" not available. Falling back to server local time.`);
    return { y, mo, d, hour: h, minute: mi, second: s, ymd: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
  }
}

async function isOrdersClosedByOverwrite(guild) {
  const cfg = getServerCfg(guild?.id);
  const orderCh = await guild.channels.fetch(cfg.orderChannelId || ORDER_PERMS_CHANNEL_ID).catch(() => null);
  if (!orderCh) return false;

  // We only enforce visibility for the HERO role. @everyone should stay locked out via base perms.
  const heroOv = orderCh.permissionOverwrites.cache.get(cfg.heroRoleId || HERO_IN_TRAINING_ROLE_ID);

  const allowView = heroOv?.allow?.has("ViewChannel") === true;
  const allowHistory = heroOv?.allow?.has("ReadMessageHistory") === true;

  const denyView = heroOv?.deny?.has("ViewChannel") === true;
  const denyHistory = heroOv?.deny?.has("ReadMessageHistory") === true;

  // Treat as CLOSED if the role is explicitly denied visibility (and not explicitly allowed).
  return (denyView || denyHistory) && !allowView && !allowHistory;
}

async function countOpenTicketChannels(guild) {
  const cfg = ticketCfgStore[guild.id] || {};
  const prefix = (cfg.ticketNamePrefix || "ticket-").toLowerCase();
  const categoryId = cfg.ticketCategoryId || null;

  // Ensure full cache (important right after restarts)
  await guild.channels.fetch().catch(() => {});

  const chans = [...guild.channels.cache.values()].filter(ch =>
    ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)
  );

  const matches = chans.filter(ch => {
    const name = (ch.name || "").toLowerCase();

    // Optional: only count tickets inside the configured category
    if (categoryId && ch.parentId !== categoryId) return false;

    if (isTicketChannel(name)) return true;
    if (name.startsWith(prefix)) return true;

    return false;
  });

  return matches.length;
}

// Optional: post a public embed when the server is opened/closed.
async function postStatusAnnouncement(guild, { content, title, description, color = 0x3b82f6 }) {
  try {
    const cfg = getServerCfg(guild?.id);
    const chId = cfg?.announceChannelId || STATUS_ANNOUNCE_CHANNEL_ID;
    const ch = guild?.channels?.cache?.get?.(chId) || null;
    if (!ch || !ch.isTextBased()) return;

    const e = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    await ch.send({ content: content || undefined, embeds: [e] }).catch(() => {});
  } catch {
    // ignore
  }
}


// Remove a role from every member who currently has it (best-effort).
// Used to strip "Justice Chef on Patrol" when the server auto-closes.
async function removeRoleFromMembersWithRole(guild, roleId, reason = "Auto-close role reset") {
  try {
    if (!guild || !roleId) return { ok: false, removed: 0, error: "missing_guild_or_role" };

    // Ensure member cache is warm so role.members is accurate
    await guild.members.fetch().catch(() => null);

    const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) return { ok: false, removed: 0, error: "role_not_found" };

    const members = [...(role.members?.values?.() || [])];
    if (!members.length) return { ok: true, removed: 0 };

    let removed = 0;
    for (const m of members) {
      try {
        await m.roles.remove(roleId, reason).catch(() => {});
        removed++;
        // small delay to reduce rate-limit risk
        await sleep(350);
      } catch {
        // ignore per-member failures
      }
    }

    return { ok: true, removed };
  } catch (e) {
    return { ok: false, removed: 0, error: e?.message || String(e) };
  }
}

async function forceCloseServer(guild, reason = "auto", opts = {}) {
  const announce = Boolean(opts.announce);
  const cfg = getServerCfg(guild?.id);
  const result = {
    ok: false,
    reason,
    alreadyClosed: false,
    status: { ok: false, error: null },
    order: { ok: false, error: null, before: null, after: null },
    everyone: { ok: false, error: null }
  };

  try {
    if (!guild) {
      result.status.error = "Guild missing";
      result.order.error = "Guild missing";
      result.everyone.error = "Guild missing";
      return result;
    }

    // Ensure channels are cached
    await guild.channels.fetch().catch(() => {});

    const statusCh = guild.channels.cache.get(cfg.statusChannelId) || null;
    const orderCh = guild.channels.cache.get(cfg.orderChannelId) || null;

    // Snapshot helper (for debug output)
    const snap = po => ({
      allow: po?.allow?.toArray?.() || [],
      deny: po?.deny?.toArray?.() || []
    });

    // Determine if it's already closed based on HERO overwrite
    if (orderCh) {
    result.alreadyClosed = await isOrdersClosedByOverwrite(guild);
    }

    // 1) Rename status channel to CLOSED
    if (statusCh) {
      try {
        await statusCh.edit({ name: CLOSED_STATUS_CHANNEL_NAME, reason });
        result.status.ok = true;
      } catch (e) {
        result.status.error = e?.message || String(e);
        console.log(`[AUTO-CLOSE] Status rename failed: ${result.status.error}`);
      }
    } else {
      result.status.error = `Status channel not found (${cfg.statusChannelId})`;
      console.log(`[AUTO-CLOSE] ${result.status.error}`);
    }

    // 2) Lock the order channel for HERO + @everyone
    if (orderCh && orderCh.isTextBased?.()) {
      try {
        const before = orderCh.permissionOverwrites.cache.get(cfg.heroRoleId);
        result.order.before = snap(before);

        await orderCh.permissionOverwrites.edit(
          cfg.heroRoleId,
          {
            ViewChannel: false,
            ReadMessageHistory: false
          },
          { reason }
        );

        const after = orderCh.permissionOverwrites.cache.get(cfg.heroRoleId);
        result.order.after = snap(after);

        result.order.ok = true;
        console.log(`[AUTO-CLOSE] Order perms updated (reason=${reason}).`);
        console.log(`[AUTO-CLOSE] HERO before:`, result.order.before);
        console.log(`[AUTO-CLOSE] HERO after:`, result.order.after);
      } catch (e) {
        result.order.error = e?.message || String(e);
        console.log(`[AUTO-CLOSE] Hero perms update failed: ${result.order.error}`);
      }
      // Note: We do NOT modify @everyone permissions here.
      // Keep @everyone locked out using your channel's base permissions.
    } else {
      const msg = `Order channel not found (${cfg.orderChannelId})`;
      result.order.error = msg;
      result.everyone.error = msg;
      console.log(`[AUTO-CLOSE] ${msg}`);
    }



// Remove "Justice Chef on Patrol" role from anyone who still has it (auto-close reset)
try {
  const pr = await removeRoleFromMembersWithRole(
    guild,
    cfg.patrolRoleId,
    "Auto-close: removing Justice Chef on Patrol role"
  );
  result.patrol.ok = !!pr.ok;
  result.patrol.removed = Number(pr.removed || 0);
  result.patrol.error = pr.error || null;
} catch (e) {
  result.patrol.ok = false;
  result.patrol.error = e?.message || String(e);
}

    // Consider the whole operation "ok" if any meaningful change happened.
    result.ok = Boolean(result.status.ok || result.order.ok || result.everyone.ok || result.patrol.ok);

    // Provide a top-level error if nothing succeeded
    if (!result.ok) {
      result.error =
        result.status.error ||
        result.order.error ||
        result.everyone.error ||
        "No changes were applied.";
    }

    // Optional public announcement (default OFF)
    if (announce && result.ok) {
      await postStatusAnnouncement(guild, {
        title: "🔴 Server Closed",
        description: `Server set to **CLOSED** (${reason}).`,
        color: 0xef4444
      });
    }

    return result;
  } catch (e) {
    const msg = e?.message || String(e);
    console.log(`[AUTO-CLOSE] forceCloseServer crashed: ${msg}`);
    result.error = msg;
    result.ok = false
    return result;
  }
}



// Auto-open (reverse of auto-close)
// Force BREAK now (locks order channel, sets status to 🟡 BREAK)
async function forceBreakServer(guild, reason = "Manual break", { announce = false, pingRoleId = null, pingUserId = null } = {}) {
  const cfg = getServerCfg(guild?.id);
  const result = {
    ok: true,
    action: "break",
    statusChannelFound: false,
    orderChannelFound: false,
    renamedStatusChannel: false,
    editedStatusMessage: false,
    updatedHeroOverwrite: false,
    removedPatrolFrom: 0,
    errors: []
  };

  try {
    if (!guild) throw new Error("Guild not found");

    const statusCh = guild.channels.cache.get(cfg.statusChannelId);
    if (statusCh && statusCh.isTextBased?.()) {
      result.statusChannelFound = true;
      try {
        await statusCh.setName(BREAK_STATUS_CHANNEL_NAME).catch(() => {});
        result.renamedStatusChannel = true;
      } catch (e) {
        result.errors.push(`statusCh.setName: ${e.message}`);
      }

      try {
        await setStatusMessage(statusCh, "🟡 ON BREAK");
        result.editedStatusMessage = true;
      } catch (e) {
        result.errors.push(`setStatusMessage: ${e.message}`);
      }
    }

    const orderCh = guild.channels.cache.get(cfg.orderChannelId);
    if (orderCh) {
      result.orderChannelFound = true;
      try {
        await orderCh.permissionOverwrites.edit(cfg.heroRoleId, {
          ViewChannel: false,
          ReadMessageHistory: false
        }).catch(() => {});
        result.updatedHeroOverwrite = true;
      } catch (e) {
        result.errors.push(`orderCh.permissionOverwrites.edit: ${e.message}`);
      }
    }

    // Remove JUSTICE CHEF ON PATROL role from everyone (best effort)
    try {
      const pr = await removeRoleFromMembersWithRole(
        guild,
        cfg.patrolRoleId,
        "Break: removing Justice Chef on Patrol role"
      );
      result.removedPatrolFrom = pr.removed || 0;
    } catch (e) {
      result.errors.push(`removePatrol: ${e.message}`);
    }

    if (announce) {
      const ping =
        pingRoleId ? `<@&${pingRoleId}>` : pingUserId ? `<@${pingUserId}>` : "";

      await postStatusAnnouncement(guild, {
        content: ping || undefined,
        title: "🟡 On Break",
        description:
          `The restaurant is **ON BREAK**.\n\n` +
          `Orders are currently paused.\n\n` +
          `Reason: ${reason || "—"}`
      }).catch(() => {});
    }
  } catch (err) {
    result.ok = false;
    result.errors.push(err.message || String(err));
  }

  return result;
}

async function forceOpenServer(guild, reason = "manual", opts = {}) {
  const announce = Boolean(opts.announce);
  const result = {
    ok: false,
    reason,
    status: { ok: false },
    order: { ok: false },
    everyone: { ok: false },
    error: null
  };

  try {
    if (!guild) {
      result.error = "Guild not found";
      return result;
    }

    // Ensure caches
    await guild.channels.fetch().catch(() => {});

    const cfg = getServerCfg(guild.id);

    // 1) Rename Status channel to OPEN
    const statusCh = guild.channels.cache.get(cfg.statusChannelId) || null;
    if (statusCh && statusCh.isTextBased?.()) {
      try {
        await statusCh.setName(OPEN_STATUS_CHANNEL_NAME);
        result.status.ok = true;
      } catch (e) {
        result.status.error = e?.message || String(e);
        console.log(`[AUTO-OPEN] Status rename failed: ${result.status.error}`);
      }
    } else {
      result.status.error = "Status channel not found";
    }

    // 2) Unlock Orders channel for HERO + @everyone
    const orderCh = guild.channels.cache.get(cfg.orderChannelId) || null;
    if (!orderCh) {
      result.order.error = "Order channel not found";
    } else {
      try {
        const beforeHero = orderCh.permissionOverwrites.cache.get(cfg.heroRoleId);
        console.log("[AUTO-OPEN] HERO before:", {
          allow: beforeHero ? Array.from(beforeHero.allow.toArray()) : [],
          deny: beforeHero ? Array.from(beforeHero.deny.toArray()) : []
        });

        await orderCh.permissionOverwrites.edit(cfg.heroRoleId, {
          ViewChannel: true,
          ReadMessageHistory: true
        });

        const afterHero = orderCh.permissionOverwrites.cache.get(cfg.heroRoleId);
        console.log("[AUTO-OPEN] HERO after:", {
          allow: afterHero ? Array.from(afterHero.allow.toArray()) : [],
          deny: afterHero ? Array.from(afterHero.deny.toArray()) : []
        });

        result.order.ok = true;
      } catch (e) {
        result.order.error = e?.message || String(e);
        console.log(`[AUTO-OPEN] Order perms update failed: ${result.order.error}`);
      }
      // Note: We do NOT modify @everyone permissions here.
      // Keep @everyone locked out using your channel's base permissions.
    }

    // OK if at least one part succeeded
    result.ok = Boolean(result.status.ok || result.order.ok || result.everyone.ok);

    if (!result.ok) {
      result.error =
        result.status.error ||
        result.order.error ||
        result.everyone.error ||
        "No changes were applied.";
    }

    // Optional public announcement (default OFF)
    if (announce && result.ok) {
      await postStatusAnnouncement(guild, {
        title: "🟢 Server Opened",
        description: `Server set to **OPEN** (${reason}).`,
        color: 0x22c55e
      });
    }

    return result;
  } catch (e) {
    const msg = e?.message || String(e);
    console.log(`[AUTO-OPEN] forceOpenServer crashed: ${msg}`);
    result.error = msg;
    result.ok = false;
    return result;
  }
}

function startAutoCloseScheduler(client) {
  // Per-guild state
  const lastAutoCloseYMDByGuild = new Map(); // guildId -> "YYYY-MM-DD"
  const noTicketSinceByGuild = new Map();    // guildId -> timestamp or null

  console.log(
    `[AUTO-CLOSE] Armed: ${AUTO_CLOSE_TZ} @ ${String(AUTO_CLOSE_HOUR).padStart(2, "0")}:${String(AUTO_CLOSE_MINUTE).padStart(2, "0")} (close-after-no-tickets: ${NO_TICKETS_CLOSE_MIN} min)`
  );

  // Check every 30 seconds
  setInterval(async () => {
    try {
      const nowTZ = getTimePartsInTZ(AUTO_CLOSE_TZ);

      for (const guild of client.guilds.cache.values()) {
        // 0) Skip if already closed (orders already locked)
        const alreadyClosed = await isOrdersClosedByOverwrite(guild).catch(() => false);

        // 1) Nightly close at configured time (once per day per guild)
        const lastYmd = lastAutoCloseYMDByGuild.get(guild.id) || null;
        if (
          nowTZ.hour === AUTO_CLOSE_HOUR &&
          nowTZ.minute === AUTO_CLOSE_MINUTE &&
          lastYmd !== nowTZ.ymd
        ) {
          await forceCloseServer(guild, "time", { announce: AUTO_CLOSE_ANNOUNCE });
          lastAutoCloseYMDByGuild.set(guild.id, nowTZ.ymd);
          // reset no-ticket timer on close
          noTicketSinceByGuild.set(guild.id, null);
          continue;
        }

        // 2) Optional: close if no tickets are open for N minutes (best-effort)
        if (NO_TICKETS_CLOSE_MIN > 0 && !alreadyClosed) {
          const openTickets = await countOpenTicketChannels(guild).catch(() => 0);

          if (openTickets === 0) {
            const since = noTicketSinceByGuild.get(guild.id) || Date.now();
            noTicketSinceByGuild.set(guild.id, since);

            const mins = Math.floor((Date.now() - since) / 60000);
            if (mins >= NO_TICKETS_CLOSE_MIN) {
              await forceCloseServer(guild, "no_tickets", { announce: AUTO_CLOSE_ANNOUNCE });
              noTicketSinceByGuild.set(guild.id, null);
            }
          } else {
            noTicketSinceByGuild.set(guild.id, null);
          }
        }
      }
    } catch (err) {
      console.log("[AUTO-CLOSE] Scheduler error:", err?.message || err);
    }
  }, 30000);
}

// ============================================
// BUMP TIMER SYSTEM (EMBED + PING + COPY BUTTON)
// ============================================

// Optional env vars:
// BUMP_BANNER_URL, SUPPORT_SERVER_URL, BOT_INVITE_URL
const BUMP_BANNER_URL =
  process.env.BUMP_BANNER_URL || "https://i.imgur.com/9K7yKQp.png";
const SUPPORT_SERVER_URL = process.env.SUPPORT_SERVER_URL || "";
const BOT_INVITE_URL = process.env.BOT_INVITE_URL || "https://discord.com/oauth2/authorize?client_id=1417963130927058964&scope=bot%20applications.commands&permissions=8";

// Keep timers separate from JSON store
const bumpTimers = new Map(); // guildId -> Timeout

function normalizeDisboardCommandMention(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";

  // Common mistake: </bump 123> (space) → </bump:123>
  s = s.replace(/^<\/(\w+)\s+(\d+)>$/, "</$1:$2>");

  // Keep only valid command mention format
  if (!/^<\/[\w-]+:\d+>$/.test(s)) return "";
  return s;
}

function getDisboardCommandMention(guildId) {
  const cfg = bumpStore[guildId] || {};
  return normalizeDisboardCommandMention(cfg.disboardCommandMention || "");
}


function normalizeCommandMention(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  // Accept formats like:
  // </bump:1234567890>  (correct)
  // </bump 1234567890>  (common mistake)
  // </bump: 1234567890> (extra spaces)
  const m = s.match(/^<\/(\w+)\s*:?\s*(\d+)>$/);
  if (m) return `</${m[1]}:${m[2]}>`;
  return s;
}



function buildBumpReminderEmbed(guildId) {
  return new EmbedBuilder()
    .setColor(0x34d399)
    .setTitle("Bump Reminder!")
    .setDescription(
      [
        "**This server can be bumped again!**",
        "",
        "Use the button below or tap the clickable DISBOARD command (if configured)."
      ].join("\n")
    )
    .setImage(BUMP_BANNER_URL)
    .setTimestamp()
    .setFooter({ text: "INVINCIBLE EATS" });
}

async function getBumpPing(guild, cfg) {
  // Prefer configured ping role/user, otherwise default to server owner (like screenshot)
  if (cfg?.pingRoleId) return `<@&${cfg.pingRoleId}>`;
  if (cfg?.pingUserId) return `<@${cfg.pingUserId}>`;

  const owner = await guild.fetchOwner().catch(() => null);
  return owner ? `<@${owner.id}>` : "@here";
}

function buildBumpButtonsRow() {
  const buttons = [];

  // Copy button: Discord bots cannot access a user's clipboard, but sending /bump inside a code block
  // gives a one-tap "Copy" button on mobile.
  buttons.push(
    new ButtonBuilder()
      .setCustomId("bump:copy")
      .setStyle(ButtonStyle.Primary)
      .setLabel("Copy /bump")
  );

  if (SUPPORT_SERVER_URL) {
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Join Support Server")
        .setURL(SUPPORT_SERVER_URL)
    );
  }

  if (BOT_INVITE_URL) {
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Add Bot")
        .setURL(BOT_INVITE_URL)
    );
  }

  return new ActionRowBuilder().addComponents(buttons.slice(0, 5));
}


function scheduleBumpTimer(guildId) {
  const cfg = bumpStore[guildId];
  if (!cfg) return;

  const intervalMs = (cfg.intervalMin || 120) * 60 * 1000;

  // Clear existing timer
  const existing = bumpTimers.get(guildId);
  if (existing) clearTimeout(existing);

  // Schedule based on last bump time (so restarts are correct)
  const last = cfg.lastBumpTs || Date.now();
  const nextAt = last + intervalMs;
  const delay = Math.max(0, nextAt - Date.now());

  const t = setTimeout(async () => {
    try {
      const g = await client.guilds.fetch(guildId).catch(() => null);
      if (!g) return;

      const ch = await g.channels.fetch(cfg.channelId).catch(() => null);
      if (!ch || !ch.isTextBased()) return;

      const ping = await getBumpPing(g, cfg);
      const embed = buildBumpReminderEmbed(guildId);
      const row = buildBumpButtonsRow();
      const mention = getDisboardCommandMention(guildId);

      await ch.send({
        content: mention ? `${ping}\nTap to run: ${mention}` : ping,
        embeds: [embed],
        components: row ? [row] : []
      });
    } catch (err) {
      console.log("Bump timer error:", err);
    }
  }, delay);

  bumpTimers.set(guildId, t);
}

// ============================================
// AUTO VOUCH DETECTION (MESSAGE-BASED)
// ============================================
// If a customer posts in a channel whose name includes "vouch" and mentions a staff member,
// we treat it as a vouch and increment counts automatically.
// This is for servers where people vouch by sending a normal message instead of using /vouch.
async function tryAutoVouchFromMessage(msg) {
  try {
    if (!msg.guild) return false;
    if (msg.author?.bot) return false;
    if (!isLikelyVouchChannel(msg.channel)) return false;

    // Must mention the staff member being vouched for
    const mentioned = msg.mentions?.users?.first();
    if (!mentioned) return false;

    // Only count if the mentioned user is actually staff
    const staffMember = await msg.guild.members.fetch(mentioned.id).catch(() => null);
    if (!staffMember) return false;

    const isStaff = staffMember.roles?.cache?.some(r => STAFF_ROLE_IDS.includes(r.id));
    if (!isStaff) return false;

    // Count if:
    // - message text contains vouch-ish words, OR
    // - message contains an attachment (common: screenshot) with a staff mention
    const text = String(msg.content || "").toLowerCase();
    const hasVouchWord =
      /vouch(ed|ing)?/i.test(text) ||
      /\+1/.test(text) ||
      /rep/i.test(text);

    const hasAttachment = (msg.attachments?.size || 0) > 0;

    if (!hasVouchWord && !hasAttachment) return false;

    // Update counts
    vouchByStaff[mentioned.id] = (vouchByStaff[mentioned.id] || 0) + 1;
    const newCustCount = (vouchByCust[msg.author.id] || 0) + 1;
    vouchByCust[msg.author.id] = newCustCount;

    writeJson("vouches_by_staff.json", vouchByStaff);
    writeJson("vouches_by_customer.json", vouchByCust);

    // Sync loyalty tier roles
    const customerMember = await msg.guild.members.fetch(msg.author.id).catch(() => null);
    if (customerMember) {
      await syncCustomerTierRoles(msg.guild, customerMember, newCustCount);
    }

    // Lightweight confirmation
    await msg.react("✅").catch(() => {});
    return true;
  } catch (err) {
    console.log("Auto vouch error:", err);
    return false;
  }
}

// ============================================
// MESSAGE HANDLERS
// ============================================

client.on("messageCreate", async msg => {
  if (!msg.guild) return;

  // 0) Auto-vouch counting (message-based vouches in #vouches / #vouch)
  // This does NOT interfere with /vouch; it only runs on normal messages.
  await tryAutoVouchFromMessage(msg);

  // 1) Auto-detect Disboard bump
  try {
    if (msg.author.id === DISBOARD_BOT_ID && msg.embeds?.length) {
      const emb = msg.embeds[0];
      const text = `${emb.title || ""} ${emb.description || ""}`.toLowerCase();

      if (text.includes("bump done")) {
        const gId = msg.guild.id;

        if (bumpStore[gId]) {
          bumpStore[guildIdSafe(gId)].lastBumpTs = Date.now();
          writeJson("bumps.json", bumpStore);
          scheduleBumpTimer(gId);
          console.log(`[Auto-Bump] Disboard bump detected for guild ${gId}`);
        }
      }
    }
  } catch (err) {
    console.log("Auto-bump error:", err);
  }

  // 2) Auto-ban link spam (Discord invites or any http/https link) — non-staff only
  try {
    if (BAN_LINKS_ENABLED && !msg.author.bot) {
      const member = msg.member;

      const isStaff = member?.roles?.cache?.some(r => STAFF_ROLE_IDS.includes(r.id));
      if (!isStaff) {
        const embedText = msg.embeds
          ?.map(e => `${e.title || ""} ${e.description || ""} ${e.url || ""}`)
          .join(" ");

        const combined = `${msg.content || ""} ${embedText || ""}`;

        // Keep order links allowed (UE / DoorDash), so customers can still place orders.
        const allowedOrderLink = ORDER_LINK_ALLOWLIST.some(r => r.test(combined));
        if (!allowedOrderLink) {
          const hasDiscordInvite = DISCORD_INVITE_REGEX.test(combined);
          const hasAnyUrl = ANY_HTTP_URL_REGEX.test(combined);

          if (hasDiscordInvite || hasAnyUrl) {
            const link = firstLinkSnippet(combined);
            const reason = `${BAN_LINK_REASON}${link ? ` | Link: ${link}` : ""}`;

            // Remove the spam message first (best-effort)
            await msg.delete().catch(() => {});

            // Ban the user (best-effort)
            const target = member || (await msg.guild.members.fetch(msg.author.id).catch(() => null));
            if (target?.bannable) {
              await target.ban({ reason }).catch(() => {});
            } else {
              console.log(`[AUTO-BAN] Could not ban ${msg.author.tag} (missing permissions / not bannable).`);
            }

            // Log to the configured auto-ban announcements channel
            const ann = client.channels.cache.get(AUTO_BAN_ANNOUNCE_CHANNEL_ID);
            if (ann) {
              const e = new EmbedBuilder()
                .setColor(0xef4444)
                .setTitle("🔨 Auto-Ban — Link Spam")
                .setDescription(
                  `User ${msg.author} was banned for posting a prohibited link.\n\n` +
                  (link ? `**Link:** ${link}\n` : "") +
                  `**Channel:** <#${msg.channelId}>`
                )
                .setTimestamp();
              ann.send({ embeds: [e] }).catch(() => {});
            }

            // Optional DM (ignore failures)
            try {
              await msg.author.send(
                `You were banned from **${msg.guild.name}** for posting a prohibited link.\nReason: ${BAN_LINK_REASON}`
              );
            } catch {}

            return; // stop further handling
          }
        }
      }
    }
  } catch (err) {
    console.log("Auto-ban links error:", err);
  }

  // 3) Anti-promo (allow DoorDash + Uber Eats order links)
  try {
    if (!msg.author.bot) {
      const member = msg.member;

      const isStaff = member?.roles?.cache?.some(r => STAFF_ROLE_IDS.includes(r.id));
      if (!isStaff) {
        const embedText = msg.embeds
          ?.map(e => `${e.title || ""} ${e.description || ""} ${e.url || ""}`)
          .join(" ");

        const combined = `${msg.content || ""} ${embedText || ""}`;

        // ✅ Allowlist legit order links so customers can post them safely.
        const allowedOrderLink = ORDER_LINK_ALLOWLIST.some(r => r.test(combined));
        if (allowedOrderLink) {
          console.log(`[ANTI-PROMO] Allowed order link from ${msg.author.tag} in #${msg.channel?.name || msg.channelId}`);
          return;
        }

        // Match against promo patterns (no blanket /https?:\/\// pattern is used)
        const hit = PROMO_PATTERNS.find(r => r.test(combined));
        if (hit) {
          console.log(`[ANTI-PROMO] Deleted message from ${msg.author.tag} (matched: ${hit})`);
          await msg.delete().catch(err => console.log("Delete failed:", err.message));
        }
      }
    }
  } catch (err) {
    console.log("Anti-promo error:", err);
  }
// 4) Status guard
  enforceStatusGuard(msg);
});

client.on("messageUpdate", async (_, newMsg) => {
  try {
    const msg = newMsg.partial ? await newMsg.fetch() : newMsg;
    if (!msg.guild) return;
    enforceStatusGuard(msg);
  } catch (err) {
    console.log("messageUpdate error:", err);
  }
});

// helper (tiny safety)
function guildIdSafe(id) {
  return String(id || "");
}

// ============================================
// MULTI-SERVER CONFIG RESOLVER
// ============================================

function getServerCfg(guildId) {
  const gId = guildIdSafe(guildId);
  const saved = serverCfgStore?.[gId] || {};

  // Defaults fall back to the IDs hard-coded above (your main server),
  // but each server can override them via /server_setup.
  return {
    statusChannelId: saved.statusChannelId || STATUS_CHANNEL_ID,
    orderChannelId: saved.orderChannelId || ORDER_PERMS_CHANNEL_ID,
    heroRoleId: saved.heroRoleId || HERO_IN_TRAINING_ROLE_ID,
    announceChannelId: saved.announceChannelId || STATUS_ANNOUNCE_CHANNEL_ID,
    patrolRoleId: saved.patrolRoleId || JUSTICE_CHEF_ON_PATROL_ROLE_ID,
    justiceChefRoleId: saved.justiceChefRoleId || JUSTICE_CHEF_ROLE_ID,
    calcRoleId: saved.calcRoleId || saved.justiceChefRoleId || JUSTICE_CHEF_ROLE_ID
  };
}

// Interaction reply helpers (prevents "thinking..." hangs if editReply fails)
async function safeEditReply(interaction, payload) {
  try {
    return await interaction.editReply(payload);
  } catch (e) {
    console.log("[INTERACTION] editReply failed:", e?.message || e);
    // Fallback: try a followUp (works if the interaction was acknowledged)
    try {
      return await interaction.followUp(payload);
    } catch (e2) {
      console.log("[INTERACTION] followUp failed:", e2?.message || e2);
    }
  }
}

// ============================================
// SLASH COMMAND DEFINITIONS
// ============================================

// /scanpromos
const cmdScanPromos = new SlashCommandBuilder()
  .setName("scanpromos")
  .setDescription("Delete recent promotional messages here (up to 1000).")
  .addIntegerOption(o =>
    o.setName("limit")
      .setDescription("Messages to scan (max 1000)")
      .setMinValue(10)
      .setMaxValue(1000)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

// /setpay (flexible methods)
const cmdSetPay = new SlashCommandBuilder()
  .setName("setpay")
  .setDescription("Set payment methods for a staff member (flexible).")
  .addUserOption(o =>
    o.setName("staff").setDescription("Staff user").setRequired(true)
  )
  .addStringOption(o =>
    o.setName("name").setDescription("Display name for this staff").setRequired(true)
  )
  .addStringOption(o =>
    o.setName("methods").setDescription("One per line: Method = Value").setRequired(true)
  );

// /delpay
const cmdDelPay = new SlashCommandBuilder()
  .setName("delpay")
  .setDescription("Delete stored payment methods for a staff member.")
  .addUserOption(o =>
    o.setName("staff").setDescription("Staff user").setRequired(true)
  );

// /pay
const cmdPay = new SlashCommandBuilder()
  .setName("pay")
  .setDescription("Show payment options for a staff member.")
  .addUserOption(o =>
    o.setName("staff").setDescription("Who is getting paid").setRequired(true)
  )
  .addNumberOption(o =>
    o.setName("amount").setDescription("Amount in USD")
  )
  .addStringOption(o =>
    o.setName("note").setDescription("Optional note")
  );

// /showpay
const cmdShowPay = new SlashCommandBuilder()
  .setName("showpay")
  .setDescription("Show saved payment methods for a staff member (no amount).")
  .addUserOption(o =>
    o.setName("staff").setDescription("Staff user").setRequired(true)
  )
  .addStringOption(o =>
    o.setName("note").setDescription("Optional note")
  );

// Bump commands
const cmdBumpConfig = new SlashCommandBuilder()
  .setName("bump_config")
  .setDescription("Enable Disboard bump reminder in this channel.")
  .addIntegerOption(o =>
    o.setName("interval")
      .setDescription("Minutes (60–180)")
      .setMinValue(60)
      .setMaxValue(180)
  )
  .addRoleOption(o =>
    o.setName("ping_role")
      .setDescription("Role to ping when bump is ready (optional)")
  )
  .addUserOption(o =>
    o.setName("ping_user")
      .setDescription("User to ping when bump is ready (optional)")
  )

  .addStringOption(o =>
    o.setName("command_mention")
      .setDescription("Paste the clickable DISBOARD command mention like </bump:123...> (best on mobile)")
  )
.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const cmdBump = new SlashCommandBuilder()
  .setName("bump")
  .setDescription("Record that you bumped just now.");

const cmdBumpStatus = new SlashCommandBuilder()
  .setName("bumpstatus")
  .setDescription("Show time until next reminder.");

// Ticket config (for any server / any ticket bot)
const cmdTicketConfig = new SlashCommandBuilder()
  .setName("ticket_config")
  .setDescription("Configure where ticket channels live (so close-all works in any server).")
  .addChannelOption(o =>
    o.setName("ticket_category")
      .setDescription("Category that contains tickets (optional but recommended).")
      .addChannelTypes(ChannelType.GuildCategory)
  )
  .addStringOption(o =>
    o.setName("name_prefix")
      .setDescription("Ticket channel name prefix (default: ticket-) e.g. ticket-")
  )
  .addChannelOption(o =>
    o.setName("log_channel")
      .setDescription("Where transcripts/logs should be posted (optional).")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// Multi-server setup (status/order channels + core roles; optional ticket settings)
const cmdServerSetup = new SlashCommandBuilder()
  .setName("server_setup")
  .setDescription("Configure the bot for this server (status/order channels, roles, optional ticket settings).")
  .addChannelOption(o =>
    o.setName("status_channel")
      .setDescription("Status channel the bot edits/renames")
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  )
  .addChannelOption(o =>
    o.setName("order_channel")
      .setDescription("Order channel to lock/unlock")
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  )
  .addRoleOption(o =>
    o.setName("hero_role")
      .setDescription("Role that gets access when OPEN (usually HERO IN TRAINING)")
      .setRequired(true)
  )
  .addChannelOption(o =>
    o.setName("announce_channel")
      .setDescription("Optional channel to post open/close announcements")
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  )
  .addRoleOption(o =>
    o.setName("patrol_role")
      .setDescription("Optional patrol role to remove on close")
      .setRequired(false)
  )
  .addRoleOption(o =>
    o.setName("justice_role")
      .setDescription("Optional Justice Chef role (used for status guard + permissions checks)")
      .setRequired(false)
  )
  .addRoleOption(o =>
    o.setName("calc_role")
      .setDescription("Optional role that can run /calc (defaults to justice_role)")
      .setRequired(false)
  )
  // Optional ticket config in the same command
  .addChannelOption(o =>
    o.setName("ticket_category")
      .setDescription("Optional: category that contains ticket channels")
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildCategory)
  )
  .addStringOption(o =>
    o.setName("ticket_prefix")
      .setDescription("Optional: ticket channel name prefix (default: ticket-)")
      .setRequired(false)
  )
  .addChannelOption(o =>
    o.setName("ticket_log")
      .setDescription("Optional: log channel for transcripts")
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// Close all tickets
const cmdCloseAllTickets = new SlashCommandBuilder()
  .setName("closealltickets")
  .setDescription("Save transcripts + close many tickets at once (works with most ticket bots).")
  .addIntegerOption(o =>
    o.setName("amount")
      .setDescription("How many tickets to close (default: ALL)")
      .setMinValue(1)
      .setMaxValue(200)
  )
  .addStringOption(o =>
    o.setName("mode")
      .setDescription("save_close = transcript+DM+delete, delete_only = just delete")
      .addChoices(
        { name: "save_close", value: "save_close" },
        { name: "delete_only", value: "delete_only" }
      )
  )
  .addChannelOption(o =>
    o.setName("ticket_category")
      .setDescription("Override category just for this run (optional).")
      .addChannelTypes(ChannelType.GuildCategory)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

// Vouch commands
const cmdVouch = new SlashCommandBuilder()
  .setName("vouch")
  .setDescription("Submit a vouch for who fulfilled your order.")
  .addUserOption(o =>
    o.setName("staff").setDescription("Staff").setRequired(true)
  )
  .addStringOption(o =>
    o.setName("message").setDescription("What went well?").setRequired(true)
  )
  .addAttachmentOption(o =>
    o.setName("image").setDescription("Optional image")
  )
  .addChannelOption(o =>
    o.setName("channel").setDescription("Post to (default here)")
  );

const cmdVouchCount = new SlashCommandBuilder()
  .setName("vouchcount")
  .setDescription("Show vouch count and loyalty tier for a user.")
  .addUserOption(o =>
    o.setName("user").setDescription("User")
  );
// Manual vouches (admin)
const cmdVouchAdd = new SlashCommandBuilder()
  .setName("vouch_add")
  .setDescription("Manually add vouches to a customer (upgrades loyalty roles).")
  .addUserOption(o =>
    o.setName("customer").setDescription("Customer to add vouches to").setRequired(true)
  )
  .addIntegerOption(o =>
    o.setName("amount").setDescription("How many to add (default 1)").setMinValue(1).setMaxValue(50)
  )
  .addUserOption(o =>
    o.setName("staff").setDescription("Optional staff to also credit").setRequired(false)
  )
  .addStringOption(o =>
    o.setName("note").setDescription("Optional reason / note").setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const cmdVouchRemove = new SlashCommandBuilder()
  .setName("vouch_remove")
  .setDescription("Manually remove vouches from a customer (does not auto-downgrade roles).")
  .addUserOption(o =>
    o.setName("customer").setDescription("Customer to remove vouches from").setRequired(true)
  )
  .addIntegerOption(o =>
    o.setName("amount").setDescription("How many to remove (default 1)").setMinValue(1).setMaxValue(50)
  )
  .addUserOption(o =>
    o.setName("staff").setDescription("Optional staff to also remove credit").setRequired(false)
  )
  .addStringOption(o =>
    o.setName("note").setDescription("Optional reason / note").setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);


// Announce
const cmdAnnounce = new SlashCommandBuilder()
  .setName("announce")
  .setDescription("Post an announcement embed.")
  .addStringOption(o =>
    o.setName("title").setDescription("Title").setRequired(true)
  )
  .addStringOption(o =>
    o.setName("body").setDescription("Body").setRequired(true)
  )
  .addChannelOption(o =>
    o.setName("channel").setDescription("Target channel")
  );

// Sayembed
const cmdSayEmbed = new SlashCommandBuilder()
  .setName("sayembed")
  .setDescription("Send a styled embed.")
  .addStringOption(o =>
    o.setName("text").setDescription("Text").setRequired(true)
  );

// Invoice
const cmdInvoice = new SlashCommandBuilder()
  .setName("invoice")
  .setDescription("Create a quick invoice/receipt embed.")
  .addUserOption(o =>
    o.setName("customer").setDescription("Customer").setRequired(true)
  )
  .addNumberOption(o =>
    o.setName("amount").setDescription("Total amount").setRequired(true)
  )
  .addStringOption(o =>
    o.setName("items").setDescription("Items/notes").setRequired(true)
  );

// UE Inspect
const cmdUEInspect = new SlashCommandBuilder()
  .setName("ueinspect")
  .setDescription("Forward an Uber Eats group link to the tickets channel.")
  .addStringOption(o =>
    o.setName("url").setDescription("Uber Eats link").setRequired(true)
  );
// /calc (customer pay calculator)
const cmdCalc = new SlashCommandBuilder()
  .setName("calc")
  .setDescription("Calculate what the customer should pay (cost + fee, with discount roles).")
  .addNumberOption(o =>
    o.setName("cost")
      .setDescription("What it costs us (staff cost) in USD")
      .setRequired(true)
      .setMinValue(0)
  )
  .addNumberOption(o =>
    o.setName("fee")
      .setDescription(`Service fee (default: $${DEFAULT_SERVICE_FEE})`)
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(1000)
  )
  .addUserOption(o =>
    o.setName("customer")
      .setDescription("Customer to check discount roles for (default: ticket opener / you)")
      .setRequired(false)
  )
  .addBooleanOption(o =>
    o.setName("public")
      .setDescription("Post publicly in the channel (default: ephemeral)")
      .setRequired(false)
  );



// Closeticket
const cmdCloseTicket = new SlashCommandBuilder()
  .setName("closeticket")
  .setDescription("Open close panel: Save & Close (with transcript) or Delete Only.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

// Claim
const cmdClaim = new SlashCommandBuilder()
  .setName("claim")
  .setDescription("Claim this ticket and rename it (or unclaim to revert).")
  .addBooleanOption(o =>
    o.setName("unclaim")
      .setDescription("Revert this ticket back to its original ticket-#### name")
      .setRequired(false)
  )
  .addUserOption(o =>
    o.setName("user")
      .setDescription("User to attach this ticket to (required unless unclaim=true)")
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

// Host URL (for transcript links)
const cmdHostUrlSet = new SlashCommandBuilder()
  .setName("hosturl_set")
  .setDescription("Set the public base URL used for transcript links.")
  .addStringOption(o =>
    o.setName("url")
      .setDescription("Example: https://xxxx.janeway.replit.dev")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);


// Auto close NOW (manual test / emergency)
// Restrict via default permissions + runtime check.
// Auto close/open NOW (manual override; optional announcement + custom message)
const cmdAutoCloseNow = new SlashCommandBuilder()
  .setName("autoclose_now")
  .setDescription("Set the server to CLOSED or ON BREAK right now (locks orders + updates status).")
  .addStringOption(o =>
    o.setName("state")
      .setDescription("Which status to set (default: closed)")
      .addChoices(
        { name: "Closed", value: "closed" },
        { name: "On Break", value: "break" }
      )
  )
  .addStringOption(o =>
    o.setName("announce")
      .setDescription("Post an announcement in the announce channel?")
      .addChoices(
        { name: "No", value: "none" },
        { name: "Standard", value: "standard" },
        { name: "Custom", value: "custom" }
      )
  )
  .addStringOption(o =>
    o.setName("custom_title")
      .setDescription("Custom announcement title (only if announce=Custom)")
      .setMaxLength(256)
  )
  .addStringOption(o =>
    o.setName("custom_text")
      .setDescription("Custom announcement body (only if announce=Custom)")
      .setMaxLength(2000)
  )
  .addRoleOption(o =>
    o.setName("ping_role")
      .setDescription("Role to ping in the announcement (optional)")
  )
  .addUserOption(o =>
    o.setName("ping_user")
      .setDescription("User to ping in the announcement (optional)")
  )
  .addBooleanOption(o =>
    o.setName("quiet")
      .setDescription("Only reply with ✅ Done (ephemeral)")
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

const cmdAutoOpenNow = new SlashCommandBuilder()
  .setName("autoopen_now")
  .setDescription("Set the server to OPEN / ON BREAK / CLOSED right now (updates orders + status).")
  .addStringOption(o =>
    o.setName("state")
      .setDescription("Which status to set (default: open)")
      .addChoices(
        { name: "Open", value: "open" },
        { name: "On Break", value: "break" },
        { name: "Closed", value: "closed" }
      )
  )
  .addStringOption(o =>
    o.setName("announce")
      .setDescription("Post an announcement in the announce channel?")
      .addChoices(
        { name: "No", value: "none" },
        { name: "Standard", value: "standard" },
        { name: "Custom", value: "custom" }
      )
  )
  .addStringOption(o =>
    o.setName("custom_title")
      .setDescription("Custom announcement title (only if announce=Custom)")
      .setMaxLength(256)
  )
  .addStringOption(o =>
    o.setName("custom_text")
      .setDescription("Custom announcement body (only if announce=Custom)")
      .setMaxLength(2000)
  )
  .addRoleOption(o =>
    o.setName("ping_role")
      .setDescription("Role to ping in the announcement (optional)")
  )
  .addUserOption(o =>
    o.setName("ping_user")
      .setDescription("User to ping in the announcement (optional)")
  )
  .addBooleanOption(o =>
    o.setName("quiet")
      .setDescription("Only reply with ✅ Done (ephemeral)")
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

// Help
const cmdHelp = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show bot commands.");

// Order perms debug
const cmdOrderPerms = new SlashCommandBuilder()
  .setName("orderperms")
  .setDescription("Debug order channel permissions (HERO + optional user).")
  .addUserOption(o =>
    o.setName("user").setDescription("Optional user to check effective perms for")
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const COMMANDS = [
  cmdScanPromos,
  cmdSetPay,
  cmdDelPay,
  cmdPay,
  cmdShowPay,
  cmdBumpConfig,
  cmdBump,
  cmdBumpStatus,
  cmdTicketConfig,
  cmdServerSetup,
  cmdCloseAllTickets,
  cmdVouch,
  cmdVouchCount,
  cmdVouchAdd,
  cmdVouchRemove,
  cmdAnnounce,
  cmdSayEmbed,
  cmdInvoice,
  cmdUEInspect,
  cmdCalc,
  cmdCloseTicket,
  cmdClaim,
  cmdHostUrlSet,
  cmdAutoCloseNow,
  cmdAutoOpenNow,
  cmdHelp
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: COMMANDS }
  );
  console.log("✅ Slash commands registered");
}

// ============================================
// FLEXIBLE PAYMENT SYSTEM
// ============================================

function buildPayEmbed(requester, staff, info, amount, note, openerId) {
  const e = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(`💸 Payment → ${info.name}`)
    .setFooter({ text: `Requested by ${requester.tag}` })
    .setTimestamp();

  if (openerId) {
    e.addFields({ name: "Customer", value: `<@${openerId}>`, inline: true });
  }

  if (amount != null) {
    e.addFields({ name: "Amount", value: fmtMoney(amount), inline: true });
  }

  if (note) {
    e.addFields({ name: "Note", value: note, inline: false });
  }

  const methodFields = Object.entries(info.methods || {}).map(([method, value]) => ({
    name: method,
    value: value,
    inline: true
  }));

  if (methodFields.length) e.addFields(methodFields);

  return e;
}

// Auto-split buttons into rows of max 5
function buildPayButtons(info) {
  const methods = Object.entries(info.methods || {});
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (const [method, value] of methods) {
    // Copy button
    const encodedName = encodeURIComponent(method);

    // If row full, push and start new
    if (currentRow.components.length === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }

    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`pay:copy:${encodedName}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(method.length > 20 ? method.slice(0, 17) + "..." : method)
    );

    // If it's a URL, also add an "Open" link button
    if (/^https?:\/\//i.test(value)) {
      if (currentRow.components.length === 5) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder();
      }

      currentRow.addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(`Open ${method.length > 16 ? method.slice(0, 13) + "..." : method}`)
          .setURL(value)
      );
    }
  }

  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

// ============================================
// TICKET OPENER DETECTION (TicketTool-aware)
// ============================================

async function fetchAllMessages(channel, limit = 300) {
  let all = [];
  let lastId = undefined;

  while (all.length < limit) {
    const batch = await channel.messages.fetch({
      limit: Math.min(limit - all.length, 100),
      before: lastId
    });

    if (!batch.size) break;

    all.push(...batch.values());
    lastId = batch.last().id;
  }

  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

// Ticket opener:
// 1) First TicketTool bot message that mentions a user
// 2) First human non-staff message
// 3) Any first human message
async function findOpener(channel, messages) {
  // 1) TicketTool bot welcome
  for (const msg of messages) {
    if (msg.author?.id === TICKETTOOL_BOT_ID && msg.mentions?.users?.size > 0) {
      const mentioned = msg.mentions.users.first();
      if (mentioned) return mentioned.id;
    }
  }

  // 2) First human non-staff
  for (const msg of messages) {
    if (!msg.author || msg.author.bot) continue;
    const member = msg.member;
    if (member?.roles?.cache?.some(r => STAFF_ROLE_IDS.includes(r.id))) continue;
    return msg.author.id;
  }

  // 3) First human at all
  const firstHuman = messages.find(m => !m.author?.bot);
  return firstHuman?.author?.id || null;
}

// ============================================
// ============================================
// VOUCH → CUSTOMER TIER ROLES
// ============================================

function tierForCount(count) {
  if (count >= 12) {
    return { label: "VILTRUMITE (Loyal Customer)", roleId: VILTRUMITE_ROLE_ID };
  } else if (count >= 7) {
    return { label: "Frequent Buyer", roleId: FREQUENT_BUYER_ROLE_ID };
  } else if (count >= 3) {
    return { label: "Verified Buyer", roleId: VERIFIED_BUYER_ROLE_ID };
  }
  return null;
}

/**
 * Sync customer tier roles to match the CURRENT vouch count (adds + removes).
 * Used after /vouch, /vouch_add, and /vouch_remove so roles always reset correctly.
 */
async function syncCustomerTierRoles(guild, member, count) {
  if (!guild || !member) return;

  const tierRoleIds = [
    VERIFIED_BUYER_ROLE_ID,
    FREQUENT_BUYER_ROLE_ID,
    VILTRUMITE_ROLE_ID
  ].filter(Boolean);

  const tier = tierForCount(count);
  const desiredRoleId = tier?.roleId || null;

  // Remove ALL tier roles first (so downgrades/role resets work)
  const toRemove = tierRoleIds.filter(rid => member.roles.cache.has(rid));
  if (toRemove.length) {
    await member.roles.remove(toRemove).catch(() => {});
  }

  // Add the correct tier (if any)
  if (desiredRoleId) {
    const role = guild.roles.cache.get(desiredRoleId);
    if (role) {
      await member.roles.add(role).catch(() => {});
    }
  }
}

// ============================================
// TRANSCRIPT HELPERS
// ============================================

// Replace mentions with readable names
function replaceMentions(text, msg) {
  if (!text) return "";
  let out = text;

  // Users
  msg.mentions?.users?.forEach(u => {
    out = out.replace(new RegExp(`<@!?${u.id}>`, "g"), `@${u.username}`);
  });

  // Channels
  msg.mentions?.channels?.forEach(c => {
    out = out.replace(new RegExp(`<#${c.id}>`, "g"), `#${c.name}`);
  });

  return out;
}

// Render embed inside transcript
function renderEmbedBlock(embed) {
  const e = embed.data || embed;

  const title = e.title ? `<div class="e-title">${escapeHTML(e.title)}</div>` : "";
  const desc = e.description ? `<div class="e-desc">${escapeHTML(e.description)}</div>` : "";

  const fields = (e.fields || [])
    .map(f => `
      <div class="e-field">
        <strong>${escapeHTML(f.name)}:</strong>
        <div>${escapeHTML(f.value)}</div>
      </div>
    `)
    .join("");

  const img = e.image?.url ? `<img class="e-image" src="${e.image.url}">` : "";
  const thumb = e.thumbnail?.url ? `<img class="e-thumb" src="${e.thumbnail.url}">` : "";

  return `<div class="embed">${title}${desc}${fields}${thumb}${img}</div>`;
}

// Download avatar to local server
async function getLocalAvatar(userObj) {
  if (!userObj) return "https://cdn.discordapp.com/embed/avatars/0.png";

  const u = userObj.user || userObj;

  const url = safeAvatarUrl(u) || "https://cdn.discordapp.com/embed/avatars/0.png";
  const fname = `avatar-${u.id}.png`;
  const dest = localAttachPath(fname);

  if (!fs.existsSync(dest)) {
    try {
      await downloadTo(dest, url);
    } catch {
      return url;
    }
  }

  return localAttachUrl(fname);
}

// Generate transcript HTML
async function generateTranscriptHTML({ guild, channel, opener, closer, messages, ticketId }) {
  let blocks = [];

  for (const m of messages) {
    const avatar = await getLocalAvatar(m.member || m.author);

    const name =
      m.member?.nickname ||
      m.author?.globalName ||
      m.author?.username ||
      m.author?.tag ||
      "Unknown";

    const time = new Date(m.createdTimestamp).toLocaleString();

    const content = m.content
      ? `<div class="msg-text">${escapeHTML(replaceMentions(m.content, m))}</div>`
      : "";

    const embedBlocks = (m.embeds || []).map(e => renderEmbedBlock(e)).join("");

    const atts = [];
    if (m.attachments?.size) {
      for (const a of m.attachments.values()) {
        const fname = `att-${m.id}-${a.name}`.replace(/[^a-z0-9._-]/gi, "_");
        const dest = localAttachPath(fname);

        try {
          await downloadTo(dest, a.url);
          atts.push(`<img class="att-img" src="${localAttachUrl(fname)}">`);
        } catch {
          atts.push(
            `<a class="att-file" href="${a.url}" target="_blank">${escapeHTML(a.name || "file")}</a>`
          );
        }
      }
    }

    blocks.push(`
      <div class="msg">
        <img class="avatar" src="${avatar}">
        <div class="body">
          <div class="head">
            <span class="name">${escapeHTML(name)}</span>
            <span class="time">${escapeHTML(time)}</span>
          </div>
          ${content}${embedBlocks}${atts.join("")}
        </div>
      </div>
    `);
  }

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Transcript — ${escapeHTML(channel.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">

<style>
body { background:#0b0f14; color:#e5e7eb; font-family:Arial; margin:0; padding:24px; }
.card { background:#0f1620; padding:20px; border-radius:12px; max-width:900px; margin:auto; }
.badge { display:inline-block; background:#111827; padding:6px 10px; border-radius:8px; margin-right:8px; }
.msg { display:flex; border-bottom:1px solid #1f2937; padding:12px 0; gap:12px; }
.avatar { width:40px; height:40px; border-radius:50%; }
.msg-text { white-space:pre-wrap; }
.embed { background:#0c1320; border-left:3px solid #3b82f6; padding:10px; margin-top:6px; }
.att-img { max-width:100%; border-radius:6px; margin-top:8px; }
</style>

</head>
<body>
  <div class="card">
    <h1>Ticket Transcript</h1>

    <div class="badge"><b>Guild:</b> ${escapeHTML(guild.name)}</div>
    <div class="badge"><b>Channel:</b> ${escapeHTML(channel.name)}</div>
    <div class="badge"><b>Ticket ID:</b> ${escapeHTML(ticketId)}</div>
    <div class="badge"><b>Opened By:</b> @${escapeHTML(
      opener?.user?.username || opener?.displayName || "Unknown"
    )}</div>
    <div class="badge"><b>Closed By:</b> @${escapeHTML(
      closer?.user?.username || closer?.displayName || "Unknown"
    )}</div>

    ${blocks.join("")}

    <footer style="opacity:.5; margin-top:20px; font-size:12px;">
      Generated by INVINCIBLE EATS
    </footer>
  </div>
</body>
</html>
  `;
}

// Generic transcript + log + DM (used by /closeticket AND /closealltickets)
async function generateAndLogTranscript({ guild, channel, closerUser }) {
  const messages = await fetchAllMessages(channel, 1000);
  const openerId = await findOpener(channel, messages);

  const opener = openerId ? await guild.members.fetch(openerId).catch(() => null) : null;
  const closer = await guild.members.fetch(closerUser.id).catch(() => null);

  const ticketId = `${Date.now()}`;

  const html = await generateTranscriptHTML({
    guild,
    channel,
    opener,
    closer,
    messages,
    ticketId
  });

  const fileName = `ticket-${channel.id}-${ticketId}.html`;
  const filePath = path.join(TRANSCRIPT_DIR, fileName);

  fs.writeFileSync(filePath, html, "utf8");

  const hostedUrl = `${externalBase()}/transcripts/${encodeURIComponent(fileName)}`;

  const tempPath = path.join(os.tmpdir(), fileName);
  fs.writeFileSync(tempPath, html, "utf8");
  const attachment = new AttachmentBuilder(tempPath, { name: fileName });

  // Log channel: per-guild config > fixed transcript log > fallback (current channel)
  const cfg = ticketCfgStore[guild.id] || {};
  const logChannel =
    (cfg.ticketLogChannelId && client.channels.cache.get(cfg.ticketLogChannelId)) ||
    client.channels.cache.get(TRANSCRIPT_LOG_ID) ||
    channel;

  const logEmbed = new EmbedBuilder()
    .setColor(0x34d399)
    .setTitle("📦 Ticket Closed (Logged)")
    .setDescription(`Transcript generated.\n\n[Open transcript in browser](${hostedUrl})`)
    .addFields(
      { name: "Channel", value: `#${channel.name}`, inline: true },
      { name: "Closed By", value: `${closerUser}`, inline: true },
      { name: "Opened By", value: opener ? `${opener}` : "Unknown", inline: true },
      { name: "Messages", value: String(messages.length), inline: true },
      { name: "Ticket ID", value: ticketId, inline: true }
    )
    .setTimestamp();

  const logRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel("View Transcript")
      .setURL(hostedUrl)
  );

  await logChannel.send({
    embeds: [logEmbed],
    components: [logRow],
    files: [attachment]
  }).catch(() => {});

  // DM to opener (best-effort)
  if (opener) {
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(0x38bdf8)
        .setTitle("📁 Your Ticket Transcript")
        .setDescription(
          `Here is your transcript for **#${channel.name}**.\n\nUse the button below or download the attached file.`
        )
        .setTimestamp();

      const dmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Open Transcript")
          .setURL(hostedUrl)
      );

      await opener.send({
        embeds: [dmEmbed],
        components: [dmRow],
        files: [attachment]
      });
    } catch {
      // ignore DM fails
    }
  }

  return { openerId, ticketId, hostedUrl, messagesCount: messages.length };
}

// Close & delete a ticket channel (best-effort)
async function saveAndCloseChannel({ guild, channel, closerUser, mode }) {
  if (!channel || !channel.isTextBased()) return { ok: false, reason: "not_text" };

  let transcript = null;

  if (mode === "save_close") {
    transcript = await generateAndLogTranscript({ guild, channel, closerUser }).catch(() => null);
  }

  // Delete channel
  await channel.delete().catch(() => {});
  return { ok: true, transcript };
}

// Find ticket channels for close-all
function getTicketCandidates(guild, categoryIdOverride = null) {
  const cfg = ticketCfgStore[guild.id] || {};
  const categoryId = categoryIdOverride || cfg.ticketCategoryId || null;
  const prefix = (cfg.ticketNamePrefix || "ticket-").toLowerCase();

  const channels = [...guild.channels.cache.values()].filter(ch =>
    ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)
  );

  return channels.filter(ch => {
    if (categoryId && ch.parentId !== categoryId) return false;

    const name = (ch.name || "").toLowerCase();
    if (isTicketChannel(name)) return true;
    if (name.startsWith(prefix)) return true;

    // Some bots use "support-1234" or similar; catch channels ending in digits in a tickets category
    if (categoryId && /\d{3,}$/.test(name)) return true;

    return false;
  });
}

// ============================================
// INTERACTION HANDLER
// ============================================

client.on("interactionCreate", async interaction => {
  try {
    // ========== MODALS ==========
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "bump:copy_modal") {
        // We can't auto-copy or auto-paste. This confirmation is just guidance.
        return interaction.reply({
          content: "✅ Copy **/bump** from the box above, then paste it in chat to bump on DISBOARD.",
          ephemeral: true
        });
      }
    }

        // ========== BUTTONS ==========
    if (interaction.isButton()) {
      const id = interaction.customId;

      // Bump copy button
      if (id === "bump:copy") {
        const mention = getDisboardCommandMention(interaction.guildId);

        // IMPORTANT:
        // To get Discord's built-in "Copy" button UI on mobile, the message content
        // must be ONLY a code block (no extra text before/after).
        // So we put any extra info in an embed, and keep content as just ```/bump```.
        const infoEmbed = new EmbedBuilder()
          .setColor(0x34d399)
          .setTitle("DISBOARD Bump")
          .setDescription(
            mention
              ? `Tap the clickable command if configured:\n${mention}\n\nOr copy /bump below.`
              : "Copy /bump below and run it in the bump channel."
          );

        return interaction.reply({
          content: "```/bump```",
          embeds: [infoEmbed],
          ephemeral: true
        });
      }

      // Pay copy buttons: pay:copy:<encodedMethodName>
      if (id.startsWith("pay:copy:")) {
        const encoded = id.split("pay:copy:")[1] || "";
        const methodName = decodeURIComponent(encoded);

        // Try to read the last /pay embed to find the staff member mentioned in title (best-effort),
        // otherwise fall back to just saying "Copied".
        // We store by methodName only, so we need to search payStore for a matching method.
        let value = null;
        for (const staffId of Object.keys(payStore)) {
          const info = payStore[staffId];
          if (info?.methods && Object.prototype.hasOwnProperty.call(info.methods, methodName)) {
            value = info.methods[methodName];
            break;
          }
        }

        if (!value) {
          return interaction.reply({ content: "Couldn't find that payment value.", ephemeral: true });
        }

        return interaction.reply({
          content: `✅ Copy this:
\`\`\`${String(value)}\`\`\``,
          ephemeral: true
        });
      }

      // Calc copy total: calc:copy_total:<cents>
      if (id.startsWith("calc:copy_total:")) {
        const centsStr = id.split("calc:copy_total:")[1] || "0";
        const cents = Number(centsStr);
        const total = isFinite(cents) ? (cents / 100) : 0;
        const formatted = fmtMoney(total);

        return interaction.reply({
          content: `✅ Copy total:
\`\`\`${formatted}\`\`\``,
          ephemeral: true
        });
      }

      // Ticket close buttons
      if (id === "ticket:save_close" || id === "ticket:delete_only") {
        const guild = interaction.guild;
        const channel = interaction.channel;

        if (!guild || !channel) {
          return interaction.reply({ content: "Guild/channel not found.", ephemeral: true });
        }

        const can = interaction.member?.permissions?.has(PermissionFlagsBits.ManageChannels);
        if (!can) {
          return interaction.reply({ content: "You need **Manage Channels**.", ephemeral: true });
        }

        if (!isTicketChannel(channel.name)) {
          return interaction.reply({ content: "This can only be used in a ticket channel.", ephemeral: true });
        }

        const mode = id === "ticket:save_close" ? "save_close" : "delete_only";

        await interaction.deferReply({ ephemeral: true });
        try {
          await saveAndCloseChannel({
            guild,
            channel,
            closerUser: interaction.user,
            mode
          });

          // Channel may be deleted; editing reply may still work, but guard it.
          await safeEditReply(interaction, 
            mode === "save_close"
              ? "✅ Saved transcript and closed the ticket."
              : "🗑️ Deleted the ticket (no transcript)."
          ).catch(() => {});
        } catch (e) {
          await safeEditReply(interaction, "❌ Failed to close this ticket. Check bot permissions.").catch(() => {});
        }
        return;
      }

      // Unknown button
      return;
    }

    // ========== SLASH COMMANDS ==========
    if (!interaction.isChatInputCommand()) return;
    const cmd = interaction.commandName;

    // AUTOCLOSE_NOW (manual test)
    // AUTOCLOSE_NOW
if (cmd === "autoclose_now") {
  const cfg = getServerCfg(interaction.guildId);
  const controlRoleId = cfg.justiceChefRoleId || JUSTICE_CHEF_ROLE_ID;
  const can =
    interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    interaction.member.roles.cache.has(controlRoleId);

  if (!can) {
    return interaction.reply({ content: "You need **Manage Channels**, **Manage Server**, or the configured staff role.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const state = (interaction.options.getString("state") || "closed").toLowerCase();
  const announceMode = (interaction.options.getString("announce") || "none").toLowerCase();
  const quiet = interaction.options.getBoolean("quiet") || false;

  const pingRole = interaction.options.getRole("ping_role");
  const pingUser = interaction.options.getUser("ping_user");

  const customTitle = interaction.options.getString("custom_title") || "";
  const customText = interaction.options.getString("custom_text") || "";

  const announceStandard = announceMode === "standard";
  const announceCustom = announceMode === "custom";

  if (announceCustom && !customText) {
    return safeEditReply(interaction, "If **announce = Custom**, you must provide **custom_text**.");
  }

  const guild = interaction.guild;
  if (!guild) return safeEditReply(interaction, "Guild not found.");

  let res = null;

  try {
    if (state === "break") {
      res = await forceBreakServer(guild, "Manual override", {
        announce: announceStandard,
        pingRoleId: pingRole?.id || null,
        pingUserId: pingUser?.id || null
      });
    } else if (state === "open") {
      // Allow as an override, even from /autoclose_now (useful if you fat-finger commands)
      res = await forceOpenServer(guild, "Manual override", {
        announce: announceStandard,
        pingRoleId: pingRole?.id || null,
        pingUserId: pingUser?.id || null
      });
    } else {
      res = await forceCloseServer(guild, "Manual override", {
        announce: announceStandard,
        pingRoleId: pingRole?.id || null,
        pingUserId: pingUser?.id || null
      });
    }

    // Custom announcement (optional)
    if (announceCustom) {
      const ping =
        pingRole?.id ? `<@&${pingRole.id}>` : pingUser?.id ? `<@${pingUser.id}>` : "";

      const defaultTitle =
        state === "open" ? "🟢 OPEN" : state === "break" ? "🟡 ON BREAK" : "🔴 CLOSED";

      await postStatusAnnouncement(guild, {
        content: ping || undefined,
        title: customTitle || defaultTitle,
        description: customText
      }).catch(() => {});
    }

  } catch (err) {
    return safeEditReply(interaction, `Error: ${err.message || err}`);
  }

  if (quiet) return safeEditReply(interaction, "✅ Done.");

  const annLabel =
    announceMode === "none" ? "No" : announceMode === "standard" ? "Standard" : "Custom";

  return safeEditReply(
    interaction,
    `✅ Status set to **${state.toUpperCase()}**.\nAnnouncement: **${annLabel}**\n` +
    `Status channel renamed: **${res?.renamedStatusChannel ? "Yes" : "No"}**\n` +
    `Order channel updated: **${res?.updatedHeroOverwrite ? "Yes" : "No"}**\n` +
    `Removed Patrol role from: **${res?.removedPatrolFrom ?? 0}** member(s)`
  );
}
// AUTOOPEN_NOW (manual test)
    // AUTOOPEN_NOW
if (cmd === "autoopen_now") {
  const cfg = getServerCfg(interaction.guildId);
  const controlRoleId = cfg.justiceChefRoleId || JUSTICE_CHEF_ROLE_ID;
  const can =
    interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    interaction.member.roles.cache.has(controlRoleId) ||
    interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

  if (!can) {
    return interaction.reply({ content: "You need **Manage Channels** or **Justice Chef**.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const state = (interaction.options.getString("state") || "open").toLowerCase();
  const announceMode = (interaction.options.getString("announce") || "none").toLowerCase();
  const quiet = interaction.options.getBoolean("quiet") || false;

  const pingRole = interaction.options.getRole("ping_role");
  const pingUser = interaction.options.getUser("ping_user");

  const customTitle = interaction.options.getString("custom_title") || "";
  const customText = interaction.options.getString("custom_text") || "";

  const announceStandard = announceMode === "standard";
  const announceCustom = announceMode === "custom";

  if (announceCustom && !customText) {
    return safeEditReply(interaction, "If **announce = Custom**, you must provide **custom_text**.");
  }

  const guild = interaction.guild;
  if (!guild) return safeEditReply(interaction, "Guild not found.");

  let res = null;

  try {
    if (state === "break") {
      res = await forceBreakServer(guild, "Manual override", {
        announce: announceStandard,
        pingRoleId: pingRole?.id || null,
        pingUserId: pingUser?.id || null
      });
    } else if (state === "closed") {
      res = await forceCloseServer(guild, "Manual override", {
        announce: announceStandard,
        pingRoleId: pingRole?.id || null,
        pingUserId: pingUser?.id || null
      });
    } else {
      res = await forceOpenServer(guild, "Manual override", {
        announce: announceStandard,
        pingRoleId: pingRole?.id || null,
        pingUserId: pingUser?.id || null
      });
    }

    // Custom announcement (optional)
    if (announceCustom) {
      const ping =
        pingRole?.id ? `<@&${pingRole.id}>` : pingUser?.id ? `<@${pingUser.id}>` : "";

      const defaultTitle =
        state === "open" ? "🟢 OPEN" : state === "break" ? "🟡 ON BREAK" : "🔴 CLOSED";

      await postStatusAnnouncement(guild, {
        content: ping || undefined,
        title: customTitle || defaultTitle,
        description: customText
      }).catch(() => {});
    }

  } catch (err) {
    return safeEditReply(interaction, `Error: ${err.message || err}`);
  }

  if (quiet) return safeEditReply(interaction, "✅ Done.");

  const annLabel =
    announceMode === "none" ? "No" : announceMode === "standard" ? "Standard" : "Custom";

  return safeEditReply(
    interaction,
    `✅ Status set to **${state.toUpperCase()}**.\nAnnouncement: **${annLabel}**\n` +
    `Status channel renamed: **${res?.renamedStatusChannel ? "Yes" : "No"}**\n` +
    `Order channel updated: **${res?.updatedHeroOverwrite ? "Yes" : "No"}**`
  );
}

// HELP
    if (cmd === "help") {
      const e = new EmbedBuilder()
        .setColor(0x2dd4bf)
        .setTitle("INVINCIBLE EATS — Commands")
        .setDescription([
          "**Setup:** /server_setup",
          "**Tickets:** /claim /closeticket /ticket_config /closealltickets",
          "**Payments:** /setpay /delpay /pay /showpay",
          "**Orders:** /ueinspect",
          "**Vouching:** /vouch /vouchcount",
          "**Moderation:** /scanpromos",
          "**Bump:** /bump_config /bump /bumpstatus",
          "**Utility:** /announce /sayembed /invoice /calc /autoclose_now /autoopen_now",
          "**General:** /help"
        ].join("\n"));

      return interaction.reply({ embeds: [e], ephemeral: true });
    }

    // ORDERPERMS (debug)
    if (cmd === "orderperms") {
      const guild = interaction.guild;
      if (!guild) return interaction.reply({ content: "Guild not found.", ephemeral: true });

      const cfg = getServerCfg(interaction.guildId);

      const user = interaction.options.getUser("user");

      const orderCh =
        guild.channels.cache.get(cfg.orderChannelId) ||
        (await guild.channels.fetch(cfg.orderChannelId).catch(() => null));

      if (!orderCh) {
        return interaction.reply({ content: "Orders channel not found. Run /server_setup.", ephemeral: true });
      }

      const heroOw = orderCh.permissionOverwrites?.cache?.get(cfg.heroRoleId) || null;
      const everyoneOw = orderCh.permissionOverwrites?.cache?.get(guild.id) || null;

      const fmtOw = (ow) => {
        if (!ow) return "(none)";
        const allow = ow.allow?.toArray?.() || [];
        const deny = ow.deny?.toArray?.() || [];
        return `allow: [${allow.join(', ')}]
 deny: [${deny.join(', ')}]`;
      };

      let effectiveLine = "—";
      if (user) {
        const mem = await guild.members.fetch(user.id).catch(() => null);
        if (mem) {
          const perms = orderCh.permissionsFor(mem);
          const isAdmin = mem.permissions.has(PermissionFlagsBits.Administrator);
          const canView = perms?.has(PermissionFlagsBits.ViewChannel) || false;
          const canHist = perms?.has(PermissionFlagsBits.ReadMessageHistory) || false;
          const canSend = perms?.has(PermissionFlagsBits.SendMessages) || false;
          effectiveLine = `Admin: ${isAdmin ? 'YES' : 'no'} | View: ${canView ? 'YES' : 'no'} | History: ${canHist ? 'YES' : 'no'} | Send: ${canSend ? 'YES' : 'no'}`;
        } else {
          effectiveLine = "(user not found in guild)";
        }
      }

      const e = new EmbedBuilder()
        .setColor(0x64748b)
        .setTitle('Order Channel Permission Debug')
        .setDescription(`Channel: <#${orderCh.id}>

**HERO overwrite**
\`\`\`
${fmtOw(heroOw)}
\`\`\`

**@everyone overwrite**
\`\`\`
${fmtOw(everyoneOw)}
\`\`\`

**Effective (user)**
${effectiveLine}`)
        .setTimestamp();

      return interaction.reply({ embeds: [e], ephemeral: true });
    }

    // SCANPROMOS
    if (cmd === "scanpromos") {
      const limit = interaction.options.getInteger("limit") || 200;
      await interaction.deferReply({ ephemeral: true });

      let removed = 0;
      const msgs = await interaction.channel.messages.fetch({ limit: limit }).catch(() => null);

      if (msgs) {
        for (const [, m] of msgs) {
          const embedText = m.embeds
            ?.map(e => `${e.title || ""} ${e.description || ""} ${e.url || ""}`)
            .join(" ");

          const combined = `${m.content || ""} ${embedText || ""}`;

          const allowedOrderLink = ORDER_LINK_ALLOWLIST.some(r => r.test(combined));
          if (allowedOrderLink) continue;

          if (PROMO_PATTERNS.some(r => r.test(combined))) {
            await m.delete().catch(() => {});
            removed++;
          }
        }
      }

      return safeEditReply(interaction, `Removed **${removed}** promotional messages.`);
    }
// SETPAY (flexible)
    if (cmd === "setpay") {
      const member = interaction.member;
      const allowed =
        member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        member.roles.cache.has(JUSTICE_CHEF_ROLE_ID);

      if (!allowed) {
        return interaction.reply({
          content: "You must have **Justice Chef** or **Manage Server**.",
          ephemeral: true
        });
      }

      const user = interaction.options.getUser("staff", true);
      const name = interaction.options.getString("name", true);
      const methodsRaw = interaction.options.getString("methods", true);

      const methods = {};
      for (const lineRaw of methodsRaw.split(/\r?\n/)) {
        const line = lineRaw.trim();
        if (!line) continue;
        const parts = line.split("=");
        if (parts.length < 2) continue;
        const methodName = parts[0].trim();
        const value = parts.slice(1).join("=").trim();
        if (!methodName || !value) continue;
        methods[methodName] = value;
      }

      if (!Object.keys(methods).length) {
        return interaction.reply({
          content: "No valid methods found. Use format: `Method = Value` (one per line).",
          ephemeral: true
        });
      }

      payStore[user.id] = { name, methods };
      writeJson("pay.json", payStore);

      return interaction.reply({
        content: `Saved payment methods for **${name}**.`,
        ephemeral: true
      });
    }

    // DELPAY
    if (cmd === "delpay") {
      const user = interaction.options.getUser("staff", true);
      if (!payStore[user.id]) {
        return interaction.reply({
          content: `No payment info found for **${user.tag}**.`,
          ephemeral: true
        });
      }

      delete payStore[user.id];
      writeJson("pay.json", payStore);

      return interaction.reply({
        content: `Deleted payment info for **${user.tag}**.`,
        ephemeral: true
      });
    }

    // PAY (pings ticket opener)
    if (cmd === "pay") {
      const staff = interaction.options.getUser("staff", true);
      const saved = payStore[staff.id];

      if (!saved) {
        return interaction.reply({ content: `No saved payment info for that staff member.`, ephemeral: true });
      }

      const amount = interaction.options.getNumber("amount");
      const note = interaction.options.getString("note") || "";
      const channel = interaction.channel;

      let openerId = null;
      if (channel && isTicketChannel(channel.name)) {
        const messages = await fetchAllMessages(channel, 200);
        openerId = await findOpener(channel, messages);
      }

      const embed = buildPayEmbed(interaction.user, staff, saved, amount ?? null, note, openerId);
      const components = buildPayButtons(saved);

      const payload = {
        embeds: [embed],
        components,
        ephemeral: false
      };

      if (openerId) {
        payload.content = `<@${openerId}>`;
      }

      return interaction.reply(payload);
    }

    // SHOWPAY
    if (cmd === "showpay") {
      const staff = interaction.options.getUser("staff", true);
      const saved = payStore[staff.id];

      if (!saved) {
        return interaction.reply({
          content: `No payment info saved for **${staff.tag}**.`,
          ephemeral: true
        });
      }

      const note = interaction.options.getString("note") || "";
      const embed = buildPayEmbed(interaction.user, staff, saved, null, note, null);
      const components = buildPayButtons(saved);

      return interaction.reply({ embeds: [embed], components, ephemeral: false });
    }

    // BUMP CONFIG
    if (cmd === "bump_config") {
      const interval = interaction.options.getInteger("interval") || 120;
      const pingRole = interaction.options.getRole("ping_role");
      const pingUser = interaction.options.getUser("ping_user");
      const cmdMentionRaw = normalizeDisboardCommandMention(interaction.options.getString("command_mention") || "");

      bumpStore[interaction.guildId] = {
        intervalMin: interval,
        channelId: interaction.channelId,
        lastBumpTs: Date.now(),
        pingRoleId: pingRole?.id || null,
        pingUserId: pingUser?.id || null,
        disboardCommandMention: cmdMentionRaw || (bumpStore[interaction.guildId]?.disboardCommandMention || null)
      };

      writeJson("bumps.json", bumpStore);
      scheduleBumpTimer(interaction.guildId);

      return interaction.reply({
        content:
          `Bump reminders enabled every **${interval} minutes** in this channel.\n` +
          `Ping: ${pingRole ? `<@&${pingRole.id}>` : pingUser ? `<@${pingUser.id}>` : "**Server Owner (default)**"}\n\n` +
          `Reminder will include **the /bump command**, and if you set **command_mention**, it will show the clickable DISBOARD bump.`,
        ephemeral: true
      });
    }

    // BUMP
    if (cmd === "bump") {
      if (!bumpStore[interaction.guildId]) {
        return interaction.reply({ content: "Use **/bump_config** first.", ephemeral: true });
      }

      bumpStore[interaction.guildId].lastBumpTs = Date.now();
      writeJson("bumps.json", bumpStore);
      scheduleBumpTimer(interaction.guildId);

      return interaction.reply({ content: "Timer reset!", ephemeral: true });
    }

    // BUMPSTATUS
    if (cmd === "bumpstatus") {
      const cfg = bumpStore[interaction.guildId];
      if (!cfg) {
        return interaction.reply({ content: "Bump reminders are not enabled.", ephemeral: true });
      }

      const last = cfg.lastBumpTs || Date.now();
      const next = last + (cfg.intervalMin || 120) * 60000;
      const minsLeft = Math.max(0, Math.ceil((next - Date.now()) / 60000));

      return interaction.reply({
        content: minsLeft === 0
          ? "✅ **Bump is ready now!** Wait for the reminder or run DISBOARD `/bump`."
          : `Next reminder in **${minsLeft} minutes**.`,
        ephemeral: true
      });
    }

    // TICKET_CONFIG
    if (cmd === "ticket_config") {
      const category = interaction.options.getChannel("ticket_category");
      const prefix = interaction.options.getString("name_prefix");
      const logCh = interaction.options.getChannel("log_channel");

      ticketCfgStore[interaction.guildId] = {
        ticketCategoryId: category?.id || ticketCfgStore[interaction.guildId]?.ticketCategoryId || null,
        ticketNamePrefix: prefix || ticketCfgStore[interaction.guildId]?.ticketNamePrefix || "ticket-",
        ticketLogChannelId: logCh?.id || ticketCfgStore[interaction.guildId]?.ticketLogChannelId || null
      };

      writeJson("ticket_config.json", ticketCfgStore);

      return interaction.reply({
        content:
          `✅ Ticket config saved.\n` +
          `Category: ${ticketCfgStore[interaction.guildId].ticketCategoryId ? `<#${ticketCfgStore[interaction.guildId].ticketCategoryId}>` : "**(none)**"}\n` +
          `Prefix: **${ticketCfgStore[interaction.guildId].ticketNamePrefix}**\n` +
          `Log channel: ${ticketCfgStore[interaction.guildId].ticketLogChannelId ? `<#${ticketCfgStore[interaction.guildId].ticketLogChannelId}>` : "**(default transcript log / current channel)**"}`,
        ephemeral: true
      });
    }

    // SERVER_SETUP (multi-server)
    if (cmd === "server_setup") {
      const statusCh = interaction.options.getChannel("status_channel", true);
      const ordersCh = interaction.options.getChannel("orders_channel", true);
      const heroRole = interaction.options.getRole("hero_role", true);

      // Prevent misconfig: @everyone as hero role will make Orders visible to everyone when opened.
      // In Discord, @everyone role id == guild id.
      if (heroRole.id === interaction.guildId) {
        return interaction.reply({
          content:
            "⚠️ Don't use @everyone for `hero_role`.\n" +
            'That would make the bot toggle the Orders channel for *everyone*.\n\n' +
            'Create a customer/verified role (ex: **Hero In Training**) and rerun `/server_setup` using that role.',
          ephemeral: true
        });
      }

      const announceCh = interaction.options.getChannel("announce_channel");
      const patrolRole = interaction.options.getRole("patrol_role");
      const justiceRole = interaction.options.getRole("justice_role");
      const calcRole = interaction.options.getRole("calc_role");

      const ticketCategory = interaction.options.getChannel("ticket_category");
      const ticketPrefix = interaction.options.getString("ticket_prefix");
      const ticketLog = interaction.options.getChannel("ticket_log");

      const gid = interaction.guildId;
      const prev = serverCfgStore[gid] || {};

      serverCfgStore[gid] = {
        ...prev,
        statusChannelId: statusCh.id,
        orderChannelId: ordersCh.id,
        heroRoleId: heroRole.id,
        announceChannelId: announceCh?.id ?? prev.announceChannelId ?? STATUS_ANNOUNCE_CHANNEL_ID,
        patrolRoleId: patrolRole?.id ?? prev.patrolRoleId ?? JUSTICE_CHEF_ON_PATROL_ROLE_ID,
        justiceChefRoleId: justiceRole?.id ?? prev.justiceChefRoleId ?? JUSTICE_CHEF_ROLE_ID,
        calcRoleId: (calcRole?.id ?? justiceRole?.id ?? prev.calcRoleId ?? prev.justiceChefRoleId ?? JUSTICE_CHEF_ROLE_ID)
      };

      writeJson("server_config.json", serverCfgStore);

      // Optional: also save ticket config from the same command
      if (ticketCategory || ticketPrefix || ticketLog) {
        const tcPrev = ticketCfgStore[gid] || {};
        ticketCfgStore[gid] = {
          ...tcPrev,
          ticketCategoryId: ticketCategory?.id ?? tcPrev.ticketCategoryId ?? null,
          ticketNamePrefix: ticketPrefix ?? tcPrev.ticketNamePrefix ?? "ticket-",
          ticketLogChannelId: ticketLog?.id ?? tcPrev.ticketLogChannelId ?? null
        };
        writeJson("ticket_config.json", ticketCfgStore);
      }

      // Quick summary
      const cfg = getServerCfg(gid);
      const tc = ticketCfgStore[gid] || {};

      return interaction.reply({
        content:
          `✅ **Server setup saved for this server.**\n\n` +
          `**Status channel:** <#${cfg.statusChannelId}>\n` +
          `**Orders channel:** <#${cfg.orderChannelId}>\n` +
          `**Hero role:** <@&${cfg.heroRoleId}>\n` +
          `**Announce channel:** ${cfg.announceChannelId ? `<#${cfg.announceChannelId}>` : "**(none)**"}\n` +
          `**Patrol role:** ${cfg.patrolRoleId ? `<@&${cfg.patrolRoleId}>` : "**(none)**"}\n` +
          `**Justice Chef role:** ${cfg.justiceChefRoleId ? `<@&${cfg.justiceChefRoleId}>` : "**(none)**"}\n` +
          `**/calc role:** ${cfg.calcRoleId ? `<@&${cfg.calcRoleId}>` : "**(none)**"}` +
          (ticketCategory || ticketPrefix || ticketLog
            ? `\n\n**Ticket config (saved too):**\n` +
              `Category: ${tc.ticketCategoryId ? `<#${tc.ticketCategoryId}>` : "**(none)**"}\n` +
              `Prefix: **${tc.ticketNamePrefix || "ticket-"}**\n` +
              `Log channel: ${tc.ticketLogChannelId ? `<#${tc.ticketLogChannelId}>` : "**(default)**"}`
            : ""),
        ephemeral: true
      });
    }

    // HOSTURL_SET (fix transcript links)
    if (cmd === "hosturl_set") {
      const urlRaw = (interaction.options.getString("url", true) || "").trim();
      if (!/^https?:\/\//i.test(urlRaw)) {
        return interaction.reply({
          content: "Please enter a full URL that starts with http:// or https://",
          ephemeral: true
        });
      }

      const cleaned = urlRaw.replace(/\/$/, "");
      hostCfg.publicBaseUrl = cleaned;
      writeJson("host_config.json", hostCfg);

      return interaction.reply({
        content:
          `✅ Saved transcript host URL.\n` +
          `Bot will generate transcript links like: ${cleaned}/transcripts/...`,
        ephemeral: true
      });
    }

    // CLOSEALLTICKETS
    if (cmd === "closealltickets") {
      const amount = interaction.options.getInteger("amount"); // optional
      const mode = interaction.options.getString("mode") || "save_close";
      const categoryOverride = interaction.options.getChannel("ticket_category");

      const guild = interaction.guild;
      if (!guild) return interaction.reply({ content: "Guild not found.", ephemeral: true });

      await interaction.deferReply({ ephemeral: true });

      // Ensure full channel cache
      await guild.channels.fetch().catch(() => {});

      const candidates = getTicketCandidates(guild, categoryOverride?.id || null);

      if (!candidates.length) {
        return safeEditReply(interaction, 
          "No ticket channels found. Use **/ticket_config** to set the ticket category and prefix."
        );
      }

      const toClose = amount ? candidates.slice(0, amount) : candidates;

      let closed = 0;
      let failed = 0;

      // Close oldest first (roughly by id order)
      toClose.sort((a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0));

      for (const ch of toClose) {
        try {
          await saveAndCloseChannel({
            guild,
            channel: ch,
            closerUser: interaction.user,
            mode
          });

          closed++;
          // Small delay to reduce rate-limit risk
          await sleep(1200);
        } catch {
          failed++;
          await sleep(800);
        }
      }

      return safeEditReply(interaction, 
        `✅ Done.\nClosed: **${closed}**\nFailed: **${failed}**\nMode: **${mode}**`
      );
    }

    // VOUCH
    if (cmd === "vouch") {
      const staff = interaction.options.getUser("staff", true);
      const messageText = interaction.options.getString("message", true);
      const image = interaction.options.getAttachment("image");
      const target = interaction.options.getChannel("channel") || interaction.channel;

      // Calculate the NEW counts first (so the embed is accurate)
      const newStaffCount = (vouchByStaff[staff.id] || 0) + 1;
      const newCustCount = (vouchByCust[interaction.user.id] || 0) + 1;
      const tier = tierForCount(newCustCount);

      const e = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("✅ New Vouch")
        .setDescription(messageText)
        .addFields(
          { name: "Customer", value: `${interaction.user}`, inline: true },
          { name: "Served By", value: `${staff}`, inline: true },
          { name: "Customer Vouch Count", value: String(newCustCount), inline: true },
          { name: "Tier", value: tier ? tier.label : "—", inline: true }
        )
        .setTimestamp();

      if (image) e.setImage(image.url);

      let posted = true;
      try {
        await target.send({ embeds: [e] });
      } catch {
        posted = false;
      }

      // Persist counts
      vouchByStaff[staff.id] = newStaffCount;
      vouchByCust[interaction.user.id] = newCustCount;

      writeJson("vouches_by_staff.json", vouchByStaff);
      writeJson("vouches_by_customer.json", vouchByCust);

      // Apply customer tier roles (upgrade only)
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (member) {
        await syncCustomerTierRoles(interaction.guild, member, newCustCount);
      }

      return interaction.reply({
        content: posted
          ? "Vouch recorded — thank you!"
          : "Vouch recorded — thank you! (I couldn't post the embed in that channel due to permissions.)",
        ephemeral: true
      });
    }

    // VOUCHCOUNT
    if (cmd === "vouchcount") {
      const user = interaction.options.getUser("user") || interaction.user;
      const count = vouchByCust[user.id] || 0;
      const tier = tierForCount(count);

      const e = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle("Customer Loyalty Status")
        .setDescription(
          [
            `**User:** ${user}`,
            `**Vouches (as customer):** ${count}`,
            `**Tier:** ${tier ? tier.label : "—"}`
          ].join("\n")
        );

      return interaction.reply({ embeds: [e], ephemeral: true });
    }

    // VOUCH_ADD (manual)
    if (cmd === "vouch_add") {
      // Option name is "customer" (matches SlashCommandBuilder)
      const user = interaction.options.getUser("customer", true);
      const amount = interaction.options.getInteger("amount") || 1;

      const newCount = (vouchByCust[user.id] || 0) + amount;
      vouchByCust[user.id] = newCount;
      writeJson("vouches_by_customer.json", vouchByCust);

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (member) {
        // Manual adjustments use the strict ladder: remove old tier role(s) and apply the correct one.
        await syncCustomerTierRoles(interaction.guild, member, newCount);
      }

      const tier = tierForCount(newCount);

      return interaction.reply({
        content: `✅ Added **${amount}** vouch(es) to ${user}.\nNew count: **${newCount}**\nTier: **${tier ? tier.label : "—"}**`,
        ephemeral: true
      });
    }

    // VOUCH_REMOVE (manual)
    if (cmd === "vouch_remove") {
      // Option name is "customer" (matches SlashCommandBuilder)
      const user = interaction.options.getUser("customer", true);
      const amount = interaction.options.getInteger("amount") || 1;

      const current = vouchByCust[user.id] || 0;
      const newCount = Math.max(0, current - amount);
      vouchByCust[user.id] = newCount;
      writeJson("vouches_by_customer.json", vouchByCust);

      // Sync tier roles to match the new count (upgrades or downgrades as needed)
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (member) {
        await syncCustomerTierRoles(interaction.guild, member, newCount);
      }

      const tier = tierForCount(newCount);

      return interaction.reply({
        content: `✅ Removed **${amount}** vouch(es) from ${user}.\nNew count: **${newCount}**\nTier: **${tier ? tier.label : "—"}**`,
        ephemeral: true
      });
    }

    // ANNOUNCE
    if (cmd === "announce") {
      const title = interaction.options.getString("title", true);
      const body = interaction.options.getString("body", true);
      const channel = interaction.options.getChannel("channel") || interaction.channel;

      const e = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(title)
        .setDescription(body)
        .setTimestamp();

      await channel.send({ embeds: [e] });
      return interaction.reply({ content: "Announcement posted.", ephemeral: true });
    }

    // SAYEMBED
    if (cmd === "sayembed") {
      const text = interaction.options.getString("text", true);
      const embed = new EmbedBuilder()
        .setColor(0x1f2937)
        .setDescription(text)
        .setTimestamp();

      await interaction.channel.send({ embeds: [embed] });
      return interaction.reply({ content: "Sent!", ephemeral: true });
    }


    // CALC
    if (cmd === "calc") {
      const cfg = getServerCfg(interaction.guildId);
      const member = interaction.member;
      const calcRoleId = cfg.calcRoleId || cfg.justiceChefRoleId || JUSTICE_CHEF_ROLE_ID;
      // Access: configured calc role (defaults to Justice Chef). Keep Administrator as emergency override.
      const allowed =
        (calcRoleId ? member?.roles?.cache?.has(calcRoleId) : false) ||
        member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
        member?.permissions?.has(PermissionFlagsBits.Administrator);

      if (!allowed) {
        return interaction.reply({
          content: calcRoleId
            ? `Only <@&${calcRoleId}> (or Manage Server) can use /calc.`
            : "Only Manage Server can use /calc.",
          ephemeral: true
        });
      }

    const cost = interaction.options.getNumber("cost", true);
      const feeOpt = interaction.options.getNumber("fee");
      const publicFlag = interaction.options.getBoolean("public") || false;
      const explicitCustomer = interaction.options.getUser("customer");

      const baseFee = feeOpt != null ? feeOpt : DEFAULT_SERVICE_FEE;

      // Determine which customer we should apply discount roles for:
      // 1) explicit customer option
      // 2) ticket opener (if in a ticket channel)
      // 3) command invoker
      let customerMember = null;

      if (explicitCustomer) {
        customerMember = await interaction.guild.members.fetch(explicitCustomer.id).catch(() => null);
      } else if (interaction.channel && isTicketChannel(interaction.channel.name)) {
        const msgs = await fetchAllMessages(interaction.channel, 200).catch(() => []);
        const openerId = await findOpener(interaction.channel, msgs).catch(() => null);
        if (openerId) {
          customerMember = await interaction.guild.members.fetch(openerId).catch(() => null);
        }
      }

      if (!customerMember) {
        customerMember = interaction.member;
      }

      const discount = getBestFeeDiscountForMember(customerMember);
      const feeAfter = Math.max(0, baseFee - (discount.amount || 0));
      const total = (cost || 0) + feeAfter;

      const discountLine = discount.label
        ? `${discount.label} (−${fmtMoney(discount.amount)} fee)`
        : "None";

      const e = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("🧮 Payment Breakdown")
        .addFields(
          { name: "Customer", value: customerMember ? `${customerMember}` : `${interaction.user}`, inline: true },
          { name: "Cost to us", value: fmtMoney(cost), inline: true },
          { name: "Base fee", value: fmtMoney(baseFee), inline: true },
          { name: "Discount role", value: discountLine, inline: true },
          { name: "Final fee", value: fmtMoney(feeAfter), inline: true },
          { name: "Customer pays", value: `**${fmtMoney(total)}**`, inline: true }
        )
        .setTimestamp();

      const cents = Math.round(total * 100);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`calc:copy_total:${cents}`)
          .setStyle(ButtonStyle.Primary)
          .setLabel("Copy total")
      );

      return interaction.reply({
        embeds: [e],
        components: [row],
        ephemeral: !publicFlag
      });
    }

    // INVOICE
    if (cmd === "invoice") {
      const customer = interaction.options.getUser("customer", true);
      const amount = interaction.options.getNumber("amount", true);
      const items = interaction.options.getString("items", true);

      const e = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("🧾 Invoice / Receipt")
        .addFields(
          { name: "Customer", value: `${customer}`, inline: true },
          { name: "Amount", value: fmtMoney(amount), inline: true }
        )
        .setDescription(items)
        .setFooter({ text: `Generated by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.channel.send({ embeds: [e] });

      return interaction.reply({ content: "Invoice posted.", ephemeral: true });
    }

    // UEINSPECT
    if (cmd === "ueinspect") {
      const url = interaction.options.getString("url", true);
      const match = url.match(UE_REGEX);

      if (!match) {
        return interaction.reply({
          content: "Please provide a valid **Uber Eats group link**.",
          ephemeral: true
        });
      }

      const ch = client.channels.cache.get(UBER_TICKETS_CHANNEL);
      if (!ch) {
        return interaction.reply({ content: "Configured tickets channel missing.", ephemeral: true });
      }

      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x3b82f6)
            .setTitle("🍔 New Uber Eats Group Order")
            .setDescription(`Forwarded by ${interaction.user}\n\n${match[0]}`)
            .setTimestamp()
        ]
      });

      return interaction.reply({ content: "Forwarded to the tickets channel!", ephemeral: true });
    }

    // CLOSETICKET
    if (cmd === "closeticket") {
      const can = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);
      if (!can) {
        return interaction.reply({ content: "You need **Manage Channels**.", ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Close Ticket")
        .setDescription(
          "**Save & Close** — Generate transcript, DM user, log, delete.\n" +
          "**Delete Only** — Delete ticket WITHOUT saving."
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket:save_close")
          .setStyle(ButtonStyle.Success)
          .setEmoji("💾")
          .setLabel("Save & Close"),

        new ButtonBuilder()
          .setCustomId("ticket:delete_only")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("🗑️")
          .setLabel("Delete Only")
      );

      return interaction.reply({ embeds: [embed], components: row ? [row] : [], ephemeral: true });
    }

    // CLAIM (and UNCLAIM)
    if (cmd === "claim") {
      const member = interaction.member;
      const allowed =
        member.permissions.has(PermissionFlagsBits.ManageChannels) ||
        member.roles.cache.has(JUSTICE_CHEF_ROLE_ID);

      if (!allowed) {
        return interaction.reply({
          content: "You need **Manage Channels** or **Justice Chef on patrol**.",
          ephemeral: true
        });
      }

      const channel = interaction.channel;
      if (!channel || !isTicketChannel(channel.name)) {
        return interaction.reply({
          content: "This command can only be used in a ticket channel.",
          ephemeral: true
        });
      }

      const doUnclaim = interaction.options.getBoolean("unclaim") || false;

      // ----- UNCLAIM -----
      if (doUnclaim) {
        const ticketNumber = extractTicketNumberFromChannel(channel.name) || "0000";

        // Prefer the stored Original: name in the topic
        let originalName = `ticket-${ticketNumber}`;
        const topic = channel.topic || "";
        const m = topic.match(/Original:\s*([^\s|]+)/i);
        if (m && m[1]) originalName = m[1];

        try {
          await channel.edit({ name: originalName });
        } catch (e) {
          return interaction.reply({
            content: "Unclaim failed — check channel permissions.",
            ephemeral: true
          });
        }

        const e = new EmbedBuilder()
          .setColor(0x94a3b8)
          .setTitle("🧾 Ticket Unclaimed")
          .setDescription(`Reverted channel name back to: \`${originalName}\``)
          .setTimestamp();

        return interaction.reply({ embeds: [e], ephemeral: true });
      }

      // ----- CLAIM -----
      const targetUser = interaction.options.getUser("user");
      if (!targetUser) {
        return interaction.reply({
          content: "Pick a **user** to claim this ticket for, or run **/claim unclaim:true** to revert.",
          ephemeral: true
        });
      }

      const ticketNumber = extractTicketNumberFromChannel(channel.name) || "0000";

      const original = `ticket-${ticketNumber}`;
      const userSlug = slugifyUsername(targetUser.username);
      const newName = `${userSlug}-invincible-${ticketNumber}`;

      const newTopic =
        channel.topic && channel.topic.toLowerCase().includes("original:")
          ? channel.topic
          : `Original: ${original}${channel.topic ? ` | ${channel.topic}` : ""}`;

      try {
        await channel.edit({ name: newName, topic: newTopic });
      } catch (e) {
        return interaction.reply({
          content: "Rename failed — check channel permissions.",
          ephemeral: true
        });
      }

      const e = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("🎫 Ticket Claimed")
        .setDescription(
          `Ticket assigned to **${targetUser}**.\n\n` +
          `**New Name:** \`${newName}\`\n` +
          `**Original:** \`${original}\``
        )
        .setTimestamp();

      return interaction.reply({ embeds: [e], ephemeral: true });
    }

  } catch (err) {
    console.error("Interaction Error:", err);

    // If we already deferred (Discord shows "thinking…"), we MUST editReply/followUp,
    // otherwise the interaction will appear stuck forever.
    const msg = "Something went wrong.";
    try {
      if (interaction.deferred) {
        await safeEditReply(interaction, { content: msg });
      } else if (!interaction.replied) {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    } catch (e) {
      console.error("Failed to send interaction error response:", e);
    }
  }
});

// ============================================
// EXPRESS HOSTING
// ============================================

app.use("/transcripts", express.static(TRANSCRIPT_DIR));
app.use("/attachments", express.static(ATTACH_DIR));

// If you're behind a proxy (Replit/Render), this helps Express respect HTTPS
app.set("trust proxy", 1);

// Debug endpoint (safe): shows what base URL the bot is using for transcript links
app.get("/debug", (req, res) => {
  res.json({
    now: new Date().toISOString(),
    port: PORT,
    externalBase: externalBase(),
    env: {
      PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || null,
      REPLIT_DEV_DOMAIN: process.env.REPLIT_DEV_DOMAIN || null,
      REPLIT_DOMAINS: process.env.REPLIT_DOMAINS || null,
      REPLIT_URL: process.env.REPLIT_URL || null,
      RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL || null
    }
  });
});

app.get("/", (req, res) => {
  res.send("INVINCIBLE EATS — Transcript Host Active");
});

app.listen(PORT, () => console.log(`🌐 Transcript host running on port ${PORT}`));

// ============================================
// READY + LOGIN
// ============================================

client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  // Start bump timers (based on lastBumpTs so restarts are accurate)
  for (const guildId of Object.keys(bumpStore)) {
    scheduleBumpTimer(guildId);
  }

  // Start watchdog
  startStatusWatchdog(client);


  // Auto-close at 1:00 AM + optional no-ticket close
  startAutoCloseScheduler(client);
  console.log("🛡 Status Guard enabled.");
});

(async () => {
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
    console.log("⚠️ Missing environment variables — DISCORD_TOKEN or CLIENT_ID.");
    return;
  }

  try {
    await registerCommands();
  } catch (err) {
    console.log("Command registration failed:", err.message);
  }

  client.login(process.env.DISCORD_TOKEN);
})();
