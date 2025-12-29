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
  AttachmentBuilder
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
const STATUS_CHANNEL_ID = "1386956979632734238";
const STATUS_ANNOUNCE_CHANNEL_ID = "1386924126844879008";
const ORDER_PERMS_CHANNEL_ID = "1386924125834051737";

// Customer base + tiers
const HERO_IN_TRAINING_ROLE_ID = "1386924124860846131"; // everyone gets this
const VERIFIED_BUYER_ROLE_ID = "1396954121780854874";
const FREQUENT_BUYER_ROLE_ID = "1396955746108833842";
const VILTRUMITE_ROLE_ID = "1394179600187261058"; // Diamond tier

// Staff roles (complete list)
const JUSTICE_CHEF_ROLE_ID = "1386924124873556029";          // existing
const INVINCIBLE_CHEF_ROLE_ID = "1386924124873556038";       // existing
const JUSTICE_CHEF_ON_PATROL_ROLE_ID = "1386924124873556030";
const UE_CHEF_ROLE_ID = "1386924124860846137";
const DD_CHEF_ROLE_ID = "1386924124860846135";

// Transcript log + UE tickets
const TRANSCRIPT_LOG_ID = "1386924127041880081";
const UBER_TICKETS_CHANNEL = "1386924125834051744";

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
const bumpStore = readJson("bumps.json", {});             // guildId -> { channelId, intervalMin, lastBumpTs }
const vouchByStaff = readJson("vouches_by_staff.json", {});  // staffId -> count
const vouchByCust = readJson("vouches_by_customer.json", {}); // customerId -> count

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
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
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
  /\bcheaper\b/i,
  /http(s)?:\/\//i
];

const UE_REGEX = /https:\/\/www\.ubereats\.com\/group-order\/[^ \n]+/i;

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
    if (message.channel.id !== STATUS_CHANNEL_ID) return;

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
    const hasChef = members.some(m => m.roles.cache.has(JUSTICE_CHEF_ROLE_ID));
    if (hasChef) return;

    // No chef → revert to CLOSED
    let newText = message.content || "";
    newText = newText
      .replace(/🟢/g, "🔴")
      .replace(/open/gi, "CLOSED (no Justice Chef)");

    await message.edit(newText).catch(() => {});

    // Fix perms in order channel
    const orderCh = message.guild.channels.cache.get(ORDER_PERMS_CHANNEL_ID);
    if (orderCh) {
      await orderCh.permissionOverwrites.edit(HERO_IN_TRAINING_ROLE_ID, {
        ViewChannel: true,
        ReadMessageHistory: true
      }).catch(() => {});
    }

    // Status announcement
    const ann = client.channels.cache.get(STATUS_ANNOUNCE_CHANNEL_ID);
    if (ann) {
      const e = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("⚠️ Status Reverted — No Justice Chef")
        .setDescription(
          "Someone set the restaurant to **OPEN**, but no one with the **Justice Chef on patrol** role is online.\n\n" +
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
      const guild = client.guilds.cache.first();
      if (!guild) return;

      const orderCh = guild.channels.cache.get(ORDER_PERMS_CHANNEL_ID);
      if (!orderCh) return;

      const heroPerms = orderCh.permissionOverwrites.cache.get(HERO_IN_TRAINING_ROLE_ID);

      const mismatch =
        !heroPerms ||
        heroPerms.allow.has("ViewChannel") !== true ||
        heroPerms.allow.has("ReadMessageHistory") !== true;

      if (!mismatch) return;

      // Only allow changes if Justice Chef is present
      const members = await guild.members.fetch();
      const chefPresent = members.some(m => m.roles.cache.has(JUSTICE_CHEF_ROLE_ID));
      if (chefPresent) return;

      // Auto-repair perms
      await orderCh.permissionOverwrites.edit(HERO_IN_TRAINING_ROLE_ID, {
        ViewChannel: true,
        ReadMessageHistory: true
      }).catch(() => {});

      // Fix status message as well
      const statusCh = guild.channels.cache.get(STATUS_CHANNEL_ID);
      if (statusCh) {
        const msgs = await statusCh.messages.fetch({ limit: 1 }).catch(() => null);
        const msg = msgs?.first();
        if (msg) {
          const edited = (msg.content || "🔴 CLOSED")
            .replace(/🟢/g, "🔴")
            .replace(/open/gi, "CLOSED (no Justice Chef)");
          await msg.edit(edited).catch(() => {});
        }
      }

      // Announce the correction
      const ann = guild.channels.cache.get(STATUS_ANNOUNCE_CHANNEL_ID);
      if (ann) {
        const e = new EmbedBuilder()
          .setColor(0xff4444)
          .setTitle("⚠️ Unauthorized Change Reverted")
          .setDescription(
            "Order-channel permissions were changed without a **Justice Chef** online.\n\n" +
            "Permissions restored and status forced to **CLOSED**."
          )
          .setTimestamp();
        ann.send({ embeds: [e] });
      }

    } catch (err) {
      console.log("Watchdog error:", err);
    }
  }, 5000);
}

// ============================================
// BUMP TIMER SYSTEM
// ============================================

function scheduleBumpTimer(guildId) {
  const cfg = bumpStore[guildId];
  if (!cfg) return;

  const intervalMs = (cfg.intervalMin || 120) * 60 * 1000;

  if (cfg._timer) clearTimeout(cfg._timer);

  cfg._timer = setTimeout(async () => {
    try {
      const g = client.guilds.cache.get(guildId);
      if (!g) return;

      const ch = g.channels.cache.get(cfg.channelId);
      if (!ch) return;

      await ch.send("🔔 **Time to bump!** Use `/bump` or type `!d bump`.");
    } catch (err) {
      console.log("Bump timer error:", err);
    }
  }, intervalMs);
}

// ============================================
// MESSAGE HANDLERS
// ============================================

client.on("messageCreate", async msg => {
  if (!msg.guild) return;

  // 1) Auto-detect Disboard bump
  try {
    if (msg.author.id === DISBOARD_BOT_ID && msg.embeds?.length) {
      const emb = msg.embeds[0];
      const text = `${emb.title || ""} ${emb.description || ""}`.toLowerCase();

      if (text.includes("bump done")) {
        const gId = msg.guild.id;

        if (bumpStore[gId]) {
          bumpStore[gId].lastBumpTs = Date.now();
          writeJson("bumps.json", bumpStore);
          scheduleBumpTimer(gId);
          console.log(`[Auto-Bump] Disboard bump detected for guild ${gId}`);
        }
      }
    }
  } catch (err) {
    console.log("Auto-bump error:", err);
  }

  // 2) Anti-promo
  try {
    if (!msg.author.bot) {
      const member = msg.member;

      const isStaff = member?.roles?.cache?.some(r => STAFF_ROLE_IDS.includes(r.id));
      if (!isStaff) {
        const embedText = msg.embeds
          ?.map(e => `${e.title || ""} ${e.description || ""}`)
          .join(" ");

        const combined = `${msg.content || ""} ${embedText || ""}`;

        const matched = PROMO_PATTERNS.some(r => r.test(combined));

        if (matched) {
          console.log(`[ANTI-PROMO] Deleted ad message from ${msg.author.tag}`);
          await msg.delete().catch(err => console.log("Delete failed:", err.message));
        }
      }
    }
  } catch (err) {
    console.log("Anti-promo error:", err);
  }

  // 3) Status guard
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
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const cmdBump = new SlashCommandBuilder()
  .setName("bump")
  .setDescription("Record that you bumped just now.");

const cmdBumpStatus = new SlashCommandBuilder()
  .setName("bumpstatus")
  .setDescription("Show time until next reminder.");

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

// Closeticket
const cmdCloseTicket = new SlashCommandBuilder()
  .setName("closeticket")
  .setDescription("Open close panel: Save & Close (with transcript) or Delete Only.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

// Claim
const cmdClaim = new SlashCommandBuilder()
  .setName("claim")
  .setDescription("Claim this ticket and rename it.")
  .addUserOption(o =>
    o.setName("user").setDescription("User to attach this ticket to").setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

// Help
const cmdHelp = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show bot commands.");

const COMMANDS = [
  cmdScanPromos,
  cmdSetPay,
  cmdDelPay,
  cmdPay,
  cmdShowPay,
  cmdBumpConfig,
  cmdBump,
  cmdBumpStatus,
  cmdVouch,
  cmdVouchCount,
  cmdAnnounce,
  cmdSayEmbed,
  cmdInvoice,
  cmdUEInspect,
  cmdCloseTicket,
  cmdClaim,
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

// info = { name: "John", methods: { "Chime": "chime$john", "Stripe": "https://stripe.link/..." } }

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
// VOUCH → CUSTOMER TIER ROLES
// ============================================

// Tier thresholds (you said previous lower values felt better)
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

// Apply roles based on vouch count; never downgrade VILTRUMITE
async function applyCustomerRoles(guild, member, count) {
  if (!guild || !member) return;

  // If they already have highest role, don't touch
  if (member.roles.cache.has(VILTRUMITE_ROLE_ID)) return;

  const tier = tierForCount(count);
  if (!tier) return;

  const role = guild.roles.cache.get(tier.roleId);
  if (!role) return;

  await member.roles.add(role).catch(() => {});

  // Optional: do NOT remove lower tiers to avoid surprises
  // If you ever want strict ladder, we can remove lower roles here.
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

// Main transcript generator
async function generateAndSendTranscript(interaction, mode) {
  const channel = interaction.channel;
  const guild = interaction.guild;

  if (!channel || !guild) return;

  const messages = await fetchAllMessages(channel, 1000);
  const openerId = await findOpener(channel, messages);

  const opener = openerId ? await guild.members.fetch(openerId).catch(() => null) : null;
  const closer = await guild.members.fetch(interaction.user.id).catch(() => null);

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

  // Log to transcript channel
  const logCh = client.channels.cache.get(TRANSCRIPT_LOG_ID) || channel;

  const logEmbed = new EmbedBuilder()
    .setColor(0x34d399)
    .setTitle("📦 Ticket Closed (Logged)")
    .setDescription(
      `Transcript generated.\n\n[Open transcript in browser](${hostedUrl})`
    )
    .addFields(
      { name: "Channel", value: `#${channel.name}`, inline: true },
      { name: "Closed By", value: `${interaction.user}`, inline: true },
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

  await logCh.send({
    embeds: [logEmbed],
    components: [logRow],
    files: [attachment]
  });

  // DM to opener
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
    } catch (err) {
      console.log("DM failed:", err.message);
    }
  }

  // Confirm inside ticket
  const finalEmbed = new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle("✅ Ticket Closed")
    .setDescription("Transcript saved, logged, and DM sent (if possible).")
    .addFields(
      { name: "Ticket ID", value: ticketId },
      { name: "Messages", value: String(messages.length) }
    )
    .setTimestamp();

  await interaction.followUp({
    embeds: [finalEmbed],
    components: [logRow],
    ephemeral: false
  });

  if (mode === "delete") {
    setTimeout(() => channel.delete().catch(() => {}), 2500);
  }
}

// ============================================
// INTERACTION HANDLER
// ============================================

client.on("interactionCreate", async interaction => {
  try {
    // ========== BUTTONS ==========
    if (interaction.isButton()) {
      const id = interaction.customId;

      // Payment copy buttons
      if (id.startsWith("pay:copy:")) {
        const encoded = id.split(":")[2];
        const methodName = decodeURIComponent(encoded);

        const embed = interaction.message.embeds?.[0];
        const fields = embed?.data?.fields || embed?.fields || [];
        const field = fields.find(f => f.name === methodName);

        const value = field?.value?.trim();
        if (!value) {
          return interaction.reply({ content: "Not found.", ephemeral: true });
        }

        return interaction.reply({ content: value, ephemeral: true });
      }

      // Close ticket → Save & Close
      if (id === "ticket:save_close") {
        await interaction.deferReply({ ephemeral: true });
        await generateAndSendTranscript(interaction, "delete");
        return;
      }

      // Close ticket → Delete Only
      if (id === "ticket:delete_only") {
        await interaction.deferReply({ ephemeral: true });
        await interaction.followUp({ content: "Deleting this ticket...", ephemeral: true });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 1800);
        return;
      }

      return;
    }

    // ========== SLASH COMMANDS ==========
    if (!interaction.isChatInputCommand()) return;
    const cmd = interaction.commandName;

    // HELP
    if (cmd === "help") {
      const e = new EmbedBuilder()
        .setColor(0x2dd4bf)
        .setTitle("INVINCIBLE EATS — Commands")
        .setDescription([
          "**Tickets:** /claim /closeticket",
          "**Payments:** /setpay /delpay /pay /showpay",
          "**Orders:** /ueinspect",
          "**Vouching:** /vouch /vouchcount",
          "**Moderation:** /scanpromos",
          "**Bump:** /bump_config /bump /bumpstatus",
          "**Utility:** /announce /sayembed /invoice",
          "**General:** /help"
        ].join("\n"));

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
            ?.map(e => `${e.title || ""} ${e.description || ""}`)
            .join(" ");
          const combined = `${m.content || ""} ${embedText || ""}`;
          if (PROMO_PATTERNS.some(r => r.test(combined))) {
            await m.delete().catch(() => {});
            removed++;
          }
        }
      }

      return interaction.editReply(`Removed **${removed}** promotional messages.`);
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

      bumpStore[interaction.guildId] = {
        intervalMin: interval,
        channelId: interaction.channelId,
        lastBumpTs: Date.now()
      };

      writeJson("bumps.json", bumpStore);
      scheduleBumpTimer(interaction.guildId);

      return interaction.reply({
        content: `Bump reminders enabled every **${interval} minutes**.`,
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

      const next = cfg.lastBumpTs + cfg.intervalMin * 60000;
      const minsLeft = Math.ceil((next - Date.now()) / 60000);

      return interaction.reply({
        content: `Next reminder in **${minsLeft} minutes**.`,
        ephemeral: true
      });
    }

    // VOUCH
    if (cmd === "vouch") {
      const staff = interaction.options.getUser("staff", true);
      const messageText = interaction.options.getString("message", true);
      const image = interaction.options.getAttachment("image");
      const target = interaction.options.getChannel("channel") || interaction.channel;

      const e = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("✅ New Vouch")
        .setDescription(messageText)
        .addFields(
          { name: "Customer", value: `${interaction.user}`, inline: true },
          { name: "Served By", value: `${staff}`, inline: true }
        )
        .setTimestamp();

      if (image) e.setImage(image.url);

      await target.send({ embeds: [e] });

      // Update counts
      vouchByStaff[staff.id] = (vouchByStaff[staff.id] || 0) + 1;
      vouchByCust[interaction.user.id] = (vouchByCust[interaction.user.id] || 0) + 1;

      writeJson("vouches_by_staff.json", vouchByStaff);
      writeJson("vouches_by_customer.json", vouchByCust);

      // Apply customer tier roles (no downgrade of VILTRUMITE)
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (member) {
        await applyCustomerRoles(interaction.guild, member, vouchByCust[interaction.user.id]);
      }

      return interaction.reply({ content: "Vouch recorded — thank you!", ephemeral: true });
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

      return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    // CLAIM
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

      const targetUser = interaction.options.getUser("user", true);
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
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Something went wrong.", ephemeral: true });
    }
  }
});

// ============================================
// EXPRESS HOSTING
// ============================================

app.use("/transcripts", express.static(TRANSCRIPT_DIR));
app.use("/attachments", express.static(ATTACH_DIR));

app.get("/", (req, res) => {
  res.send("INVINCIBLE EATS — Transcript Host Active");
});

app.listen(PORT, () => console.log(`🌐 Transcript host running on port ${PORT}`));

// ============================================
// READY + LOGIN
// ============================================

client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  // Start bump timers
  for (const guildId of Object.keys(bumpStore)) {
    scheduleBumpTimer(guildId);
  }

  // Start watchdog
  startStatusWatchdog(client);

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