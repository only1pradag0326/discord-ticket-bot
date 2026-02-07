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
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonStyle,
  AttachmentBuilder,
  ChannelType,
} = require("discord.js");

// NOTE: We intentionally do NOT use cookies/auth for DoorDash/Uber Eats.
// The "tracker" feature below is best-effort link parsing + preview only.
// Live driver/order status typically requires the user's authenticated session and/or private APIs.

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


function resolveDataPath(file) {
  // Some callers pass absolute paths (e.g., probing legacy locations).
  // Avoid path.join(DATA_DIR, absPath) which would create an invalid nested path.
  return path.isAbsolute(file) ? file : path.join(DATA_DIR, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(resolveDataPath(file), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(resolveDataPath(file), JSON.stringify(data, null, 2));
}

const payStore = readJson("pay.json", {});                // staffId -> { name, methods: { MethodName: value } }
// Supported payment method labels (also used for validation + display ordering)
const PAY_METHODS_ORDER = [
  "Cash App",
  "Venmo",
  "Apple Pay",
  "Zelle",
  "Chime",
  "Stripe",
  "PayPal",
  "Crypto"
];
function canonicalizePaymentMethodName(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Normalize to compare against known methods (letters/numbers only)
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "");

  const aliasMap = {
    cashapp: "Cash App",
    cash: "Cash App",
    venmo: "Venmo",
    applepay: "Apple Pay",
    apple: "Apple Pay",
    zelle: "Zelle",
    paypal: "PayPal",
    pp: "PayPal",
    crypto: "Crypto",
    coinbase: "Crypto",
    chime: "Chime",
    stripe: "Stripe",
  };

  if (aliasMap[normalized]) return aliasMap[normalized];

  // If the user typed an exact known method with different casing/spaces, keep canonical casing
  const known = PAY_METHODS_ORDER.find((m) => m.toLowerCase().replace(/[^a-z0-9]+/g, "") === normalized);
  if (known) return known;

  // Otherwise allow any custom method name; title-case it for a cleaner display.
  const titleCased = trimmed
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

  // Hard limit so embeds/UI don't get wrecked
  return titleCased.slice(0, 40);
}

function buildEditPayPanel({ guild, staffId }) {
  const entry = payStore[staffId] || { name: null, methods: {} };
  const staffMember = guild?.members?.cache?.get(staffId) || null;
  const staffName = entry.name || staffMember?.displayName || `User ${staffId}`;

  // Keep a stable ordering (common methods first, then any custom ones)
  const methods = entry.methods || {};
  const orderedKeys = [
    ...PAY_METHODS_ORDER.filter(k => methods[k]),
    ...Object.keys(methods).filter(k => !PAY_METHODS_ORDER.includes(k)).sort((a, b) => a.localeCompare(b))
  ];

  const lines = orderedKeys.length
    ? orderedKeys.map(k => `• **${k}**: ${methods[k]}`).join("\n")
    : "*(No payment methods saved yet.)*";

  const embed = new EmbedBuilder()
    .setTitle("Edit payment methods")
    .setDescription(`**Staff:** ${staffName}\n\n${lines}`)
    .setFooter({ text: "Use the buttons below to add/update or delete methods." });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`payedit:add:${staffId}`).setLabel("Add / Update").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`payedit:del:${staffId}`).setLabel("Delete").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`payedit:clear:${staffId}`).setLabel("Clear all").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`payedit:done:${staffId}`).setLabel("Done").setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}
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

// =========================
// DNF (Does Not Finish) CONFIG
// =========================
// Keep a single, stable on-disk location for DNF config so upgrades don't silently break.
// (Some earlier revisions accidentally read from an undefined variable, which made
// /dnf_setup look like it "did nothing".)
const DNF_CFG_FILE = "dnf_config.json";

// guildId -> { roleId, panelChannelIds: [] }
let dnfCfgStore = readJson(DNF_CFG_FILE, {});

// Best-effort migration for older filenames (no-op if not present)
// This keeps existing /dnf_setup data working after code updates.
try {
  if (!dnfCfgStore || Object.keys(dnfCfgStore).length === 0) {
    const legacyPaths = [
      // Common "root" locations
      path.join(process.cwd(), "dnf_config.json"),
      path.join(process.cwd(), "dnf.json"),
      path.join(process.cwd(), "dnfConfig.json"),
      path.join(process.cwd(), "dnf_cfg.json"),

      // Fallback to the folder where this script lives
      path.join(__dirname, "dnf_config.json"),
      path.join(__dirname, "dnf.json"),
      path.join(__dirname, "dnfConfig.json"),
      path.join(__dirname, "dnf_cfg.json"),
    ];

    for (const legacyPath of legacyPaths) {
      if (!fs.existsSync(legacyPath)) continue;
      try {
        const raw = fs.readFileSync(legacyPath, "utf8");
        const legacy = raw ? JSON.parse(raw) : null;
        if (legacy && typeof legacy === "object" && Object.keys(legacy).length) {
          dnfCfgStore = legacy;
          writeJson(DNF_CFG_FILE, dnfCfgStore);
          break;
        }
      } catch (_e) {
        // ignore a bad legacy file and keep trying
      }
    }
  }
} catch (e) {
  // ignore migration errors; bot will continue with empty config
}



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
const fmtMoneyCAD = n =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n ?? 0);


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
  // TicketTool default: ticket-####
  // Claimed names: <user>-<serverOrCategory>-####
  const n = String(name || "");
  return /^ticket-\d+$/i.test(n) || /-\d{3,}$/i.test(n);
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

// More specific DoorDash link types (best-effort parsing)
// NOTE: These pages are often client-rendered, so this is mainly for extracting IDs.
const DOORDASH_GIFT_REGEX = /https?:\/\/(?:www\.)?doordash\.com\/gifts\/([0-9a-f-]{32,36})(?:\?[^\s]*)?/i;
// Some users share DoorDash order links; this captures an order-ish identifier if present.
// Examples we try to recognize:
// - https://www.doordash.com/orders/<id>/...
// - https://www.doordash.com/order/<id>/...
const DOORDASH_ORDER_TRACK_REGEX = /https?:\/\/(?:www\.)?doordash\.com\/(?:orders|order)\/([^\s/?#]+)(?:[^\s]*)?/i;

const ORDER_LINK_ALLOWLIST = [UE_REGEX,
  UE_SHORT_REGEX, DOORDASH_REGEX, DOORDASH_SHORT_REGEX];

// ========================
// AUTO-BAN LINK SPAM (NON-STAFF)
// ========================
// ✅ Default behavior: ONLY ban Discord invite links.
// This prevents customers getting banned for normal restaurant sites.
//
// Optional:
// - Set BAN_ALL_LINKS=true if you *really* want to ban every other URL too.
// - Legacy env BAN_LINKS_ENABLED is still supported and maps to BAN_ALL_LINKS.
const BAN_INVITES_ENABLED = String(process.env.BAN_INVITES_ENABLED ?? "true").toLowerCase() === "true";
const BAN_ALL_LINKS = String(process.env.BAN_ALL_LINKS ?? (process.env.BAN_LINKS_ENABLED ?? "false")).toLowerCase() === "true";

// Ban reason shown in the server audit log.
const BAN_REASON_PREFIX = process.env.BAN_REASON_PREFIX || "Link spam / advertising";

// Optional: where to post an announcement when someone is banned.
// Leave blank to disable announcements.
const BAN_ANNOUNCE_CHANNEL_ID = process.env.BAN_ANNOUNCE_CHANNEL_ID || "1386924127222497350";

// Which links should NEVER trigger bans (order links + common restaurant platforms)
const RESTAURANT_URL_ALLOWLIST = [
  // Food platforms
  /https?:\/\/(www\.)?(eats\.uber\.com|ubereats\.com)\//i,
  /https?:\/\/(www\.)?(doordash\.com)\//i,
  /(?:https?:\/\/)?(?:www\.)?drd\.sh\//i,
  /https?:\/\/(www\.)?(grubhub\.com|postmates\.com|chownow\.com|toasttab\.com)\//i,
  /https?:\/\/(www\.)?(square\.site|squareup\.com|clover\.com|menufy\.com)\//i,

  // Reviews / maps (often used to share restaurant pages)
  /https?:\/\/(www\.)?yelp\.com\//i,
  /https?:\/\/(www\.)?google\.com\/maps\//i,
  /https?:\/\/maps\.app\.goo\.gl\//i
];

function isAllowedLink(text = "") {
  const combined = String(text || "");
  return (
    ORDER_LINK_ALLOWLIST.some(r => r.test(combined)) ||
    RESTAURANT_URL_ALLOWLIST.some(r => r.test(combined))
  );
}

// Discord invite links (discord.gg / discord.com/invite)
const DISCORD_INVITE_REGEX = /(https?:\/\/)?(www\.)?(discord\.gg|discord\.com\/invite)\/[\w-]+/i;

// Any normal URL (used only if BAN_ALL_LINKS=true)
const ANY_HTTP_URL_REGEX = /https?:\/\/[^\s]+/i;

function firstLinkSnippet(text = "") {
  const t = String(text || "");
  const m = t.match(DISCORD_INVITE_REGEX) || t.match(ANY_HTTP_URL_REGEX);
  return m ? m[0].slice(0, 180) : "";
}

// ============================================
// ORDER LINK TRACKER (best-effort link preview)
// ============================================

function extractFirstHttpUrl(text = "") {
  const t = String(text || "");
  const m = t.match(/https?:\/\/[^\s<>()]+/i);
  return m ? m[0] : "";
}

function classifyOrderLink(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  const host = (u.hostname || "").toLowerCase().replace(/^www\./, "");
  const path = (u.pathname || "").replace(/\/+$/, "");

  // DoorDash
  if (host.endsWith("doordash.com") || host === "drd.sh") {
    const gift = url.match(DOORDASH_GIFT_REGEX);
    if (gift) {
      return { provider: "DoorDash", type: "Gift link", id: gift[1] };
    }
    const ord = url.match(DOORDASH_ORDER_TRACK_REGEX);
    if (ord) {
      return { provider: "DoorDash", type: "Order link", id: ord[1] };
    }
    if (host === "drd.sh") {
      return { provider: "DoorDash", type: "Short link", id: "" };
    }
    return { provider: "DoorDash", type: "Link", id: "" };
  }

  // Uber Eats
  if (host.endsWith("ubereats.com") || host.endsWith("eats.uber.com")) {
    // Common: /orders/<id>
    const m = path.match(/^\/orders\/(.+)$/i);
    if (m) {
      return { provider: "Uber Eats", type: "Order link", id: m[1].split("/")[0] };
    }
    // Group orders / promo / etc.
    return { provider: "Uber Eats", type: "Link", id: "" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Backwards-compatible helper aliases
// ---------------------------------------------------------------------------
// Some handlers in this file were written with these older function names.
// Keep them as thin wrappers so the bot continues to run.
function classifyTrackingUrl(url) {
  return classifyOrderLink(url);
}

async function fetchOpenGraphMeta(url) {
  // Many DoorDash/Uber Eats pages are JS-rendered and won't expose useful HTML.
  // Still, we try to grab basic <title> and OG tags if available.
  try {
    const res = await axios.get(url, {
      timeout: 6000,
      maxRedirects: 4,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DiscordBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      validateStatus: s => s >= 200 && s < 500,
    });
    const html = String(res.data || "");
    const pick = (re) => {
      const m = html.match(re);
      return m ? String(m[1] || "").trim() : "";
    };
    const title = pick(/<title[^>]*>([^<]{1,120})<\/title>/i);
    const ogTitle = pick(/property=["']og:title["'][^>]*content=["']([^"']{1,140})["']/i) ||
      pick(/content=["']([^"']{1,140})["'][^>]*property=["']og:title["']/i);
    const ogDesc = pick(/property=["']og:description["'][^>]*content=["']([^"']{1,200})["']/i) ||
      pick(/content=["']([^"']{1,200})["'][^>]*property=["']og:description["']/i);
    const ogImage = pick(/property=["']og:image["'][^>]*content=["']([^"']{1,300})["']/i) ||
      pick(/content=["']([^"']{1,300})["'][^>]*property=["']og:image["']/i);
    return { title: ogTitle || title, description: ogDesc, image: ogImage };
  } catch {
    return { title: "", description: "", image: "" };
  }
}

// Older name used in some handlers
const fetchOGMeta = fetchOpenGraphMeta;

// Older embed helper used by the /track-order flow.
// Newer code uses buildOrderLinkEmbed(url) which fetches OG data internally.
function buildTrackingEmbed(url, info, og = {}, requestedBy) {
  const embed = new EmbedBuilder()
    .setTitle(og?.title ? `Order Link Preview: ${String(og.title).slice(0, 240)}` : "Order Link Preview")
    .setDescription(
      "I can show basic details from the link (provider/type/id). " +
        "Live order progress/driver location usually requires you to be logged into DoorDash/Uber Eats, " +
        "so I can’t reliably display that without an official API."
    )
    .addFields(
      { name: "Provider", value: info?.provider || "Unknown", inline: true },
      { name: "Type", value: info?.type || "Link", inline: true },
      { name: "ID", value: info?.id ? `\`${String(info.id).slice(0, 80)}\`` : "—", inline: true },
      { name: "Link", value: url.length > 1000 ? url.slice(0, 1000) + "…" : url }
    )
    .setTimestamp(Date.now());

  if (requestedBy) {
    embed.setFooter({ text: `Requested by ${requestedBy.tag || requestedBy.username || ""}`.trim() });
    const av = safeAvatarUrl(requestedBy);
    if (av) embed.setFooter({ text: `Requested by ${requestedBy.tag || requestedBy.username || ""}`.trim(), iconURL: av });
  }

  if (og?.description) embed.addFields({ name: "Preview", value: String(og.description).slice(0, 1024) });
  if (og?.image && /^https?:\/\//i.test(og.image)) embed.setThumbnail(og.image);
  return embed;
}

async function buildOrderLinkEmbed(url) {
  const info = classifyOrderLink(url);
  const og = await fetchOpenGraphMeta(url);

  const embed = new EmbedBuilder()
    .setTitle(og.title ? `Order Link Preview: ${og.title}`.slice(0, 256) : "Order Link Preview")
    .setDescription(
      "I can show basic details from the link (provider/type/id). " +
        "Live order progress/driver location usually requires you to be logged into DoorDash/Uber Eats, " +
        "so I can’t reliably display that without an official API."
    )
    .addFields(
      { name: "Provider", value: info?.provider || "Unknown", inline: true },
      { name: "Type", value: info?.type || "Link", inline: true },
      { name: "ID", value: info?.id ? `\`${String(info.id).slice(0, 80)}\`` : "—", inline: true },
      { name: "Link", value: url.length > 1000 ? url.slice(0, 1000) + "…" : url }
    )
    .setTimestamp(Date.now());

  if (og.description) embed.addFields({ name: "Preview", value: og.description.slice(0, 1024) });
  if (og.image && /^https?:\/\//i.test(og.image)) embed.setThumbnail(og.image);

  const openBtn = new ButtonBuilder().setLabel("Open link").setStyle(ButtonStyle.Link).setURL(url);
  const row = new ActionRowBuilder().addComponents(openBtn);
  return { embed, row };
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
    everyone: { ok: false, error: null },
    patrol: { ok: false, removed: 0, error: null }
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

      // Mobile-friendly copy UI: Discord shows a one-tap "Copy" button for code blocks.
      // This mirrors the "tap-to-copy" feel users often expect.
      const bumpCopyBlock = "`/bump`";

      await ch.send({
        content: mention
          ? `${ping}\nTap to run: ${mention}\n${bumpCopyBlock}`
          : `${ping}\n${bumpCopyBlock}`,
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
      /\bvouch(ed|ing)?\b/i.test(text) ||
      /\b\+1\b/.test(text) ||
      /\brep\b/i.test(text);

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
      await syncCustomerTierRolesUpgradeOnly(msg.guild, customerMember, newCustCount);
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

  // 2) Auto-ban link spam (invite-only by default)
  // - Always bans Discord invites (unless you disable BAN_INVITES_ENABLED)
  // - Optionally bans ALL other links if BAN_ALL_LINKS=true (but still allows restaurant/order links)
  try {
    if (!msg.author.bot) {
      const member = msg.member;
      const isStaff = member?.roles?.cache?.some(r => STAFF_ROLE_IDS.includes(r.id));
      if (!isStaff) {
        const embedText = msg.embeds
          ?.map(e => `${e.title || ""} ${e.description || ""} ${e.url || ""}`)
          .join(" ");

        const combined = `${msg.content || ""} ${embedText || ""}`;

        const hasDiscordInvite = DISCORD_INVITE_REGEX.test(combined);
        const hasAnyUrl = ANY_HTTP_URL_REGEX.test(combined);
        const allowedLink = isAllowedLink(combined); // UberEats/DoorDash + common restaurant platforms

        const shouldBanInvite = BAN_INVITES_ENABLED && hasDiscordInvite;
        const shouldBanAllLinks = BAN_ALL_LINKS && hasAnyUrl && !allowedLink;

        if (shouldBanInvite || shouldBanAllLinks) {
          const snippet = firstLinkSnippet(combined) || "(link)";
          // Use BAN_REASON_PREFIX as the canonical reason text
          const reason = shouldBanInvite
            ? `${BAN_REASON_PREFIX} | Discord invite: ${snippet}`
            : `${BAN_REASON_PREFIX} | Link: ${snippet}`;

          console.log(`[AUTO-BAN] Banning ${msg.author.tag} for ${shouldBanInvite ? 'invite' : 'link'}: ${snippet}`);

          // Announce (best-effort)
          const ann = client.channels.cache.get(BAN_ANNOUNCE_CHANNEL_ID);
          if (ann && ann.isTextBased()) {
            const e = new EmbedBuilder()
              .setColor(0xef4444)
              .setTitle("🚫 Auto-Ban")
              .setDescription(`**User:** ${msg.author} (\`${msg.author.tag}\`)
**Channel:** <#${msg.channelId}>
**Reason:** ${escapeHTML(reason)}`)
              .setTimestamp();
            ann.send({ embeds: [e] }).catch(() => {});
          }

          // Delete message (best-effort)
          await msg.delete().catch(() => {});

          // Ban user
          await msg.guild.members.ban(msg.author.id, { reason }).catch(() => {});

          // DM user
          try {
            await msg.author.send(
              `You were banned from **${msg.guild.name}** for posting a prohibited link.
Reason: ${reason}`
            );
          } catch {}

          return; // stop further handling
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
      // NOTE: Don't `return` here; we still want other handlers (like the tracker) to run.
      const allowedOrderLink = ORDER_LINK_ALLOWLIST.some(r => r.test(combined));
      if (allowedOrderLink) {
        console.log(`[ANTI-PROMO] Allowed order link from ${msg.author.tag} in #${msg.channel?.name || msg.channelId}`);
      }

        // Match against promo patterns (no blanket /https?:\/\// pattern is used)
      const hit = !allowedOrderLink ? PROMO_PATTERNS.find(r => r.test(combined)) : null;
        if (hit) {
          console.log(`[ANTI-PROMO] Deleted message from ${msg.author.tag} (matched: ${hit})`);
          await msg.delete().catch(err => console.log("Delete failed:", err.message));
        }
      }
    }
  } catch (err) {
    console.log("Anti-promo error:", err);
  }

  // 4) Auto-preview DoorDash / Uber Eats links (best-effort)
  // This does NOT fetch private tracking info (no cookies/auth). It only builds an embed
  // with parsed IDs and any publicly available OpenGraph metadata.
  try {
    if (!msg.author.bot) {
      const combined = `${msg.content || ""} ${msg.embeds?.map(e => `${e.title || ""} ${e.description || ""} ${e.url || ""}`).join(" ") || ""}`;
      const url = extractFirstHttpUrl(combined);
      if (url) {
        const info = classifyTrackingUrl(url);
        if (info.provider !== "Unknown") {
          const og = await fetchOGMeta(url);
          const embed = buildTrackingEmbed(url, info, og, msg.author);
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel("Open link")
          );
          await msg
            .reply({ embeds: [embed], components: [row], allowedMentions: { repliedUser: false } })
            .catch(() => null);
        }
      }
    }
  } catch (err) {
    // Don't crash messageCreate if OG fetch fails
    console.log("Tracker preview error:", err?.message || err);
  }
  // 5) Status guard
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

function normalizeDNFChannelIds(saved) {
  const ids = [];
  const candidates = [
    saved?.panelChannelIds,
    saved?.channelIds,
    saved?.channels,
    saved?.panelChannelId,
    saved?.channelId,
  ];

  for (const c of candidates) {
    if (!c) continue;
    if (Array.isArray(c)) ids.push(...c);
    else if (typeof c === "string") ids.push(c);
  }

  // de-dupe + sanitize
  return [...new Set(ids.filter((x) => typeof x === "string" && x.trim().length > 0))];
}

function getDNFCfg(guildId) {
  const gId = guildIdSafe(guildId);
  const saved = dnfCfgStore[gId] || {};
  const panelChannelIds = normalizeDNFChannelIds(saved);

  // Migration: if older keys exist, normalize to panelChannelIds so newer code works.
  if (
    panelChannelIds.length > 0 &&
    (!Array.isArray(saved.panelChannelIds) || saved.panelChannelIds.join(",") !== panelChannelIds.join(","))
  ) {
    dnfCfgStore[gId] = { ...saved, panelChannelIds };
    writeJson(DNF_CFG_FILE, dnfCfgStore);
  }

  return {
    roleId: saved.roleId || null,
    panelChannelIds,
  };
}


/**
 * Reload full DNF config store from disk and return it.
 * Useful on startup when we want to re-apply blocks using the latest persisted config.
 */
function loadDNFCfg() {
  dnfCfgStore = readJson(DNF_CFG_FILE, {});
  return dnfCfgStore;
}

function saveDNFCfg(guildId, cfg) {
  const gId = guildIdSafe(guildId);
  dnfCfgStore[gId] = {
    roleId: cfg.roleId || null,
    panelChannelIds: Array.from(new Set(cfg.panelChannelIds || [])).filter(Boolean),
  };
  writeJson(DNF_CFG_FILE, dnfCfgStore);
}

async function ensureDNFRole(guild) {
  if (!guild) return null;

  const cfg = getDNFCfg(guild.id);

  if (cfg.roleId) {
    const role =
      guild.roles.cache.get(cfg.roleId) || (await guild.roles.fetch(cfg.roleId).catch(() => null));
    if (role) return role;
  }

  const byName =
    guild.roles.cache.find((r) => r.name.toLowerCase() === "does not finish order") || null;
  if (byName) {
    saveDNFCfg(guild.id, { roleId: byName.id, panelChannelIds: cfg.panelChannelIds });
    return byName;
  }

  const created = await guild.roles
    .create({
      name: "does not finish order",
      color: 0x000000,
      hoist: false,
      mentionable: false,
      reason: "DNF role setup",
    })
    .catch(() => null);

  if (created) {
    saveDNFCfg(guild.id, { roleId: created.id, panelChannelIds: cfg.panelChannelIds });
  }

  return created;
}

async function lockChannelForDNF(target, channelIdOrRole, roleIdMaybe) {
  try {
    let channel = null;
    let roleId = null;

    // Support both call styles:
    // 1) lockChannelForDNF(guild, channelId, roleId)
    // 2) lockChannelForDNF(channel, roleOrRoleId)
    if (target && typeof target === "object" && "permissionOverwrites" in target && "guild" in target) {
      // Channel-first
      channel = target;
      const roleOrId = channelIdOrRole;
      roleId = typeof roleOrId === "string" ? roleOrId : roleOrId?.id;
    } else {
      // Guild-first
      const guild = target;
      const channelId = channelIdOrRole;
      roleId = roleIdMaybe;

      if (!guild || !channelId || !roleId) return { ok: false, reason: "missing args" };
      channel = await guild.channels.fetch(channelId).catch(() => null);
    }

    if (!channel) return { ok: false, reason: "channel not found" };
    if (!roleId) return { ok: false, reason: "role not found" };

    // Threads don't reliably support overwrites editing the same way as channels/categories.
    if (typeof channel.isThread === "function" && channel.isThread()) {
      return { ok: false, reason: "threads not supported (select the parent channel)" };
    }

    // IMPORTANT: deny ViewChannel AND ReadMessageHistory
    await channel.permissionOverwrites.edit(
      roleId,
      {
        ViewChannel: false,
        ReadMessageHistory: false,
      },
      { reason: "DNF restriction (DOES NOT FINISH ORDER)" }
    );

    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

/**
 * IMPORTANT Discord permission note:
 * If a channel explicitly ALLOWS ViewChannel for a role the user has (e.g., "Hero in Training"),
 * a DENY on another role (e.g., "DOES NOT FINISH ORDER") can be overridden by that allow.
 * To guarantee restriction, we apply a MEMBER-specific overwrite deny for configured channels.
 */
async function setMemberDNFBlock(channel, memberId, shouldBlock) {
  try {
    if (!channel || !channel.permissionOverwrites) return;

    if (shouldBlock) {
      await channel.permissionOverwrites.edit(
        memberId,
        {
          ViewChannel: false,
          ReadMessageHistory: false,
        },
        { reason: "DNF: block member access" }
      );
    } else {
      // Clear only the two permissions we manage (leave other member overwrites intact).
      await channel.permissionOverwrites.edit(
        memberId,
        {
          ViewChannel: null,
          ReadMessageHistory: null,
        },
        { reason: "DNF: unblock member access" }
      );
    }
  } catch (e) {
    console.warn("[DNF] setMemberDNFBlock failed:", e?.message || e);
  }
}

async function applyDNFBlocksForMember(guild, memberId, cfg, shouldBlock) {
  try {
    if (!guild || !cfg?.panelChannelIds?.length) return;

    for (const channelId of cfg.panelChannelIds) {
      const channel =
        guild.channels.cache.get(channelId) ||
        (await guild.channels.fetch(channelId).catch(() => null));
      if (!channel) continue;
      await setMemberDNFBlock(channel, memberId, shouldBlock);
    }
  } catch (e) {
    console.warn("[DNF] applyDNFBlocksForMember failed:", e?.message || e);
  }
}

async function reapplyDNFMemberBlocksOnStartup() {
  try {
    const cfgByGuild = loadDNFCfg();
    const entries = Object.entries(cfgByGuild || {});
    for (const [guildId, cfg] of entries) {
      const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
      if (!guild) continue;

      const roleId = cfg?.roleId;
      if (!roleId || !cfg?.panelChannelIds?.length) continue;

      // Ensure we have members cached for role.members
      await guild.members.fetch().catch(() => null);

      const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
      if (!role) continue;

      for (const member of role.members.values()) {
        await applyDNFBlocksForMember(guild, member.id, cfg, true);
      }
    }
    console.log("[DNF] Startup member re-apply complete.");
  } catch (e) {
    console.warn("[DNF] reapplyDNFMemberBlocksOnStartup failed:", e?.message || e);
  }
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

// /editpay (interactive payment editor)
const cmdEditPay = new SlashCommandBuilder()
  .setName("editpay")
  .setDescription("Interactively add/update/delete payment methods for a staff member")
  .addUserOption(o =>
    o.setName("staff").setDescription("Staff user").setRequired(true)
  );

// /pay
const cmdPay = new SlashCommandBuilder()
  .setName("pay")
  .setDescription("Show payment options for a staff member.")
  // Allow /pay to be used in DMs
  .setDMPermission(true)
  .addUserOption(o =>
    // Optional so /pay works smoothly in DMs (defaults to the caller).
    o.setName("staff").setDescription("Who is getting paid").setRequired(false)
  )
  .addStringOption(o => o.setName("staff_id").setDescription("Staff user ID (use this in DMs if staff is not in the DM)").setRequired(false))
.addUserOption(o =>
    o.setName("customer").setDescription("Optional customer to ping (overrides auto-detect in tickets)").setRequired(false)
  )
  .addNumberOption(o =>
    o.setName("amount").setDescription("Amount in USD")
  )
  .addStringOption(o =>
    o.setName("note").setDescription("Optional note")
  );


// /paycanada — Canada payment links (Wise + Stripe) + optional crypto preference
const CANADA_WISE_URL = process.env.CANADA_WISE_URL || "https://wise.com/pay/me/carlosmanueln18";
const CANADA_STRIPE_URL = process.env.CANADA_STRIPE_URL || "https://buy.stripe.com/7sY6oJboL4F50hxawx8og00";
const CANADA_STRIPE_NOTE =
  process.env.CANADA_STRIPE_NOTE ||
  "NOTE: Stripe may add extra charges/fees. Please wait for the confirmed amount before paying.";

const cmdPayCanada = new SlashCommandBuilder()
  .setName("paycanada")
  .setDescription("Show Canada payment options (Wise / Stripe / Crypto).")
  .setDMPermission(true)
  .addUserOption(o =>
    o.setName("customer")
      .setDescription("Optional customer to ping")
      .setRequired(false)
  )
  .addNumberOption(o =>
    o.setName("amount")
      .setDescription("Optional amount (CAD)")
      .setRequired(false)
      .setMinValue(0)
  )
  .addStringOption(o =>
    o.setName("crypto")
      .setDescription("Optional: crypto preference")
      .addChoices(
        { name: "ETH", value: "ETH" },
        { name: "LTC", value: "LTC" },
        { name: "USDT", value: "USDT" }
      )
      .setRequired(false)
  )
  .addStringOption(o =>
    o.setName("note")
      .setDescription("Optional note")
      .setRequired(false)
      .setMaxLength(1000)
  );


// /showpay
const cmdShowPay = new SlashCommandBuilder()
  .setName("showpay")
  .setDescription("Show saved payment methods for a staff member (no amount).")
  // Allow /showpay to be used in DMs
  .setDMPermission(true)
  .addUserOption(o =>
    // Optional so /showpay works smoothly in DMs (defaults to the caller).
    o.setName("staff").setDescription("Staff user").setRequired(false)
  )
  .addStringOption(o => o.setName("staff_id").setDescription("Staff user ID (use this in DMs if staff is not in the DM)").setRequired(false))
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
// /vouchchecker
const cmdVouchChecker = new SlashCommandBuilder()
  .setName("vouchchecker")
  .setDescription("Scan vouch messages in a channel, rebuild vouch counts, and (optionally) mark each vouch with ✅.")
  .addChannelOption(o =>
    o.setName("channel")
      .setDescription("Channel to scan (default: current channel)")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  )
    .addBooleanOption(o =>
    o.setName("all_channels")
      .setDescription("Scan ALL vouch channels in this server (recommended). If set, the channel option is ignored.")
  )
.addIntegerOption(o =>
    o.setName("limit")
      .setDescription("How many recent messages to scan (max 3000)")
      .setMinValue(50)
      .setMaxValue(3000)
  )
  .addBooleanOption(o =>
    o.setName("react")
      .setDescription("React ✅ to each detected vouch message (default: true)")
      .setRequired(false)
  )
  .addBooleanOption(o =>
    o.setName("apply")
      .setDescription("Overwrite stored vouch counts using the scan results (default: false / preview-only)")
      .setRequired(false)
  )
  .addBooleanOption(o =>
    o.setName("sync_roles")
      .setDescription("Update customer loyalty roles (safe: upgrade-only). Requires apply=true (default: false)")
      .setRequired(false)
  )
  .addBooleanOption(o =>
    o.setName("force")
      .setDescription("DANGEROUS: allow downgrades + full overwrite (use only if you're sure the scan is complete)")
      .setRequired(false)
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

// /track (best-effort order link preview)
// NOTE: We can build a helpful embed with parsed IDs/URLs, but we cannot reliably fetch
// live order status (driver, ETA, etc.) without official APIs/auth.
const cmdTrack = new SlashCommandBuilder()
  .setName("track")
  .setDescription("Preview an Uber Eats / DoorDash link (best-effort).")
  .setDMPermission(true)
  .addStringOption(o =>
    o.setName("url").setDescription("Paste a DoorDash/UberEats link").setRequired(true)
  )
  .addBooleanOption(o =>
    o.setName("public").setDescription("If true, post publicly (default: ephemeral)").setRequired(false)
  );
// /calc (customer pay calculator)
const cmdCalc = new SlashCommandBuilder()
  .setName("calc")
  .setDescription("Calculate what the customer should pay (cost + fee, with discount roles) + optional % math.")
  // Enabled for DMs (User Install) via integration_types/contexts wrapper below.
  .setDMPermission(true)
  .addNumberOption((o) =>
    o.setName("cost").setDescription("Order cost (before fees/discounts)").setRequired(true)
  )
  .addNumberOption((o) =>
    o
      .setName("fee")
      .setDescription(`Flat fee to add on top (default: ${DEFAULT_SERVICE_FEE})`)
      .setRequired(false)
  )
  .addBooleanOption((o) =>
  o
    .setName("subtract_fee")
    .setDescription("Subtract the service fee from the total (use only if cost already includes fee). Default: OFF")
    .setRequired(false)
)
.addIntegerOption((o) =>
    o
      .setName("preset_percent")
      .setDescription("Quick % presets (applies to COST)")
      .setRequired(false)
      .addChoices(
        { name: "10%", value: 10 },
        { name: "15%", value: 15 },
        { name: "20%", value: 20 },
        { name: "25%", value: 25 },
        { name: "30%", value: 30 },
        { name: "35%", value: 35 },
        { name: "40%", value: 40 },
        { name: "45%", value: 45 },
        { name: "50%", value: 50 },
        { name: "55%", value: 55 },
        { name: "60%", value: 60 }
      )
  )
  .addNumberOption((o) =>
    o
      .setName("percent")
      .setDescription("Custom percentage (e.g. 18.5) applied to COST")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(1000)
  )
  .addBooleanOption((o) =>
    o
      .setName("percent_table")
      .setDescription("Show a 10%–60% table for COST")
      .setRequired(false)
  )
  .addUserOption((o) =>
    o
      .setName("customer")
      .setDescription("Customer to check discount roles for (server only)")
      .setRequired(false)
  )
  .addBooleanOption((o) =>
    o
      .setName("public")
      .setDescription("If true, shows publicly (default: ephemeral)")
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
  .addStringOption(o =>
    o.setName("category")
      .setDescription("Optional: rename using a category instead of the server name")
      .addChoices(
        { name: "Uber Eats", value: "ue" },
        { name: "DoorDash", value: "dd" },
        { name: "Custom", value: "custom" }
      )
      .setRequired(false)
  )
  .addStringOption(o =>
    o.setName("custom")
      .setDescription("If category=Custom, enter the label (ex: yukis-cafe)")
      .setRequired(false)
      .setMaxLength(50)
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


const cmdDNFSetup = new SlashCommandBuilder()
  .setName("dnf_setup")
  .setDescription("Create/ensure the 'does not finish order' role and lock a panel channel (default: this channel).")
  .addChannelOption(o =>
    o.setName("channel")
      .setDescription("Panel channel OR category to lock (where TicketTool posts the ticket embed)")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildCategory)
      .setRequired(false)
  )
  .addChannelOption(o =>
    o.setName("channel_2")
      .setDescription("Optional: another channel/category to lock")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildCategory)
      .setRequired(false)
  )
  .addChannelOption(o =>
    o.setName("channel_3")
      .setDescription("Optional: another channel/category to lock")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildCategory)
      .setRequired(false)
  )
  .addChannelOption(o =>
    o.setName("channel_4")
      .setDescription("Optional: another channel/category to lock")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildCategory)
      .setRequired(false)
  )
  .addChannelOption(o =>
    o.setName("channel_5")
      .setDescription("Optional: another channel/category to lock")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildCategory)
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const cmdDNFAdd = new SlashCommandBuilder()
  .setName("dnf_add")
  .setDescription("Give the DNF role to a user (hides registered panel channels).")
  .addUserOption(o =>
    o.setName("user")
      .setDescription("User to restrict")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

const cmdDNFRemove = new SlashCommandBuilder()
  .setName("dnf_remove")
  .setDescription("Remove the DNF role from a user.")
  .addUserOption(o =>
    o.setName("user")
      .setDescription("User to unrestrict")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

// NEW (preferred): /dnf setup|add|remove  (shows as “/dnf setup” etc.)
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
// Guide
const cmdGuide = new SlashCommandBuilder()
  .setName("guide")
  .setDescription("Show a full guide on how to use the bot.")
  .setDMPermission(true)
  .addStringOption(o =>
    o.setName("topic")
      .setDescription("Optional: jump to a specific topic")
      .addChoices(
        { name: "Getting Started / Setup", value: "setup" },
        { name: "Payments (/setpay, /pay, /paycanada)", value: "payments" },
        { name: "Calculator (/calc)", value: "calc" },
        { name: "Tickets (/claim, /closeticket, /closealltickets)", value: "tickets" },
        { name: "Vouches (/vouch, /vouchchecker)", value: "vouches" },
        { name: "Link Tracker (/track)", value: "track" }
      )
  );
// Order perms debug
const cmdOrderPerms = new SlashCommandBuilder()
  .setName("orderperms")
  .setDescription("Debug order channel permissions (HERO + optional user).")
  .addUserOption(o =>
    o.setName("user").setDescription("Optional user to check effective perms for")
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

/**
 * Discord has *installation contexts*.
 *
 * To make a slash command appear in DMs ("Apps" list / DM command picker),
 * it must be enabled for **User Install** and for **DM contexts**.
 *
 * The API fields are:
 * - integration_types: [0, 1]  -> Guild Install + User Install
 * - contexts: [0, 1, 2]        -> Guild + Bot DM + Private Channel
 */
function withDMContexts(cmdJson) {
  return {
    ...cmdJson,
    dm_permission: true,
    integration_types: [0, 1],
    contexts: [0, 1, 2]
  };
}

const COMMAND_BUILDERS = [
  cmdScanPromos,
  cmdSetPay,
  cmdDelPay,
  cmdEditPay,
  cmdPay,
  cmdPayCanada,
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
  cmdVouchChecker,
  cmdAnnounce,
  cmdSayEmbed,
  cmdInvoice,
  cmdUEInspect,
  cmdTrack,
  cmdCalc,
  cmdCloseTicket,
  cmdClaim,
  cmdDNFAdd,
  cmdDNFRemove,
  cmdHostUrlSet,
  cmdAutoCloseNow,
  cmdAutoOpenNow,
  cmdGuide,
  cmdHelp
];

const ALL_COMMANDS_JSON = COMMAND_BUILDERS.map((builder) => {
  const json = builder.toJSON();
  if (json?.name === "pay" || json?.name === "showpay" || json?.name === "paycanada" || json?.name === "calc" || json?.name === "track" || json?.name === "guide") return withDMContexts(json);
  return json;
});

// Register ONLY /pay + /showpay as GLOBAL commands (so they can appear in DMs).
// Keep the rest as GUILD commands for faster propagation + to avoid cluttering DM command pickers.
const GLOBAL_COMMAND_NAMES = new Set(["pay", "showpay", "paycanada", "calc", "track", "guide"]);
const GLOBAL_COMMANDS = ALL_COMMANDS_JSON.filter(c => GLOBAL_COMMAND_NAMES.has(c?.name));
const GUILD_COMMANDS = ALL_COMMANDS_JSON.filter(c => !GLOBAL_COMMAND_NAMES.has(c?.name));

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  // ✅ Always register DM-friendly commands globally.
  // Global command propagation can take a while, but these are the only ones we need in DMs.
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: GLOBAL_COMMANDS });
  console.log("✅ Slash commands registered (GLOBAL: /pay /showpay /paycanada /calc /track /guide)");

  // NOTE:
  // We intentionally do NOT register all commands globally.
  // Instead, we register the remaining commands per-guild on READY.
  // That makes them show up fast in *every* server the bot is in.
}

async function registerGuildCommandsForAllGuilds(client) {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  const appId = process.env.CLIENT_ID;
  if (!appId) return;

  // Ensure we have the latest guild list
  try { await client.guilds.fetch(); } catch {}

  const guildIds = [...client.guilds.cache.keys()];
  if (!guildIds.length) return;

  // Optional: if you set GUILD_ID, we still register there first (nice for logs/testing)
  const priority = process.env.GUILD_ID ? [process.env.GUILD_ID] : [];
  const ordered = [...new Set([...priority, ...guildIds])];

  for (const gid of ordered) {
    try {
      await rest.put(Routes.applicationGuildCommands(appId, gid), { body: GUILD_COMMANDS });
      console.log(`✅ Guild commands registered for guild ${gid} (${GUILD_COMMANDS.length} commands)`);
      // tiny delay to reduce rate-limit risk if you add the bot to many servers
      await sleep(450);
    } catch (e) {
      console.log(`⚠️ Guild command register failed for ${gid}:`, e?.message || e);
      await sleep(800);
    }
  }
}

// ============================================
// FLEXIBLE PAYMENT SYSTEM
// ============================================

function safeInlineCode(value) {
  // Discord inline-code uses backticks. If the value contains backticks, replace them with a similar char.
  const s = String(value ?? "");
  return `\`${s.replace(/`/g, "ˋ")}\``;
}

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

  // Make payment identifiers easy to copy on mobile by rendering them as inline-code (`like this`).
  // If a value is a URL, keep it normal so it remains clickable (buttons also include the URL).
  const methodFields = Object.entries(info.methods || {})
    .filter(([, v]) => v)
    .map(([method, value]) => {
      const raw = String(value);
      const isUrl = /^https?:\/\//i.test(raw);
      return {
        name: method,
        value: isUrl ? raw.slice(0, 1024) : safeInlineCode(raw).slice(0, 1024),
        inline: true
      };
    });

  if (methodFields.length) e.addFields(methodFields);

  return e;
}

// Auto-split buttons into rows of max 5
// IMPORTANT: Use per-message storage so "Copy" buttons always copy the RIGHT user's value.
// The older approach searched payStore by method name, which breaks when multiple staff share method names (e.g., "Venmo").
// We store a short-lived map: messageId -> { methodName -> value }.
const payMsgMap = new Map(); // messageId -> { [methodName]: value }

function buildPayButtons(info, staffId) {
  // Copy/Open buttons for payment methods.
  // We encode staffId into the customId so button clicks always resolve to the right profile,
  // even if the bot restarts (in-memory maps would be cleared).
  const rows = [];

  const methods = info?.methods || {};
  const orderedMethods = [
    ...PAY_METHODS_ORDER.filter((m) => methods[m]),
    ...Object.keys(methods).filter((m) => !PAY_METHODS_ORDER.includes(m)),
  ];

  // Discord: max 5 buttons per row, max 5 rows
  let row = new ActionRowBuilder();
  let rowCount = 0;

  for (const method of orderedMethods) {
    const value = methods[method];
    if (!value) continue;

    const encodedMethod = encodeURIComponent(method);
    const copyBtn = new ButtonBuilder()
      .setCustomId(`pay:copy:${staffId}:${encodedMethod}`)
      .setLabel(method)
      .setStyle(ButtonStyle.Secondary);

    const isUrl = /^https?:\/\//i.test(String(value).trim());
    const openBtn = isUrl
      ? new ButtonBuilder()
          .setLabel(`Open ${method}`)
          .setStyle(ButtonStyle.Link)
          .setURL(String(value).trim())
      : null;

    if (row.components.length >= 5) {
      rows.push(row);
      rowCount += 1;
      row = new ActionRowBuilder();
      if (rowCount >= 5) break;
    }
    row.addComponents(copyBtn);

    if (openBtn) {
      if (row.components.length >= 5) {
        rows.push(row);
        rowCount += 1;
        row = new ActionRowBuilder();
        if (rowCount >= 5) break;
      }
      row.addComponents(openBtn);
    }
  }

  if (row.components.length && rowCount < 5) rows.push(row);

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

// Upgrade-only tier sync (won't remove higher roles).
// Used by /vouchchecker in "safe" mode so we don't accidentally downgrade customers
// if some older vouches fail to parse.
async function syncCustomerTierRolesUpgradeOnly(guild, member, count) {
  if (!guild || !member) return;

  const tier = tierForCount(count);
  if (!tier?.roleId) return;

  const desiredRoleId = tier.roleId;

  // If they already have the desired role (or a higher tier), do nothing.
  // Higher tiers are later in this list.
  const tiersHighToLow = [VILTRUMITE_ROLE_ID, FREQUENT_BUYER_ROLE_ID, VERIFIED_BUYER_ROLE_ID].filter(Boolean);
  const currentIndex = tiersHighToLow.findIndex(rid => member.roles.cache.has(rid));
  const desiredIndex = tiersHighToLow.findIndex(rid => rid === desiredRoleId);

  // If they already have a tier role and it's higher (smaller index), don't change.
  if (currentIndex !== -1 && desiredIndex !== -1 && currentIndex <= desiredIndex) return;

  const role = guild.roles.cache.get(desiredRoleId);
  if (role) {
    await member.roles.add(role).catch(() => {});
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

      // /editpay modal submit (disabled - replaced by newer payedit flow)
      if (false && interaction.customId.startsWith("payedit:modal:")) {
        const parts = interaction.customId.split(":");
        // payedit:modal:<staffId>
        const staffId = parts[2];

        const rawName = interaction.fields.getTextInputValue("method_name").trim();
const methodValue = interaction.fields.getTextInputValue("method_value").trim();

if (!rawName) {
  return interaction.reply({ content: "❌ Please enter a payment method name.", ephemeral: true });
}
if (!methodValue) {
  return interaction.reply({ content: "❌ Please enter the payment details/link/handle for that method.", ephemeral: true });
}

// Normalize (but allow custom methods too)
const methodName = canonicalizePaymentMethodName(rawName);

// Save
if (!payStore[staffId]) payStore[staffId] = {};
payStore[staffId][methodName] = { value: methodValue, note: "" };

        writeJson("pay.json", payStore);

        // Rebuild panel (ephemeral messages can't be fetched/edited by ID reliably, so we send a fresh updated panel)
        let staffMember = null;
        try {
          staffMember = await interaction.guild.members.fetch(staffId);
        } catch {}

        const panel = buildEditPayPanel(staffMember || interaction.member, payStore[staffId]);
        return interaction.reply({
          ...panel,
          ephemeral: true
        });
      }
    }

        // ========== BUTTONS ==========
    if (interaction.isButton()) {
      const id = interaction.customId;

      // /editpay panel buttons
      // customId format: payedit:<action>:<staffId>:<channelId>:<messageId>
      if (id.startsWith("payedit:")) {
        const parts = id.split(":");
        const action = parts[1];
        const staffId = parts[2];
        const hasJusticeChefRole = interaction.member?.roles?.cache?.has(JUSTICE_CHEF_ROLE_ID);
        if (!hasJusticeChefRole && !interaction.memberPermissions?.has("ManageGuild")) {
          return interaction.reply({ content: "You don't have permission to do that.", ephemeral: true });
        }

        if (!staffId) {
          return interaction.reply({ content: "Invalid pay editor state. Please run `/editpay` again.", ephemeral: true });
        }

        // ADD / UPDATE
        if (action === "add") {
          const modal = new ModalBuilder()
            .setCustomId(`payedit:modal:${staffId}`)
            .setTitle("Add / Update payment method");

          const nameInput = new TextInputBuilder()
            .setCustomId("method_name")
            .setLabel("Method name (e.g., Cash App)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(50);

          const valueInput = new TextInputBuilder()
            .setCustomId("method_value")
            .setLabel("Handle / link")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(150);

          modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(valueInput)
          );

          return interaction.showModal(modal);
        }

        // DELETE ONE
        if (action === "del") {
          const entry = payStore[staffId];
          const methods = entry?.methods || {};
          const names = Object.keys(methods);

          if (!names.length) {
            return interaction.reply({ content: "No payment methods saved for that staff member.", ephemeral: true });
          }

          const options = names.slice(0, 25).map((n) => ({
            label: n.length > 100 ? n.slice(0, 97) + "..." : n,
            value: encodeURIComponent(n),
          }));

          const menu = new StringSelectMenuBuilder()
            .setCustomId(`payedit_del_select:${staffId}:${interaction.channelId}:${interaction.message.id}`)
            .setPlaceholder("Select a method to delete")
            .addOptions(options);

          return interaction.reply({
            content: "Choose the method you want to delete:",
            components: [new ActionRowBuilder().addComponents(menu)],
            ephemeral: true,
          });
        }

        // CLEAR ALL
        if (action === "clear") {
          if (!payStore[staffId]) payStore[staffId] = { name: null, methods: {} };
          payStore[staffId].methods = {};
          writeJson("pay.json", payStore);

          const payload = buildEditPayPanel({ guild: interaction.guild, staffId });
          return interaction.update(payload);
        }

        // DONE (remove components)
        if (action === "done") {
          const payload = buildEditPayPanel({ guild: interaction.guild, staffId });
          payload.components = [];
          return interaction.update(payload);
        }

        return interaction.reply({ content: "Unknown action. Please run `/editpay` again.", ephemeral: true });
      }

      // Bump copy button
      if (id === "bump:copy") {
        // Match the "tap-to-copy" behavior you showed (/purchase):
        // send the command as *inline code*. On mobile, tapping the inline-code snippet copies it.
        return interaction.reply({
          content: "`/bump`",
          ephemeral: true
        });
      }

      // Pay copy buttons: pay:copy:<encodedMethodName>
      if (id.startsWith("pay:copy:")) {
        // Format: pay:copy:<staffId>:<encodedMethod>
        const parts = id.split(":");
        const staffId = parts.length >= 4 ? parts[2] : null;
        const methodName =
          parts.length >= 4
            ? decodeURIComponent(parts.slice(3).join(":"))
            : id.slice("pay:copy:".length);

        if (!staffId || !payStore[staffId]) {
          return interaction.reply({
            content:
              "That payment button is outdated (or the bot restarted). Please run `/pay` again.",
            ephemeral: true,
          });
        }

        const info = payStore[staffId];
        const val = info?.methods?.[methodName];

        if (!methodName || !val) {
          return interaction.reply({
            content: `No value found for **${methodName || "that method"}** on <@${staffId}>.`,
            ephemeral: true,
          });
        }

        return interaction.reply({
          content: safeInlineCode(String(val)),
          ephemeral: true,
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
    // String select menus (/editpay delete)
    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId || "";
      if (id.startsWith("payedit_del_select:")) {
        const parts = id.split(":");
        const staffId = parts[1];
        const channelId = parts[2];
        const messageId = parts[3];

        const hasJusticeChefRole = interaction.member?.roles?.cache?.has(JUSTICE_CHEF_ROLE_ID);
        if (!hasJusticeChefRole && !interaction.memberPermissions?.has("ManageGuild")) {
          return interaction.reply({ content: "You don't have permission to use this menu.", ephemeral: true });
        }

        const encoded = interaction.values?.[0];
        let methodName = null;
        try {
          methodName = Buffer.from(encoded, "base64url").toString("utf8");
        } catch {
          methodName = encoded;
        }

        const entry = payStore[staffId] || { name: null, methods: {} };
        if (!entry.methods || !Object.prototype.hasOwnProperty.call(entry.methods, methodName)) {
          return interaction.update({ content: "That method no longer exists.", components: [] }).catch(() => {});
        }

        delete entry.methods[methodName];
        payStore[staffId] = entry;
        writeJson("pay.json", payStore);

        // Try to refresh the original panel message (best effort)
        if (interaction.guild && channelId && messageId) {
          try {
            const panelChannel = await interaction.guild.channels.fetch(channelId).catch(() => null);
            const panelMessage = panelChannel?.isTextBased() ? await panelChannel.messages.fetch(messageId).catch(() => null) : null;
            if (panelMessage) {
              const { embeds, components } = buildEditPayPanel({ guild: interaction.guild, staffId });
              await panelMessage.edit({ embeds, components }).catch(() => {});
            }
          } catch {}
        }

        return interaction.update({
          content: `✅ Deleted **${methodName}**.`,
          components: []
        });
      }
    }

    // Channel select menus (DNF setup)
    if (interaction.isChannelSelectMenu()) {
      const id = interaction.customId || "";
      if (id.startsWith("dnf_setup_select:")) {
        const parts = id.split(":");
        const guildId = parts[1];
        const ownerId = parts[2];

        if (!interaction.guild || interaction.guild.id !== guildId) {
          return interaction.reply({
            content: "This DNF setup menu is no longer valid for this server.",
            ephemeral: true,
          });
        }

        if (ownerId && interaction.user.id !== ownerId) {
          return interaction.reply({
            content: "Only the person who opened this DNF setup can use this menu.",
            ephemeral: true,
          });
        }

        // Apply and save
        const cfg = getDNFCfg(guildId);
        const role = await ensureDNFRole(interaction.guild, cfg);

        const selectedIds = Array.isArray(interaction.values) ? interaction.values : [];
        const newlySelected = selectedIds.filter((cid) => !cfg.panelChannelIds.includes(cid));
        cfg.panelChannelIds = Array.from(new Set([...cfg.panelChannelIds, ...selectedIds]));
        saveDNFCfg(guildId, cfg);

        // Lock every configured channel (keeps things consistent if configs were edited)
        let ok = 0;
        let fail = 0;
        for (const channelId of cfg.panelChannelIds) {
          const c = interaction.guild.channels.cache.get(channelId);
          if (!c) continue;
          try {
            await lockChannelForDNF(c, role);
            ok++;
          } catch (e) {
            fail++;
          }
        }

        return interaction.update({
          content:
            `✅ DNF setup saved.\n` +
            `• Role: <@&${role.id}>\n` +
            `• Total locked channels: ${cfg.panelChannelIds.length}\n` +
            `• Newly added: ${newlySelected.length}\n` +
            (fail ? `\n⚠️ Failed to lock ${fail} channel(s). Make sure the bot has **Manage Channels** and its role is above the DNF role.` : ""),
          components: [],
        });
      }
    }

    if (!interaction.isChatInputCommand()) return;
    const cmd = interaction.commandName;

    // Preferred syntax: /dnf setup|add|remove
    // (We keep legacy /dnf_setup, /dnf_add, /dnf_remove for compatibility.)



// DNF role + panel channel lock (Option A: panel channels only)
if (cmd === "dnf_setup") {
  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({ content: "This command must be used in a server.", ephemeral: true });
  }

  const can =
    interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    interaction.member.permissions.has(PermissionFlagsBits.ManageRoles);

  if (!can) {
    return interaction.reply({
      content: "You need **Manage Server**, **Manage Channels**, or **Manage Roles** to run this.",
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const role = await ensureDNFRole(guild);
  if (!role) {
    return interaction.editReply("I couldn't create/find the **does not finish order** role. Make sure I have **Manage Roles**.");
  }

  const picked = [
    interaction.options.getChannel("channel"),
    interaction.options.getChannel("channel_2"),
    interaction.options.getChannel("channel_3"),
    interaction.options.getChannel("channel_4"),
    interaction.options.getChannel("channel_5"),
  ].filter(Boolean);

  // If the user didn't specify any channels, present a multi-select channel menu.
  // This allows selecting way more than 5 channels (Discord supports up to 25 selections).
  if (picked.length === 0) {
    const menu = new ChannelSelectMenuBuilder()
      .setCustomId(`dnf_setup_select:${guild.id}:${interaction.user.id}`)
      .setPlaceholder("Select channel(s) to block DNF from")
      .setMinValues(1)
      .setMaxValues(25);

    const row = new ActionRowBuilder().addComponents(menu);

    // Store roleId now so the selection handler can immediately apply overwrites.
    const cfg = getDNFCfg(guild.id);
    saveDNFCfg(guild.id, { roleId: role.id, panelChannelIds: cfg.panelChannelIds || [] });

    return interaction.editReply({
      content:
        "Pick the channel(s) you want **DNF** to be unable to **View Channel** and **Read Message History** in.\n" +
        "(If someone has **Administrator**, Discord will still let them see everything — that can't be overridden.)",
      components: [row],
    });
  }

  const pickedIds = picked.filter((c) => c && c.id).map((c) => c.id);
  if (pickedIds.length === 0) {
    return interaction.editReply("I couldn't determine which channel(s) to lock.");
  }

  const cfg = getDNFCfg(guild.id);
  const panelIds = Array.from(new Set([...(cfg.panelChannelIds || []), ...pickedIds]));

  // Save config first
  saveDNFCfg(guild.id, { roleId: role.id, panelChannelIds: panelIds });

  let locked = 0;
  let failed = 0;
  for (const chId of panelIds) {
    const res = await lockChannelForDNF(guild, chId, role.id);
    if (res.ok) locked++;
    else failed++;
  }

  return interaction.editReply(
    [
      `✅ **DNF role ready:** <@&${role.id}>`,
      `🔒 Locked **${locked}** panel channel(s)` + (failed ? ` (⚠️ ${failed} failed)` : ""),
      `Registered panels: ${panelIds.map((id) => `<#${id}>`).join(", ")}`,
    ].join("\n")
  );
}

if (cmd === "dnf_add") {
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: "This command must be used in a server.", ephemeral: true });

  const can =
    interaction.member.permissions.has(PermissionFlagsBits.ManageRoles) ||
    interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

  if (!can) {
    return interaction.reply({ content: "You need **Manage Roles** to run this.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const role = await ensureDNFRole(guild);
  if (!role) {
    return interaction.editReply("I couldn't create/find the **does not finish order** role. Make sure I have **Manage Roles**.");
  }

  const user = interaction.options.getUser("user", true);
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.editReply("I couldn't find that user in this server.");

  await member.roles.add(role.id).catch((e) => {
    throw new Error(e?.message || String(e));
  });

  // Guarantee the member is blocked from configured channels (member-specific deny)
  const cfg = getDNFCfg(guild.id);
  await applyDNFBlocksForMember(guild, member.id, cfg, true);

  // Re-apply channel locks in case setup was run before the bot had perms
  // or if more panel channels were added later.
  const panelIds = Array.isArray(cfg.panelChannelIds) ? cfg.panelChannelIds : [];
  let locked = 0;
  let failed = 0;
  for (const channelId of panelIds) {
    const res = await lockChannelForDNF(guild, channelId, role.id);
    if (res.ok) locked += (res.lockedCount || 1);
    else failed += 1;
  }

  const extra = panelIds.length
    ? `\n🔒 Re-applied locks: **${locked}** channel(s)` + (failed ? ` (⚠️ ${failed} failed)` : "")
    : "\nℹ️ No panel channels are configured yet — run `/dnf_setup`.";

  return interaction.editReply(`✅ Added <@&${role.id}> to ${member}.${extra}`);
}

if (cmd === "dnf_remove") {
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: "This command must be used in a server.", ephemeral: true });

  const can =
    interaction.member.permissions.has(PermissionFlagsBits.ManageRoles) ||
    interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

  if (!can) {
    return interaction.reply({ content: "You need **Manage Roles** to run this.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const cfg = getDNFCfg(guild.id);
  const roleId = cfg.roleId;
  if (!roleId) return interaction.editReply("DNF role isn't set up yet. Run `/dnf_setup` in your panel channel.");

  const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
  if (!role) return interaction.editReply("I can't find the configured DNF role. Run `/dnf_setup` again.");

  const user = interaction.options.getUser("user", true);
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.editReply("I couldn't find that user in this server.");

  await member.roles.remove(role.id).catch((e) => {
    throw new Error(e?.message || String(e));
  });

  // Remove member-specific denies now that they are no longer DNF
  await applyDNFBlocksForMember(guild, member.id, cfg, false);

  return interaction.editReply(`✅ Removed <@&${role.id}> from ${member}.`);
}


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



// GUIDE
if (cmd === "guide") {
  const topic = (interaction.options.getString("topic") || "").toLowerCase();
  const inGuild = Boolean(interaction.guildId);

  const makeEmbed = (title, lines, color = 0x38bdf8) =>
    new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(lines.filter(Boolean).join("\n"))
      .setFooter({ text: "INVINCIBLE EATS — Bot Guide" })
      .setTimestamp();

  const embeds = [];

  // Overview (always)
  if (!topic) {
    embeds.push(
      makeEmbed("📘 Bot Guide — Overview", [
        "Use `/help` for a quick list of commands.",
        "",
        "**Most used:**",
        "• **/calc** — customer total calculator (default: cost − fee)",
        "• **/pay** / **/paycanada** — payment info + buttons",
        "• **/claim** — rename/claim tickets (server-only)",
        "• **/vouch** — record vouches + loyalty tiers",
        "• **/track** — tracker-style embed for DoorDash/Uber Eats links (best-effort)",
        "",
        "Tip: In any NEW server, run **/server_setup** so permissions + roles match that server."
      ])
    );

    embeds.push(
      makeEmbed("🧭 Jump to a topic", [
        "Run: `/guide topic:<topic>`",
        "",
        "Topics:",
        "• Getting Started / Setup",
        "• Payments",
        "• Calculator",
        "• Tickets",
        "• Vouches",
        "• Link Tracker"
      ], 0xa78bfa)
    );

    return interaction.reply(inGuild ? { embeds, ephemeral: true } : { embeds });
  }

  if (topic === "setup") {
    embeds.push(
      makeEmbed("🛠️ Getting Started / Setup", [
        "**1) Invite the bot** to your server with the right permissions (Manage Channels recommended).",
        "",
        "**2) Configure per-server settings (IMPORTANT)**",
        "Run `/server_setup` in each server to set:",
        "• status channel",
        "• orders channel",
        "• hero/customer role",
        "• (optional) announce channel",
        "• (optional) justice/patrol roles",
        "",
        "**3) Ticket config (optional but recommended)**",
        "Run `/ticket_config` to set a ticket category + prefix so `/closealltickets` works perfectly.",
        "",
        "**4) Transcript links (optional)**",
        "Run `/hosturl_set` to set your public URL (so transcript buttons work outside localhost)."
      ], 0x22c55e)
    );
  }

  if (topic === "payments") {
    embeds.push(
      makeEmbed("💸 Payments (/setpay, /pay, /paycanada)", [
        "**/setpay** (staff/admin): save methods for a staff member",
        "Format for `methods` (one per line):",
        "```",
        "Cash App = $yourtag",
        "Zelle = email@example.com",
        "Stripe = https://....",
        "```",
        "",
        "**/pay** — show payment buttons + optional amount/note",
        "Options:",
        "• `staff` (optional) — who is getting paid (defaults to you)",
        "• `staff_id` (optional) — use in DMs if the staff isn’t selectable",
        "• `amount` (optional) — shows amount",
        "• `note` (optional)",
        "• `customer` (optional) — mention/ping a customer (otherwise ticket-opener auto-detects in ticket channels)",
        "",
        "**/paycanada** — Canada payment info (Wise/Stripe + crypto options)."
      ], 0xf59e0b)
    );
  }

  if (topic === "calc") {
    embeds.push(
      makeEmbed("🧮 Calculator (/calc)", [
        "Default behavior: **Total Due = cost − fee** (fee defaults to $9).",
        "",
        "**Examples:**",
        "• `/calc cost:12.29` → 12.29 − 9 = **3.29**",
        "• `/calc cost:12.29 fee:7` → 12.29 − 7 = **5.29**",
        "",
        "**Discount options:**",
        "• `preset_percent` or `percent` applies as **% off cost** and shows **You save**.",
        "• `customer` lets the bot check that customer’s discount roles (server only).",
        "",
        "If your build includes `subtract_fee`, you can force add-fee mode:",
        "• `/calc cost:12.29 subtract_fee:false` → cost + fee"
      ], 0x3b82f6)
    );
  }

  if (topic === "tickets") {
    embeds.push(
      makeEmbed("🎫 Tickets (/claim, /closeticket, /closealltickets)", [
        "**/claim** — claim + rename a ticket (server-only)",
        "• `/claim user:@someone`",
        "• Optional: category/custom naming (if enabled in your build)",
        "• `/claim unclaim:true` reverts to original name (stored in topic as `Original:`)",
        "",
        "**Naming format** (default behavior):",
        "• INVINCIBLE EATS → `username-invincible-####`",
        "• Other servers → `username-<server-name>-####`",
        "",
        "**/closeticket** — shows buttons (Save+Close w/ transcript OR Delete only)",
        "**/closealltickets** — bulk close tickets (uses `/ticket_config` for best results)"
      ], 0xef4444)
    );
  }

  if (topic === "vouches") {
    embeds.push(
      makeEmbed("✅ Vouches (/vouch, /vouchchecker)", [
        "**/vouch** — customer submits a vouch for staff",
        "• Increments vouch counts and updates loyalty tier roles.",
        "",
        "**/vouchcount** — shows a user’s vouch count + tier.",
        "",
        "**Auto-vouching**",
        "In channels with “vouch” in the name, the bot can auto-count messages that look like vouches (mentions staff or has attachments).",
        "",
        "**/vouchchecker** — scans vouch channels and (optionally) reacts ✅ + updates counts**",
        "Recommended safe usage:",
        "• Run without apply first: `/vouchchecker`",
        "• Then apply safely: `/vouchchecker apply:true sync_roles:true` (upgrade-only)",
        "• `force:true` allows full rebuild (can lower counts — use carefully)."
      ], 0x10b981)
    );
  }

  if (topic === "track") {
    embeds.push(
      makeEmbed("🔎 Link Tracker (/track)", [
        "**/track url:<link>** posts a tracker-style embed for DoorDash/Uber Eats links (best-effort).",
        "",
        "What it can do:",
        "• Detect link type + extract IDs from URL",
        "• Pull public page preview metadata when available",
        "• Add a clean embed + “Open link” button",
        "",
        "Limitations:",
        "• Real-time driver location / live order progress usually requires login or a partner API.",
        "• This bot does **not** use cookies/auth to scrape private order details."
      ], 0x64748b)
    );
  }

  // Unknown topic fallback
  if (!embeds.length) {
    embeds.push(
      makeEmbed("📘 Bot Guide", [
        "Unknown topic. Try:",
        "`/guide` or `/guide topic:Payments` (Setup/Payments/Calc/Tickets/Vouches/Track)."
      ], 0xa78bfa)
    );
  }

  return interaction.reply(inGuild ? { embeds, ephemeral: true } : { embeds });
}

// HELP
    if (cmd === "help") {
      const e = new EmbedBuilder()
        .setColor(0x2dd4bf)
        .setTitle("INVINCIBLE EATS — Commands")
        .setDescription([
          "**Setup:** /server_setup",
          "**Tickets:** /claim /closeticket /ticket_config /closealltickets",
          "**Payments:** /setpay /delpay /pay /showpay /paycanada",
          "**Orders:** /ueinspect /track",
          "**Vouching:** /vouch /vouchcount /vouchchecker",
          "**Moderation:** /scanpromos",
          "**Bump:** /bump_config /bump /bumpstatus",
          "**Utility:** /announce /sayembed /invoice /calc /autoclose_now /autoopen_now",
          "**Guide:** /guide",
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

    // EDITPAY (interactive)
    if (cmd === "editpay") {
      const hasJusticeChefRole = interaction.member?.roles?.cache?.has(JUSTICE_CHEF_ROLE_ID);
      if (!hasJusticeChefRole && !interaction.memberPermissions?.has("ManageGuild")) {
        return interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
      }

      const staff = interaction.options.getUser("staff") || interaction.options.getUser("user") || interaction.user;
      const panel = await buildEditPayPanel({ guild: interaction.guild, staffId: staff.id, editorId: interaction.user.id });
      return interaction.reply({ ...panel, ephemeral: true });
    }


    // PAY (pings ticket opener)
    if (cmd === "pay") {
      // staff is optional; default to the caller (useful in DMs)
      const staffOpt = interaction.options.getUser("staff");
      const staffIdRaw = interaction.options.getString("staff_id");
      let staff = staffOpt;

      // In DMs, Discord only lets you pick users who are in the DM. If you need a different staff member,
      // use staff_id (User ID) instead.
      if (!staff && staffIdRaw) {
        const id = String(staffIdRaw).replace(/[<@!>]/g, "").trim();
        if (/^\d{17,20}$/.test(id)) {
          try { staff = await client.users.fetch(id); } catch {}
        }
      }

      if (!staff) staff = interaction.user;
      const saved = payStore[staff.id];

      if (!saved) {
        return interaction.reply({ content: `No saved payment info for that staff member.`, ephemeral: true });
      }

      const amount = interaction.options.getNumber("amount");
      const note = interaction.options.getString("note") || "";
      const customerOpt = interaction.options.getUser("customer");
      const channel = interaction.channel;

      let openerId = customerOpt?.id || null;
      if (!openerId && channel && isTicketChannel(channel.name)) {
        const messages = await fetchAllMessages(channel, 200);
        openerId = await findOpener(channel, messages);
      }

      const embed = buildPayEmbed(interaction.user, staff, saved, amount ?? null, note, openerId);

      // Send first to get a messageId, then attach buttons mapped to THIS message.
      const payload = {
        embeds: [embed],
        components: [],
        ephemeral: false,
        fetchReply: true
      };

      if (openerId) {
        payload.content = `<@${openerId}>`;
      }

      const sent = await interaction.reply(payload);
      const components = buildPayButtons(saved, staff.id);
      await interaction.editReply({ components });
      return;
}

    // SHOWPAY
    if (cmd === "showpay") {
      const staffOpt = interaction.options.getUser("staff");
      const staffIdRaw = interaction.options.getString("staff_id");
      let staff = staffOpt;

      // In DMs, Discord only lets you pick users who are in the DM. If you need a different staff member,
      // use staff_id (User ID) instead.
      if (!staff && staffIdRaw) {
        const id = String(staffIdRaw).replace(/[<@!>]/g, "").trim();
        if (/^\d{17,20}$/.test(id)) {
          try { staff = await client.users.fetch(id); } catch {}
        }
      }

      if (!staff) staff = interaction.user;
      const saved = payStore[staff.id];

      if (!saved) {
        return interaction.reply({
          content: `No payment info saved for **${staff.tag}**.`,
          ephemeral: true
        });
      }

      const note = interaction.options.getString("note") || "";
      const embed = buildPayEmbed(interaction.user, staff, saved, null, note, null);

      // Send first to get a messageId, then attach buttons mapped to THIS message.
      const sent = await interaction.reply({
        embeds: [embed],
        components: [],
        ephemeral: false,
        fetchReply: true
      });

      const components = buildPayButtons(saved, staff.id);
      await interaction.editReply({ components });
      return;
    }


    // PAYCANADA (Wise + Stripe + optional crypto preference)
    if (cmd === "paycanada") {
      const customer = interaction.options.getUser("customer");
      const amount = interaction.options.getNumber("amount");
      const crypto = interaction.options.getString("crypto");
      const noteRaw = interaction.options.getString("note") || "";

      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("🇨🇦 Canada Payment")
        .setDescription(
          `**Wise:** ${CANADA_WISE_URL}\n` +
          `**Stripe:** ${CANADA_STRIPE_URL}\n\n` +
          `**${CANADA_STRIPE_NOTE}**\n\n` +
          `**Crypto options:** ETH, LTC, USDT`
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      if (customer) embed.addFields({ name: "Customer", value: `<@${customer.id}>`, inline: true });
      if (amount != null) embed.addFields({ name: "Amount (CAD)", value: fmtMoneyCAD(amount), inline: true });
      if (crypto) embed.addFields({ name: "Crypto (optional)", value: `**${crypto}**`, inline: true });
      if (noteRaw) embed.addFields({ name: "Note", value: noteRaw, inline: false });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Pay with Wise")
          .setStyle(ButtonStyle.Link)
          .setURL(CANADA_WISE_URL),
        new ButtonBuilder()
          .setLabel("Pay with Stripe")
          .setStyle(ButtonStyle.Link)
          .setURL(CANADA_STRIPE_URL)
      );

      // Public reply so the customer can see the links; ping if provided.
      const content = customer ? `<@${customer.id}>` : null;
      return interaction.reply({ content, embeds: [embed], components: [row], ephemeral: false });
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
      // Option name in the builder is "order_channel" (not "orders_channel")
      const ordersCh = interaction.options.getChannel("order_channel", true);
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
        await syncCustomerTierRolesUpgradeOnly(interaction.guild, member, newCustCount);
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
// VOUCHCHECKER (scan posted vouches + optional ✅ reaction + optional safe rebuild)
if (cmd === "vouchchecker") {
      const guild = interaction.guild;
      if (!guild) {
        return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      }

      // Options
      const channelOpt = interaction.options.getChannel("channel");
      const scanAll = interaction.options.getBoolean("all_channels") ?? false;
      const limit = interaction.options.getInteger("limit") || 3000; // per channel
      const doReact = interaction.options.getBoolean("react") ?? true;
      const apply = interaction.options.getBoolean("apply") ?? true;
      const force = interaction.options.getBoolean("force") ?? false; // true = overwrite JSON + strict role sync (can downgrade)

      await interaction.deferReply({ ephemeral: true });

      // Build channel list
      await guild.channels.fetch().catch(() => {});
      const EXTRA_VOUCH_CHANNEL_NAMES = new Set([
        "food-vouches",
        "subscription-other-vouches",
        "meal-kits-vouches"
      ]);

      let channelsToScan = [];
      if (scanAll || !channelOpt) {
        channelsToScan = [...guild.channels.cache.values()].filter(ch => {
          if (!ch) return false;
          if (!(ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)) return false;
          const name = String(ch.name || "").toLowerCase();
          return isLikelyVouchChannel(ch) || EXTRA_VOUCH_CHANNEL_NAMES.has(name);
        });

        // Fallback: at least scan the current channel if it is text-based
        if (!channelsToScan.length && interaction.channel?.isTextBased?.()) {
          channelsToScan = [interaction.channel];
        }
      } else {
        channelsToScan = [channelOpt];
      }

      if (!channelsToScan.length) {
        return safeEditReply(interaction, "No vouch channels found to scan.");
      }

      // Helpers
      const isStaffId = (id) => {
        if (!id) return false;
        // Quick check based on known staff role IDs (guild-specific staff isn't stored, but this is your server's staff list)
        // In other servers, staff counting still works when a staff member is mentioned AND they have one of the STAFF_ROLE_IDS.
        return true;
      };

      function isStaffMember(member) {
        return member?.roles?.cache?.some(r => STAFF_ROLE_IDS.includes(r.id));
      }

      // Parse vouch from a raw message
      async function detectVouchFromMessage(ch, msg) {
        try {
          // 1) /vouch embed created by THIS bot
          if (msg.author?.bot && msg.embeds?.length) {
            const e = msg.embeds[0];
            const title = String(e.title || "").toLowerCase();
            if (title.includes("new vouch")) {
              const fields = e.fields || [];
              const custField = fields.find(f => String(f.name || "").toLowerCase().includes("customer"));
              const staffField = fields.find(f => String(f.name || "").toLowerCase().includes("served by"));
              const custId = custField?.value?.match(/<@!?(\d+)>/)?.[1] || null;
              const staffId = staffField?.value?.match(/<@!?(\d+)>/)?.[1] || null;
              if (custId) return { customerId: custId, staffId };
            }
          }

          // 2) Manual vouch message in a vouch channel
          if (msg.author?.bot) return null;

          const content = String(msg.content || "");
          const lower = content.toLowerCase();

          const hasAttachment = (msg.attachments?.size || 0) > 0;
          const hasVouchWord =
            /\bvouch(ed|ing)?\b/i.test(content) ||
            /\b\+1\b/.test(content) ||
            /\brep\b/i.test(content) ||
            /\btrusted\b/i.test(content) ||
            /\blegit\b/i.test(content);

          // Require *something* that signals a vouch: attachment or vouch-ish words
          if (!hasAttachment && !hasVouchWord) return null;

          // Staff mention is best for staff credit, but not required to count the customer vouch.
          let staffId = msg.mentions?.users?.first()?.id || null;

          // If the mentioned user isn't staff in THIS guild, drop staff credit (still count customer).
          if (staffId) {
            const staffMember = await ch.guild.members.fetch(staffId).catch(() => null);
            if (!isStaffMember(staffMember)) staffId = null;
          }

          return { customerId: msg.author.id, staffId };
        } catch {
          return null;
        }
      }

      // Scan channels
      const staffCounts = {};
      const custCounts = {};
      const perChannelStats = [];

      let totalScanned = 0;
      let totalFound = 0;
      let totalReactionsAdded = 0;

      for (const ch of channelsToScan) {
        if (!ch?.isTextBased?.()) continue;

        let scannedHere = 0;
        let foundHere = 0;
        let reactedHere = 0;

        // Permission check for reacting
        const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
        const perms = me ? ch.permissionsFor(me) : null;
        const canReadHistory = perms?.has(PermissionFlagsBits.ReadMessageHistory) ?? true;
        const canAddReactions = perms?.has(PermissionFlagsBits.AddReactions) ?? true;

        if (!canReadHistory) {
          perChannelStats.push({ id: ch.id, name: ch.name, scanned: 0, found: 0, reacted: 0, skipped: "No ReadMessageHistory" });
          continue;
        }

        let fetched = null;
        try {
          fetched = await ch.messages.fetch({ limit: Math.min(100, limit) });
        } catch {
          perChannelStats.push({ id: ch.id, name: ch.name, scanned: 0, found: 0, reacted: 0, skipped: "Cannot fetch messages" });
          continue;
        }

        let lastId = fetched?.last()?.id;
        let messages = fetched ? [...fetched.values()] : [];

        while (messages.length < limit && fetched && fetched.size === 100) {
          fetched = await ch.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
          if (!fetched || fetched.size === 0) break;
          messages.push(...fetched.values());
          lastId = fetched.last().id;
          if (messages.length >= limit) break;
        }

        messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        for (const msg of messages) {
          scannedHere++;
          totalScanned++;

          const v = await detectVouchFromMessage(ch, msg);
          if (!v) continue;

          foundHere++;
          totalFound++;

          // Count customer
          custCounts[v.customerId] = (custCounts[v.customerId] || 0) + 1;

          // Count staff if present
          if (v.staffId) {
            staffCounts[v.staffId] = (staffCounts[v.staffId] || 0) + 1;
          }

          // React with ✅ (only if requested, and only if bot can react)
          if (doReact && canAddReactions) {
            const already = msg.reactions?.cache?.find(r => r.emoji?.name === "✅");
            const meReacted = already?.me === true;
            if (!meReacted) {
              try {
                await msg.react("✅");
                reactedHere++;
                totalReactionsAdded++;
              } catch {
                // ignore
              }
            }
          }
        }

        perChannelStats.push({ id: ch.id, name: ch.name, scanned: scannedHere, found: foundHere, reacted: reactedHere, skipped: null });
        // tiny delay to avoid rate limits when scanning multiple channels
        await sleep(450);
      }

      // Apply to stores + roles
      let savedCustomers = 0;
      let savedStaff = 0;

      if (apply) {
        // Merge counts to avoid accidental downgrades from missing JSON data.
        for (const [sid, c] of Object.entries(staffCounts)) {
          savedStaff++;
          const prev = vouchByStaff[sid] || 0;
          vouchByStaff[sid] = force ? c : Math.max(prev, c);
        }

        for (const [cid, c] of Object.entries(custCounts)) {
          savedCustomers++;
          const prev = vouchByCust[cid] || 0;
          vouchByCust[cid] = force ? c : Math.max(prev, c);
        }

        writeJson("vouches_by_staff.json", vouchByStaff);
        writeJson("vouches_by_customer.json", vouchByCust);

        // Sync roles (force can downgrade; normal mode only upgrades)
        for (const [cid, count] of Object.entries(custCounts)) {
          const member = await guild.members.fetch(cid).catch(() => null);
          if (!member) continue;

          const finalCount = vouchByCust[cid] || count || 0;
          if (force) {
            await syncCustomerTierRoles(guild, member, finalCount).catch(() => {});
          } else {
            await syncCustomerTierRolesUpgradeOnly(guild, member, finalCount).catch(() => {});
          }
        }
      }

      // Build summary embed
      const lines = [];
      const shown = perChannelStats.slice(0, 10); // avoid huge embeds
      for (const s of shown) {
        const base = `<#${s.id}> — scanned **${s.scanned}**, found **${s.found}**` + (doReact ? `, ✅ **${s.reacted}**` : "");
        lines.push(s.skipped ? `${base} *(skipped: ${s.skipped})*` : base);
      }
      if (perChannelStats.length > shown.length) {
        lines.push(`…and **${perChannelStats.length - shown.length}** more channel(s).`);
      }

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("✅ Vouch Checker")
        .setDescription(
          [
            `**Channels scanned:** ${perChannelStats.length}`,
            `**Messages scanned:** ${totalScanned}`,
            `**Vouches detected:** ${totalFound}`,
            doReact ? `**Reactions added:** ${totalReactionsAdded}` : null,
            apply ? `**Saved:** customers=${savedCustomers}, staff=${savedStaff} ${force ? "(FORCE overwrite)" : "(safe merge)"}` : "**Saved:** No (apply=false)",
            "",
            "**Per-channel:**",
            lines.join("\n")
          ].filter(Boolean).join("\n")
        )
        .setTimestamp();

      return safeEditReply(interaction, { embeds: [embed] });
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
  const cost = interaction.options.getNumber("cost", true);
  const feeInput = interaction.options.getNumber("fee"); // optional
  const subtractFee = interaction.options.getBoolean("subtract_fee") ?? false; // Default OFF (we ADD fee)
  const presetPercent = interaction.options.getNumber("preset_percent"); // optional
  const percent = interaction.options.getNumber("percent"); // optional
  const percentTable = interaction.options.getString("percent_table"); // optional
  const customerUser = interaction.options.getUser("customer") ?? interaction.user;
  const isPublic = interaction.options.getBoolean("public") ?? false;

  if (!interaction.inGuild() || !interaction.guild) {
    return interaction.reply({
      content: "⚠️ `/calc` must be used inside a server so I can check roles.",
      ephemeral: true,
    });
  }

  const guild = interaction.guild;
  await interaction.deferReply({ ephemeral: !isPublic });

  // ---- Helpers: role detection that works even when interaction.member is "partial"
  const norm = (s) => {
    // Normalize role names so checks work even if roles include emojis or punctuation.
    // Examples:
    //  - "VILTRUMITE 💥" -> "viltrumite"
    //  - "20% OFF- REMOVE AFTER USE" -> "20% off remove after use"
    const str = String(s ?? "").trim().toLowerCase();
    // Remove common emoji blocks + symbols, then collapse remaining non-letters/numbers/% into spaces.
    return str
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
      .replace(/[^\p{L}\p{N}%]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  const getRoleIdsFromMember = (m) => {
    if (!m) return [];
    // APIInteractionGuildMember has roles: string[]
    if (Array.isArray(m.roles)) return m.roles;
    // GuildMember has roles as RoleManager
    if (m.roles?.cache) return Array.from(m.roles.cache.keys());
    // Some environments expose _roles
    if (Array.isArray(m._roles)) return m._roles;
    return [];
  };

  const getRoleNamesFromIds = (ids) =>
    ids
      .map((id) => guild.roles.cache.get(id)?.name)
      .filter(Boolean);

  const getAllRoleNames = (m) => {
    if (!m) return [];
    if (m.roles?.cache) return m.roles.cache.map((r) => r.name);
    return getRoleNamesFromIds(getRoleIdsFromMember(m));
  };

  const hasAnyRoleName = (m, names) => {
    const roleNameSet = new Set(getAllRoleNames(m).map(norm));
    return names.some((n) => roleNameSet.has(norm(n)));
  };

  // Fetch the target member if we can (helps for removing one-time roles).
  let customerMember = null;
  if (customerUser.id === interaction.user.id && interaction.member) {
    customerMember = interaction.member; // can be GuildMember or APIInteractionGuildMember
  } else {
    customerMember = await guild.members.fetch(customerUser.id).catch(() => null);
  }

  // If the command targets a different user but we can't resolve them as a guild member,
  // don't silently fall back to the invoker (that makes role checks look "broken").
  if (customerUser.id !== interaction.user.id && !customerMember) {
    await interaction.editReply({
      content:
        `I couldn't fetch **${customerUser.tag}** as a server member, so I can't read their roles.\n\n` +
        `**Fix checklist:**\n` +
        `• Make sure that user is actually in this server\n` +
        `• In Discord Developer Portal → Bot → Privileged Gateway Intents: enable **Server Members Intent**\n` +
        `• Restart the bot after enabling it\n`,
    });
    return;
  }

  const memberForRoles = customerMember ?? interaction.member;

  const roleNames = (memberForRoles?.roles?.cache ? [...memberForRoles.roles.cache.values()].map(r => r.name) : []);
  const roleNamesLower = new Set(roleNames.map(n => String(n).trim().toLowerCase()));
  // ---- One-time roles (exact names)
  // Use role **IDs** for reliable detection (names can contain emojis/case/spacing changes).
  // Provided by you:
  //   VILTRUMITE = 1394179600187261058
  //   ORDER AT COST- REMOVE AFTER USE = 1386924124433023062
  //   20% OFF- REMOVE AFTER USE = 1386924124433023063
  const ROLE_20_OFF_ONETIME_ID = "1386924124433023063";
  const ROLE_ORDER_AT_COST_ONETIME_ID = "1386924124433023062";
  const ROLE_VILTRUMITE_ID = "1394179600187261058";

  const ROLE_20_OFF_ONETIME = "20% OFF- REMOVE AFTER USE";
  const ROLE_ORDER_AT_COST_ONETIME = "ORDER AT COST- REMOVE AFTER USE";

  // ---- Discounts
  // (A) Manual promo first (percent_table/preset_percent/percent)
  // (B) Then role adjustments after manual promo
  const VILTRUMITE_DISCOUNT = 0.20;

  const memberRoleIds = getRoleIdsFromMember(memberForRoles);
  const hasOneTime20Off = memberRoleIds.includes(ROLE_20_OFF_ONETIME_ID);
  const hasOrderAtCost = memberRoleIds.includes(ROLE_ORDER_AT_COST_ONETIME_ID);
  const hasViltrumite = memberRoleIds.includes(ROLE_VILTRUMITE_ID);

  // Resolve service fee (default $9)
  const feeForMath = typeof feeInput === "number" ? feeInput : DEFAULT_SERVICE_FEE;

  // 1) Start with base cost
  let base = cost;

  // 2) Manual promo percent
  let manualPercentOff = 0;

  if (typeof percent === "number") {
    manualPercentOff = percent;
  } else if (typeof presetPercent === "number") {
    manualPercentOff = presetPercent;
  } else if (typeof percentTable === "string" && percentTable.trim()) {
    const cleaned = percentTable.replace(/%/g, "").trim();
    const num = Number(cleaned);
    if (!Number.isNaN(num) && num >= 0) manualPercentOff = num;
  }

  if (manualPercentOff > 0) {
    const p = Math.min(Math.max(manualPercentOff, 0), 100) / 100;
    base = base * (1 - p);
  }

  // 3) Role-based adjustments AFTER manual promo
  let roleDiscountLabel = "";
  let rolePercentOff = 0;

  if (hasOrderAtCost) {
    roleDiscountLabel = ROLE_ORDER_AT_COST_ONETIME;
    rolePercentOff = 0;
  } else if (hasOneTime20Off) {
    roleDiscountLabel = ROLE_20_OFF_ONETIME;
    rolePercentOff = 0.20;
  } else if (hasViltrumite) {
    roleDiscountLabel = "Viltrumite";
    rolePercentOff = VILTRUMITE_DISCOUNT;
  }

  if (!hasOrderAtCost && rolePercentOff > 0) {
    base = base * (1 - rolePercentOff);
  }

  // Order-at-cost waives fee
  const finalFee = hasOrderAtCost ? 0 : feeForMath;

  // 4) Total: default ADD fee
  const total = subtractFee ? base - finalFee : base + finalFee;

  // ---- Response
  const lines = [];
  lines.push(`Cost: **${fmtMoney(cost)}**`);

  if (manualPercentOff > 0) {
    lines.push(`Manual promo: **-${manualPercentOff}%**`);
  }

  if (roleDiscountLabel) {
    if (hasOrderAtCost) {
      lines.push(`Role applied: **${roleDiscountLabel}** (fee waived)`);
    } else {
      lines.push(`Role applied: **${roleDiscountLabel}** (${Math.round(rolePercentOff * 100)}% off)`);
    }
  }

  lines.push(subtractFee ? `Fee: **-${fmtMoney(finalFee)}** (subtract_fee ON)` : `Fee: **+${fmtMoney(finalFee)}**`);
  lines.push(`Total: **${fmtMoney(total)}**`);

    const header = isPublic ? "" : `For: <@${customerUser.id}>\n`;
    const debug = [];
    if (!isPublic) {
      debug.push(
        `Role checks: Viltrumite ${hasViltrumite ? "✅" : "❌"} | 20% OFF role ${hasOneTime20Off ? "✅" : "❌"} | Order-at-cost role ${hasOrderAtCost ? "✅" : "❌"}`
      );
      if (roleNames?.length) {
        const shown = roleNames.slice(0, 20).join(", ");
        debug.push(`Roles seen (${roleNames.length}): ${shown}${roleNames.length > 20 ? " …" : ""}`);
      } else {
        debug.push(`Roles seen: (none / unable to resolve)`);
      }
    }
    const content = `${header}${debug.length ? debug.join("\n") + "\n\n" : ""}${lines.join("\n")}`;

  await interaction.editReply({ content });

  // ---- Remove one-time roles after use (best-effort)
  const removeRoleById = async (roleId) => {
    try {
      if (!roleId) return;
      const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
      if (!role) return;

      const gm =
        customerMember && customerMember.roles?.cache
          ? customerMember
          : await guild.members.fetch(customerUser.id).catch(() => null);

      if (!gm || !gm.roles?.remove) return;
      if (!gm.roles.cache.has(role.id)) return;

      await gm.roles.remove(role, "Auto-remove one-time promo role after /calc");
    } catch (_) {}
  };

  if (hasOneTime20Off) await removeRoleById(ROLE_20_OFF_ONETIME_ID);
  if (hasOrderAtCost) await removeRoleById(ROLE_ORDER_AT_COST_ONETIME_ID);

  return;
}

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

      // TRACK (best-effort order link preview)
      if (cmd === "track") {
        const url = interaction.options.getString("url", true);
        const makePublic = interaction.options.getBoolean("public") ?? false;

        let info;
        try {
          info = classifyTrackingUrl(url);
        } catch (e) {
          return interaction.reply({ content: "That doesn't look like a valid URL.", ephemeral: true });
        }

        const og = await fetchOGMeta(url);
        const embed = buildTrackingEmbed(url, info, og, interaction.user);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel("Open link")
        );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: !makePublic });
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

if (cmd === "claim") {
      const guild = interaction.guild;
      const channel = interaction.channel;

      if (!guild || !channel) {
        return interaction.reply({ content: "Guild/channel not found."});
      }

      // Defer immediately so Discord never shows "interaction failed"
      // (channel edits / API fetches can take > 3s).
      await interaction.deferReply({ ephemeral: true });


      // Staff permission: Manage Channels / Admin OR the server's configured Justice role
      const cfg = getServerCfg(interaction.guildId);
      const staffRoleId = cfg?.justiceChefRoleId || JUSTICE_CHEF_ROLE_ID;

      const member = interaction.member;
      const allowed =
        member?.permissions?.has(PermissionFlagsBits.ManageChannels) ||
        member?.permissions?.has(PermissionFlagsBits.Administrator) ||
        member?.roles?.cache?.has(staffRoleId);

      if (!allowed) {
        return interaction.editReply({
          content: `You need **Manage Channels**, **Administrator**, or the configured staff role: <@&${staffRoleId}>.`});
      }

      // Bot permission check (so you get a REAL error instead of "it didn't work")
      const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
      const botPerms = me ? channel.permissionsFor(me) : null;

      if (!botPerms?.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.editReply({
          content: "❌ I can't rename this channel because I'm missing **Manage Channels** permission here."});
      }

      // Only allow in ticket-ish channels (ticket-#### or anything ending in -####)
      if (!isTicketChannel(channel.name)) {
        return interaction.editReply({
          content: "This command can only be used in a ticket channel (ex: `ticket-1234`)."});
      }

      // Defer so channel edits never time out
const doUnclaim = interaction.options.getBoolean("unclaim") || false;

      // Optional category for naming
      const category = interaction.options.getString("category");
      const customCategory = interaction.options.getString("custom") || "";

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
          return interaction.editReply({
            content: "Unclaim failed — check channel permissions."});
        }

        const e = new EmbedBuilder()
          .setColor(0x94a3b8)
          .setTitle("🧾 Ticket Unclaimed")
          .setDescription(`Reverted channel name back to: \`${originalName}\``)
          .setTimestamp();

        return interaction.editReply({ embeds: [e]});
      }

      // ----- CLAIM -----
      const targetUser = interaction.options.getUser("user");
      if (!targetUser) {
        return interaction.editReply({
          content: "Pick a **user** to claim this ticket for, or run **/claim unclaim:true** to revert."});
      }

      const ticketNumber = extractTicketNumberFromChannel(channel.name) || "0000";

      // Determine the "middle" segment:
      // - If a category was provided (UE/DD/Custom), use that.
      // - Otherwise, use the server name (INVINCIBLE EATS -> invincible).
      let mid = "";
      if (category === "ue") mid = "ue";
      else if (category === "dd") mid = "dd";
      else if (category === "custom") {
        if (!customCategory.trim()) {
          return interaction.editReply({
            content: "If you pick **Custom**, you must enter the `custom` text too."});
        }
        mid = slugifyUsername(customCategory);
      } else {
        const gname = String(interaction.guild?.name || "server");
        mid = /invincible/i.test(gname) ? "invincible" : slugifyUsername(gname);
      }

      // Original channel name (used for /claim unclaim:true)
      // If the topic already contains "Original:", keep that (so multiple claims don't overwrite it).
      const topicNow = channel.topic || "";
      const existingOriginal = (topicNow.match(/Original:\s*([^\s|]+)/i) || [])[1] || null;
      const original = existingOriginal || channel.name;

      // New name: <user>-<mid>-####
      let userSlug = slugifyUsername(targetUser.username);
      let newName = `${userSlug}-${mid}-${ticketNumber}`;

      // Discord channel name max length is 100. If we overflow, trim the username portion.
      if (newName.length > 100) {
        const extra = newName.length - 100;
        userSlug = userSlug.slice(0, Math.max(3, userSlug.length - extra));
        newName = `${userSlug}-${mid}-${ticketNumber}`;
        newName = newName.slice(0, 100);
      }

      const newTopic =
        channel.topic && channel.topic.toLowerCase().includes("original:")
          ? channel.topic
          : `Original: ${original}${channel.topic ? ` | ${channel.topic}` : ""}`;

      try {
        await channel.edit({ name: newName, topic: newTopic });
      } catch (e) {
        return interaction.editReply({
          content: "Rename failed — check channel permissions."});
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

      return interaction.editReply({ embeds: [e]});
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

client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  // Register GUILD commands for every server this bot is in.
  // This is what makes /claim (and the other server-only commands) show up quickly in ALL servers.
  // (Global command propagation can take a while.)
  try {
    await registerGuildCommandsForAllGuilds(client);
  } catch (e) {
    console.log("Guild command registration (ready) failed:", e?.message || e);
  }

// Re-apply DNF locks on startup (useful if you configured DNF on an older build)
try {
  for (const [guildId, guild] of client.guilds.cache) {
    const cfg = getDNFCfg(guildId);
    if (!cfg?.roleId || !cfg?.panelChannelIds?.length) continue;

    const role =
      guild.roles.cache.get(cfg.roleId) ||
      (await guild.roles.fetch(cfg.roleId).catch(() => null));
    if (!role) continue;

    for (const chId of cfg.panelChannelIds) {
      const channel =
        guild.channels.cache.get(chId) ||
        (await guild.channels.fetch(chId).catch(() => null));
      if (!channel) continue;

      await lockChannelForDNF(channel, role, { hide: true, lockHistory: true });
    }
  }
  console.log("[DNF] Startup re-apply complete.");
    await reapplyDNFMemberBlocksOnStartup();
} catch (e) {
  console.log("[DNF] Startup re-apply failed:", e?.message || e);
}


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


// Keep member-specific DNF blocks in sync even if roles are added/removed manually.
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const cfg = getDNFCfg(newMember.guild.id);
    if (!cfg?.roleId || !cfg?.panelChannelIds?.length) return;

    const had = oldMember.roles.cache.has(cfg.roleId);
    const has = newMember.roles.cache.has(cfg.roleId);

    if (!had && has) {
      await applyDNFBlocksForMember(newMember.guild, newMember.id, cfg, true);
    } else if (had && !has) {
      await applyDNFBlocksForMember(newMember.guild, newMember.id, cfg, false);
    }
  } catch (e) {
    console.warn("[DNF] guildMemberUpdate sync failed:", e?.message || e);
  }
});

  client.login(process.env.DISCORD_TOKEN);
})();