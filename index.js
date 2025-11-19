// index.js — INVINCIBLE EATS bot (CommonJS, discord.js v14)
// Tickets + transcripts + payments + auto-bump + anti-promo
//
// Required ENV: DISCORD_TOKEN, CLIENT_ID
// Optional ENV: TRANSCRIPT_LOG_ID, UBER_TICKETS_CHANNEL
require('dotenv').config();

// ============ Dependencies ============
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const express = require('express');
const {
  Client, GatewayIntentBits, Partials,
  REST, Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');

// ============ Web server (keep-alive + serve assets) ============
const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');
const ATTACH_DIR = path.join(PUBLIC_DIR, 'attachments');
const TRANSCRIPT_DIR = path.join(PUBLIC_DIR, 'transcripts');
fs.mkdirSync(ATTACH_DIR, { recursive: true });
fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });

app.use('/attachments', express.static(ATTACH_DIR, { maxAge: '30d', immutable: true }));
app.use('/transcripts', express.static(TRANSCRIPT_DIR, { maxAge: '30d', immutable: false }));
app.get('/', (_, res) => res.send('INVINCIBLE EATS bot is running.'));
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('🌐 Web server on', PORT));

// Helper to detect hosting domain for links
function externalBase() {
  const replit = process.env.REPLIT_DEV_DOMAIN;
  if (replit) return `https://${replit}`;
  const render = process.env.RENDER_EXTERNAL_URL;
  if (render) return render.replace(/\/$/, '');
  return `http://localhost:${PORT}`;
}

// ============ Client ============
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User],
});

// ============ Persistence helpers ============
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch { return d; } };
const writeJson = (f, o) => fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(o, null, 2));

// ============ Stores ============
const bumpStore    = readJson('bumps.json', {});
const vouchByStaff = readJson('vouches_by_staff.json', {});
const vouchByCust  = readJson('vouches_by_customer.json', {});
const payStore     = readJson('pay.json', {});

// ============ Config ============
// Order transcripts log channel (where transcripts are logged)
const TRANSCRIPT_LOG_FALLBACK_ID = '1386924127041880081'; // Order transcripts log
const TRANSCRIPT_LOG_ID =
  process.env.TRANSCRIPT_LOG_ID ||
  process.env.TRANSCRIPT_LOG_CHANNEL ||
  TRANSCRIPT_LOG_FALLBACK_ID ||
  '';

const UBER_TICKETS_CHANNEL = process.env.UBER_TICKETS_CHANNEL || '1386924125834051744';

// Vouch roles
const ROLE_THRESH = [
  { min: 10, roleId: '1394179600187261058', label: 'VILTRUMITE' },
  { min: 5,  roleId: '1396955746108833842', label: 'Frequent Buyer' },
  { min: 2,  roleId: '1396954121780854874', label: 'Verified Buyer' },
  { min: 1,  roleId: '1386924124860846131', label: 'HERO IN TRAINING' },
];
const roleIdsSet = new Set(ROLE_THRESH.map(r => r.roleId));

// === restaurant status guard config ===
const STATUS_CHANNEL_ID = '1386956979632734238';           // status channel
const JUSTICE_CHEF_ROLE_ID = '1386924124873556030';         // "Justice Chef on patrol"
const STATUS_ANNOUNCE_CHANNEL_ID = '1386924126844879008';   // announcements go here

// Disboard bot ID for auto bump
const DISBOARD_BOT_ID = '302050872383242240';

// ============ Utils ============
const fmtMoney = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const isUrl = (s = '') => /^https?:\/\//i.test(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function tierForCount(count) { for (const t of ROLE_THRESH) if (count >= t.min) return t; return null; }
async function applyCustomerRoles(guild, member, count) {
  const tier = tierForCount(count); if (!tier) return;
  const remove = member.roles.cache.filter(r => roleIdsSet.has(r.id) && r.id !== tier.roleId);
  if (remove.size) await member.roles.remove(remove).catch(() => { });
  await member.roles.add(tier.roleId).catch(() => { });
}

// ============ Anti-promo patterns ============
const PROMO_PATTERNS = [
  // Original patterns
  /amazon\s+review/i,
  /paypal\s+refund/i,
  /review\s+partners?/i,
  /\b(buy\s+now|discount|coupon)\b/i,
  /⭐\s*5[-\s]*star/i,

  // Generic promo / selling / spam keywords
  /\bpromo\b/i,
  /\bpromotion\b/i,
  /\bself\s*promo\b/i,
  /\bcheap\s+\w+/i,
  /\bselling\s+\w+/i,
  /\bsell\s+accounts?\b/i,
  /\bboost\s+service\b/i,
  /\bverification\s*service\b/i,
  /\buse\s+code\s+\w+/i,
  /\b5\s*star\s+reviews?\b/i,

  // Common spammy links
  /discord\.gg\//i,
  /discord\.com\/invite\//i,
  /t\.me\//i,
  /wa\.me\//i,
  /paypal\.me\//i,
  /cash\.app\//i,
];

// ============ Status guard helper ============
async function enforceStatusGuard(message) {
  try {
    if (!message.guild) return;
    if (message.channel.id !== STATUS_CHANNEL_ID) return;

    // Get content / embed text and check if it's "open"
    const rawContent = (message.content || '').toLowerCase();
    const embedText = (message.embeds?.[0]?.description || message.embeds?.[0]?.title || '').toLowerCase();
    const text = rawContent + ' ' + embedText;

    if (!text.includes('open')) return; // nothing to do

    // Fetch members and see if anyone has the Justice Chef role
    const members = await message.guild.members.fetch();
    const hasChefs = members.some(m => m.roles.cache.has(JUSTICE_CHEF_ROLE_ID));

    if (hasChefs) return; // at least one chef on patrol, allow open

    // No chefs with the role -> revert status back to closed
    let newContent = message.content || '';
    if (!newContent) {
      newContent = 'Status: CLOSED (no Justice Chef on patrol)';
    } else {
      newContent = newContent.replace(/open/gi, 'CLOSED (no Justice Chef on patrol)');
    }

    await message.edit(newContent).catch(() => { });

    // Post announcement in configured channel
    try {
      const annCh = await client.channels.fetch(STATUS_ANNOUNCE_CHANNEL_ID);
      if (annCh) {
        const e = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle('Restaurant status reverted to CLOSED')
          .setDescription([
            'The restaurant status was set to **open**, but no one currently has the **Justice Chef on patrol** role.',
            '',
            'Status has been automatically set back to **closed** until a Justice Chef is on patrol.',
          ].join('\n'))
          .setTimestamp();
        await annCh.send({ embeds: [e] });
      }
    } catch (e) {
      console.log('Status announcement failed:', e.message);
    }
  } catch (e) {
    console.log('Status guard error:', e.message);
  }
}

// ============ Message handlers ============

// messageCreate: anti-promo + status guard + auto bump
client.on('messageCreate', async (msg) => {
  if (!msg.guild) return;

  // ===== Auto-detect Disboard bump and reset timer =====
  try {
    if (msg.author.id === DISBOARD_BOT_ID && msg.embeds?.length) {
      const emb = msg.embeds[0];
      const text = `${emb.title || ''} ${emb.description || ''}`.toLowerCase();
      if (text.includes('bump done')) {
        const gId = msg.guild.id;
        if (bumpStore[gId]) {
          bumpStore[gId].lastBumpTs = Date.now();
          writeJson('bumps.json', bumpStore);
          scheduleBumpTimer(gId);
          console.log(`Auto-bump: detected Disboard bump in guild ${gId}, timer reset.`);
        }
      }
    }
  } catch (e) {
    console.log('Auto-bump detect error:', e.message);
  }

  // ===== Anti-promo (skip Justice Chef role) =====
  try {
    // Ignore bot messages for promo
    if (!msg.author.bot) {
      const member = msg.member;
      const isJusticeChef = member?.roles?.cache?.has(JUSTICE_CHEF_ROLE_ID);

      // Staff with Justice Chef can post promo
      if (!isJusticeChef) {
        const contentToCheck = [
          msg.content || '',
          msg.embeds?.[0]?.title || '',
          msg.embeds?.[0]?.description || '',
        ].join(' ');

        const matched = PROMO_PATTERNS.find((r) => r.test(contentToCheck));
        if (matched) {
          console.log(
            `[ANTI-PROMO] Removing promo from ${msg.author.tag} in #${msg.channel.name} | matched: ${matched}`
          );
          await msg.delete().catch((err) => {
            console.log('Failed to delete promo message:', err.message);
          });
        }
      }
    }
  } catch (e) {
    console.log('Anti-promo error:', e.message);
  }

  // Status guard (runs even if message is from a bot/webhook)
  await enforceStatusGuard(msg);
});

// Also watch edits in the status channel (if someone edits "closed" -> "open")
client.on('messageUpdate', async (_, newMsg) => {
  try {
    const msg = newMsg.partial ? await newMsg.fetch() : newMsg;
    if (!msg.guild) return;
    await enforceStatusGuard(msg);
  } catch (e) {
    console.log('messageUpdate guard error:', e.message);
  }
});

// bulk promo scan
async function bulkScanPromos(channel, max = 1000) {
  let removed = 0, lastId = undefined, remaining = Math.min(max, 1000);
  while (remaining > 0) {
    const batch = await channel.messages.fetch({ limit: Math.min(100, remaining), before: lastId }).catch(() => null);
    if (!batch || batch.size === 0) break;
    for (const [, m] of batch) {
      if (m.author.bot) continue;
      const contentToCheck = [
        m.content || '',
        m.embeds?.[0]?.title || '',
        m.embeds?.[0]?.description || '',
      ].join(' ');
      if (PROMO_PATTERNS.some(r => r.test(contentToCheck))) {
        try { await m.delete(); removed++; } catch { }
      }
    }
    lastId = batch.last().id; remaining -= batch.size; await sleep(350);
  }
  return removed;
}

// ============ Commands ============
const PAYMENT_FIELDS = [
  ['Display name', 'name', true],
  ['Cash App (tag or link)', 'cashapp'],
  ['Chime (tag)', 'chime'],
  ['Zelle (email/phone)', 'zelle'],
  ['PayPal (link or email)', 'paypal'],
  ['Venmo (link or @)', 'venmo'],
  ['Apple Pay (phone/email)', 'applepay'],
  ['Stripe (payment link)', 'stripe'],
  ['Crypto (address/link)', 'crypto'],
  ['Other (instructions)', 'other'],
];

const cmdScanPromos = new SlashCommandBuilder()
  .setName('scanpromos').setDescription('Delete recent promotional messages here (up to 1000).')
  .addIntegerOption(o => o.setName('limit').setDescription('Messages to scan (max 1000)').setMinValue(10).setMaxValue(1000))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

const cmdSetPay = new SlashCommandBuilder()
  .setName('setpay').setDescription('Set payment methods for a staff member.')
  .addUserOption(o => o.setName('staff').setDescription('Staff user').setRequired(true));
for (const [label, key, req] of PAYMENT_FIELDS) {
  const add = (opt) => opt.setName(key).setDescription(label).setRequired(!!req);
  if (key === 'name') cmdSetPay.addStringOption(add);
  else cmdSetPay.addStringOption(add);
}

const cmdDelPay = new SlashCommandBuilder()
  .setName('delpay')
  .setDescription('Delete stored payment methods for a staff member.')
  .addUserOption(o =>
    o.setName('staff')
      .setDescription('Staff user whose pay info you want to clear')
      .setRequired(true)
  );

const cmdPay = new SlashCommandBuilder()
  .setName('pay').setDescription('Show payment options for a staff member.')
  .addUserOption(o => o.setName('staff').setDescription('Who to pay').setRequired(true))
  .addNumberOption(o => o.setName('amount').setDescription('Amount in USD').setRequired(true))
  .addStringOption(o => o.setName('note').setDescription('Optional note'));

const cmdBumpConfig = new SlashCommandBuilder()
  .setName('bump_config').setDescription('Enable Disboard bump reminder in this channel.')
  .addIntegerOption(o => o.setName('interval').setDescription('Minutes (60–180, default 120)').setMinValue(60).setMaxValue(180))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const cmdBump = new SlashCommandBuilder().setName('bump').setDescription('Record that you bumped just now.');
const cmdBumpStatus = new SlashCommandBuilder().setName('bumpstatus').setDescription('Show time until next reminder.');

const cmdVouch = new SlashCommandBuilder()
  .setName('vouch').setDescription('Submit a vouch for who fulfilled your order.')
  .addUserOption(o => o.setName('staff').setDescription('Who helped you').setRequired(true))
  .addStringOption(o => o.setName('message').setDescription('What went well?').setRequired(true))
  .addAttachmentOption(o => o.setName('image').setDescription('Optional image'))
  .addChannelOption(o => o.setName('channel').setDescription('Post to (default here)'));

const cmdVouchCount = new SlashCommandBuilder()
  .setName('vouchcount').setDescription('Show vouch count and loyalty tier for a user.')
  .addUserOption(o => o.setName('user').setDescription('User (default you)'));

const cmdAnnounce = new SlashCommandBuilder()
  .setName('announce').setDescription('Post an announcement embed.')
  .addStringOption(o => o.setName('title').setDescription('Title').setRequired(true))
  .addStringOption(o => o.setName('body').setDescription('Body').setRequired(true))
  .addChannelOption(o => o.setName('channel').setDescription('Target channel (default: here)'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const cmdSayEmbed = new SlashCommandBuilder()
  .setName('sayembed').setDescription('Send a styled embed.')
  .addStringOption(o => o.setName('text').setDescription('Text').setRequired(true));

const cmdInvoice = new SlashCommandBuilder()
  .setName('invoice').setDescription('Create a quick invoice/receipt embed.')
  .addUserOption(o => o.setName('customer').setDescription('Customer').setRequired(true))
  .addNumberOption(o => o.setName('amount').setDescription('Total amount').setRequired(true))
  .addStringOption(o => o.setName('items').setDescription('Items/notes').setRequired(true));

const cmdUEInspect = new SlashCommandBuilder()
  .setName('ueinspect').setDescription('Forward an Uber Eats group link to the tickets channel.')
  .addStringOption(o => o.setName('url').setDescription('Uber Eats group link').setRequired(true));

const cmdCloseTicket = new SlashCommandBuilder()
  .setName('closeticket').setDescription('Open close panel: Save & Close (with transcript) or Delete Only.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

const cmdHelp = new SlashCommandBuilder()
  .setName('help').setDescription('Show bot commands.');

const COMMANDS = [
  cmdScanPromos, cmdSetPay, cmdDelPay, cmdPay,
  cmdBumpConfig, cmdBump, cmdBumpStatus,
  cmdVouch, cmdVouchCount,
  cmdAnnounce, cmdSayEmbed, cmdInvoice,
  cmdUEInspect, cmdCloseTicket, cmdHelp,
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: COMMANDS });
  console.log('✅ Commands registered.');
}

// ============ PAY helpers ============
const isHttp = (s) => /^https?:\/\//i.test(s);
function buildPayEmbed(invoker, staffUser, info, amount, note) {
  const pairs = [
    ['Cash App', 'cashapp'], ['Chime', 'chime'], ['Zelle', 'zelle'], ['PayPal', 'paypal'],
    ['Venmo', 'venmo'], ['Apple Pay', 'applepay'], ['Stripe', 'stripe'], ['Crypto', 'crypto'], ['Other', 'other'],
  ];
  const lines = [];
  for (const [label, key] of pairs) if (info[key]) lines.push(`**${label}:** ${info[key]}`);
  if (!lines.length) lines.push('_No payment fields set. Ask the staff to run **/setpay**._');

  const e = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(`💸 Pay ${info.name || staffUser.tag}`)
    .setThumbnail(staffUser.displayAvatarURL({ extension: 'png', size: 128 }))
    .setDescription([`**Amount:** ${fmtMoney(amount)}`, ...lines, '', 'Use the buttons to copy values or open links.'].join('\n'))
    .setFooter({ text: `Requested by ${invoker.tag}` })
    .setTimestamp();
  if (note) e.addFields({ name: 'Note', value: note, inline: false });
  return e;
}
function buildPayButtons(info) {
  const copyRow = new ActionRowBuilder();
  const linkRow = new ActionRowBuilder();
  const addCopy = (k, l) => info[k] && copyRow.addComponents(
    new ButtonBuilder().setCustomId(`copy:${k}`).setLabel(`Copy ${l}`).setStyle(ButtonStyle.Secondary)
  );
  const addLink = (k, l) => info[k] && isHttp(info[k]) && linkRow.addComponents(
    new ButtonBuilder().setLabel(`Open ${l}`).setStyle(ButtonStyle.Link).setURL(info[k])
  );
  const pairs = [
    ['cashapp', 'Cash App'], ['chime', 'Chime'], ['zelle', 'Zelle'], ['paypal', 'PayPal'],
    ['venmo', 'Venmo'], ['applepay', 'Apple Pay'], ['stripe', 'Stripe'], ['crypto', 'Crypto'], ['other', 'Other']
  ];
  for (const [k, l] of pairs) { addCopy(k, l); addLink(k, l); }
  const rows = []; if (copyRow.components.length) rows.push(copyRow); if (linkRow.components.length) rows.push(linkRow); return rows;
}

// Map payment keys -> labels used in the embed description
const PAY_LABEL_MAP = {
  cashapp: 'Cash App',
  chime: 'Chime',
  zelle: 'Zelle',
  paypal: 'PayPal',
  venmo: 'Venmo',
  applepay: 'Apple Pay',
  stripe: 'Stripe',
  crypto: 'Crypto',
  other: 'Other',
};

// ============ Bump reminder ============
function scheduleBumpTimer(guildId) {
  const entry = bumpStore[guildId];
  if (!entry || !entry.channelId) return;
  global._bumpTimers = global._bumpTimers || {};
  if (global._bumpTimers[guildId]) clearTimeout(global._bumpTimers[guildId]);
  const intervalMs = (entry.intervalMin || 120) * 60 * 1000;
  const last = entry.lastBumpTs || Date.now();
  const dueIn = Math.max(0, (last + intervalMs) - Date.now());
  global._bumpTimers[guildId] = setTimeout(async () => {
    try {
      const ch = await client.channels.fetch(entry.channelId);
      if (ch) {
        const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('Disboard bump helper')
          .setDescription('Run **/bump** in this channel every ~2 hours to keep the server visible on Disboard.\n\n_No pings were used._');
        await ch.send({ embeds: [embed] });
      }
    } catch { }
    entry.lastBumpTs = Date.now(); writeJson('bumps.json', bumpStore); scheduleBumpTimer(guildId);
  }, dueIn);
}

// ============ UE Inspect (forward link) ============
const UE_REGEX = /\bhttps?:\/\/(?:www\.)?eats\.uber\.com\/[\w\-\/\?=&#.%]+/i;
async function forwardUE(link, fromUser) {
  try {
    const ch = await client.channels.fetch(UBER_TICKETS_CHANNEL);
    if (!ch) return false;
    const e = new EmbedBuilder().setColor(0x0f172a).setTitle('Uber Eats group link received')
      .setDescription(`[Open the group link](${link})\n\n_Use your agent workflow to review/fulfill._`)
      .setFooter({ text: `Submitted by ${fromUser.tag}` }).setTimestamp();
    await ch.send({ embeds: [e] }); return true;
  } catch { return false; }
}

// ============ Transcript (mirror images locally + hosted URL + file upload) ============
function escapeHTML(s = '') { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function isImageName(name = '') { return /\.(png|jpe?g|gif|webp|bmp)$/i.test(name); }
async function downloadTo(filePath, url) {
  const res = await axios({ method: 'GET', url, responseType: 'stream' });
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(filePath); res.data.pipe(w);
    w.on('finish', resolve); w.on('error', reject);
  });
}
function localAttachPath(name) { return path.join(ATTACH_DIR, name); }
function localAttachUrl(name) { return `${externalBase()}/attachments/${encodeURIComponent(name)}`; }

function renderEmbedBlock(embed) {
  const e = embed.data || embed;
  const title = e.title ? `<div class="e-title">${escapeHTML(e.title)}</div>` : '';
  const desc = e.description ? `<div class="e-desc">${escapeHTML(e.description)}</div>` : '';
  const author = e.author?.name ? `<div class="e-author">by ${escapeHTML(e.author.name)}</div>` : '';
  const fields = (e.fields || []).map(f => `<div class="e-field"><div class="e-name">${escapeHTML(f.name || '')}</div><div class="e-value">${escapeHTML(f.value || '')}</div></div>`).join('');
  const thumb = e.thumbnail?.url ? `<img class="e-thumb" src="${e.thumbnail.url}">` : '';
  const image = e.image?.url ? `<img class="e-image" src="${e.image.url}">` : '';
  return `<div class="embed">${title}${author}${desc}${fields}${thumb}${image}</div>`;
}
function replaceMentionsWithNames(text, msg) {
  if (!text) return '';
  let out = text;
  const users = msg.mentions?.users;
  if (users && users.size) for (const [, u] of users) out = out.replace(new RegExp(`<@!?${u.id}>`, 'g'), `@${u.username}`);
  const chans = msg.mentions?.channels;
  if (chans && chans.size) for (const [, c] of chans) out = out.replace(new RegExp(`<#${c.id}>`, 'g'), `#${c.name}`);
  return out;
}
function safeAvatarUrl(user) {
  try { return user?.displayAvatarURL?.({ extension: 'png', size: 64 }) || user?.displayAvatarURL?.() || ''; } catch { return ''; }
}

async function generateTranscriptHTML({ guild, channel, opener, closer, messages, ticketId }) {
  const avatarCache = new Map(); // userId -> local URL
  async function getLocalAvatar(u) {
    if (!u) return 'https://cdn.discordapp.com/embed/avatars/0.png';
    const key = u.id || u.user?.id || u.tag || Math.random().toString(36).slice(2);
    if (avatarCache.has(key)) return avatarCache.get(key);
    const url = safeAvatarUrl(u.user || u) || 'https://cdn.discordapp.com/embed/avatars/0.png';
    try {
      const name = `avatar-${key}.png`;
      const dest = localAttachPath(name);
      if (!fs.existsSync(dest)) await downloadTo(dest, url);
      const out = localAttachUrl(name);
      avatarCache.set(key, out);
      return out;
    } catch {
      return url;
    }
  }

  const blocks = [];
  for (const m of messages) {
    const avatar = await getLocalAvatar(m.member || m.author);
    const name = m.member?.nickname || m.author?.globalName || m.author?.username || m.author?.tag || 'Unknown';
    const time = new Date(m.createdTimestamp || m.createdAt || Date.now()).toLocaleString();
    const contentRaw = m.content || '';
    const content = contentRaw ? `<div class="msg-text">${escapeHTML(replaceMentionsWithNames(contentRaw, m))}</div>` : '';
    const embeds = (m.embeds || []).map(e => renderEmbedBlock(e)).join('');
    const atts = [];
    if (m.attachments?.size) {
      for (const a of m.attachments.values()) {
        try {
          if ((a.contentType && a.contentType.startsWith('image/')) || isImageName(a.name || '')) {
            const fname = `att-${m.id}-${a.name || 'image'}`.replace(/[^a-z0-9._-]/ig, '_');
            const dest = localAttachPath(fname);
            if (!fs.existsSync(dest)) await downloadTo(dest, a.url);
            atts.push(`<img class="att-img" src="${localAttachUrl(fname)}" alt="${escapeHTML(a.name || 'image')}">`);
          } else {
            atts.push(`<a class="att-file" href="${a.url}" target="_blank" rel="noreferrer">${escapeHTML(a.name || 'file')}</a>`);
          }
        } catch {
          atts.push(`<a class="att-file" href="${a.url}" target="_blank" rel="noreferrer">${escapeHTML(a.name || 'file')}</a>`);
        }
      }
    }
    blocks.push(`<div class="msg">
      <img class="avatar" src="${avatar}">
      <div class="body">
        <div class="head"><span class="name">${escapeHTML(name)}</span><span class="time">${escapeHTML(time)}</span></div>
        ${content}${embeds}${atts.join('')}
      </div>
    </div>`);
  }

  const openedBy = opener ? `@${escapeHTML(opener.displayName || opener.user?.username || opener.tag || opener.id)}` : 'Unknown';
  const closedBy = closer ? `@${escapeHTML(closer.displayName || closer.user?.username || closer.tag || closer.id)}` : 'Unknown';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Transcript ${escapeHTML(channel.name || 'ticket')}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{color-scheme:dark light}
  body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0b0f14;color:#e5e7eb;margin:0;padding:24px}
  .card{background:#0f1620;border:1px solid #1f2937;border-radius:12px;max-width:960px;margin:0 auto;padding:20px}
  h1{margin:0 0 8px;font-size:24px}
  .meta{opacity:.8;margin-bottom:16px}
  .badge{display:inline-block;background:#111827;border:1px solid #374151;border-radius:8px;padding:6px 10px;margin:4px 8px 4px 0}
  .msg{display:flex;gap:12px;padding:12px;border-bottom:1px solid #1f2937}
  .msg:last-child{border-bottom:none}
  .avatar{width:40px;height:40px;border-radius:999px}
  .body{flex:1}
  .head{font-size:14px;margin-bottom:4px}
  .name{font-weight:600;margin-right:8px}
  .time{opacity:.7}
  .msg-text{white-space:pre-wrap;line-height:1.4}
  .embed{border-left:3px solid #3b82f6;background:#0c1320;padding:10px 12px;margin:8px 0;border-radius:6px}
  .e-title{font-weight:700;margin-bottom:6px}
  .e-author{opacity:.8;margin-bottom:6px}
  .e-field{margin:6px 0}
  .e-name{font-weight:600;margin-bottom:2px}
  .e-thumb{max-height:64px;margin-top:6px}
  .e-image{max-width:100%;margin-top:8px;border-radius:6px}
  .att-img{max-width:100%;border-radius:6px;margin-top:8px}
  .att-file{display:inline-block;margin-top:8px}
  footer{opacity:.6;font-size:12px;margin-top:14px}
</style>
</head>
<body>
  <div class="card">
    <h1>Ticket Transcript</h1>
    <div class="meta">
      <span class="badge"><b>Guild:</b> ${escapeHTML(guild?.name || '')}</span>
      <span class="badge"><b>Channel:</b> ${escapeHTML(channel?.name || '')}</span>
      <span class="badge"><b>Ticket ID:</b> ${escapeHTML(ticketId || '')}</span>
      <span class="badge"><b>Opened by:</b> ${escapeHTML(openedBy)}</span>
      <span class="badge"><b>Closed by:</b> ${escapeHTML(closedBy)}</span>
      <span class="badge"><b>Generated:</b> ${escapeHTML(new Date().toLocaleString())}</span>
    </div>
    ${blocks.join('') || '<i>No messages.</i>'}
    <footer>Generated by INVINCIBLE EATS</footer>
  </div>
</body>
</html>`;
}

function findOpenerFromTopicOrMessages(channel, messages) {
  const topic = channel.topic || '';
  const m = topic.match(/User ID:\s*(\d{5,})/i);
  if (m) return m[1];
  for (const msg of messages.slice(0, 15)) {
    for (const e of msg.embeds || []) {
      const fields = (e.data?.fields || e.fields || []);
      const f = fields.find(x => /user/i.test(x.name || ''));
      const id = f?.value?.match?.(/<@!?(\d{5,})>/)?.[1];
      if (id) return id;
    }
  }
  for (const msg of messages) {
    const mention = msg.content?.match(/<@!?(\d{5,})>/);
    if (mention) return mention[1];
  }
  const firstHuman = messages.find(m => !m.author?.bot);
  if (firstHuman) return firstHuman.author.id;
  return null;
}

async function fetchAllMessages(channel, limit = 1000) {
  let all = [], lastId = undefined;
  while (all.length < limit) {
    const batch = await channel.messages.fetch({ limit: Math.min(100, limit - all.length), before: lastId }).catch(() => null);
    if (!batch || batch.size === 0) break;
    all = all.concat([...batch.values()]);
    lastId = batch.last().id;
  }
  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function generateAndSendTranscript(interaction, mode) {
  const channel = interaction.channel;
  if (!channel) {
    console.log('Transcript error: interaction has no channel');
    return;
  }

  const messages = await fetchAllMessages(channel, 1000);
  const openerId = findOpenerFromTopicOrMessages(channel, messages);
  const openerMember = openerId ? await channel.guild.members.fetch(openerId).catch(() => null) : null;
  const closerMember = await channel.guild.members.fetch(interaction.user.id).catch(() => null);

  const ticketId = `${Date.now()}`;
  const html = await generateTranscriptHTML({
    guild: interaction.guild,
    channel,
    opener: openerMember,
    closer: closerMember,
    messages,
    ticketId,
  });

  // -------- write HTML to public transcripts dir for hosted URL --------
  const fname = `ticket-${channel.id}-${ticketId}.html`;
  const fpath = path.join(TRANSCRIPT_DIR, fname);
  fs.writeFileSync(fpath, html, 'utf8');
  const hostedUrl = `${externalBase()}/transcripts/${encodeURIComponent(fname)}`;

  // -------- also write a temp copy for attaching to Discord messages --------
  const tempPath = path.join(os.tmpdir(), fname);
  fs.writeFileSync(tempPath, html, 'utf8');

  const attachment = new AttachmentBuilder(tempPath, { name: fname });

  // ---------- pick target log channel (log channel -> fallback to ticket channel) ----------
  let targetCh = channel;
  const logId = TRANSCRIPT_LOG_ID;

  if (logId) {
    try {
      console.log('Transcript: trying log channel ID:', logId);
      const fetched = await client.channels.fetch(logId);
      if (fetched) {
        console.log('Transcript: SUCCESS → using log channel:', fetched.id, fetched.name);
        targetCh = fetched;
      } else {
        console.log(`Transcript log: channel ID ${logId} not found, using ticket channel instead.`);
      }
    } catch (e) {
      console.log(`Transcript log: failed to fetch channel ${logId}, using ticket channel instead.`, e.message);
    }
  } else {
    console.log('Transcript log: TRANSCRIPT_LOG_ID is empty, using ticket channel instead.');
  }

  // ---------- shared fields + button ----------
  const baseFields = [
    { name: 'Channel', value: `#${channel.name}`, inline: true },
    { name: 'Closed By', value: `${interaction.user}`, inline: true },
    { name: 'Opened By', value: openerMember ? `${openerMember}` : 'Unknown', inline: true },
    { name: 'Messages', value: String(messages.length), inline: true },
    { name: 'Ticket ID', value: ticketId, inline: true },
  ];

  const viewButtonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('View Transcript')
      .setURL(hostedUrl),
  );

  // ---------- send to log (or ticket) channel ----------
  try {
    const logEmbed = new EmbedBuilder()
      .setColor(0x34d399)
      .setTitle('📦 Ticket Closed (Logged)')
      .setDescription(
        [
          'Transcript generated and logged.',
          '',
          `[Open transcript in browser](${hostedUrl})`,
          '',
          'A full HTML copy of the transcript is attached to this message.',
        ].join('\n'),
      )
      .addFields(baseFields)
      .setTimestamp();

    await targetCh.send({
      embeds: [logEmbed],
      components: [viewButtonRow],
      files: [attachment],
    });
  } catch (e) {
    console.log('Transcript log send failed:', e.message);
  }

  // ---------- DM ticket opener (embed + button + HTML file) ----------
  if (openerMember) {
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(0x38bdf8)
        .setTitle('📁 Your Ticket Transcript')
        .setDescription(
          [
            `Here is your transcript for **#${channel.name}**.`,
            '',
            'You can open it using the button below, or download the attached HTML file and open it in your browser.',
          ].join('\n'),
        )
        .addFields(baseFields)
        .setTimestamp();

      const dmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel('Open Transcript')
          .setURL(hostedUrl),
      );

      await openerMember.send({
        embeds: [dmEmbed],
        components: [dmRow],
        files: [attachment],
      }).catch(() => { });
    } catch (e) {
      console.log('Transcript DM to opener failed:', e.message);
    }
  }

  // ---------- confirmation in the ticket channel ----------
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('View Transcript')
      .setURL(hostedUrl),
  );

  const finalEmbed = new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle('✅ Ticket Closed')
    .setDescription(
      [
        'This ticket has been closed and the transcript has been saved.',
        '',
        '• Logged in the transcript log channel (or here if no log channel is set).',
        '• DM sent to the ticket opener (if DMs are open).',
      ].join('\n'),
    )
    .addFields(baseFields)
    .setFooter({ text: `Ticket ID: ${ticketId}` })
    .setTimestamp();

  await interaction.followUp({
    embeds: [finalEmbed],
    components: [confirmRow],
    ephemeral: false,
  });

  // ---------- delete ticket if needed ----------
  if (mode === 'delete') {
    setTimeout(() => channel.delete().catch(() => { }), 3000);
  }
}

// ============ Ready + interactions ============
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  for (const gid of Object.keys(bumpStore)) scheduleBumpTimer(gid);
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Buttons (pay copy + ticket close buttons)
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id.startsWith('copy:')) {
        const key = id.split(':')[1]; // e.g. cashapp
        const label = PAY_LABEL_MAP[key] || key;

        const embed = interaction.message.embeds?.[0];
        const desc = embed?.data?.description || embed?.description || '';

        // Match "**Cash App:** value"
        const escapedLabel = label.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const m = new RegExp(`\\*\\*${escapedLabel}:\\*\\*\\s(.+?)(?:\\n|$)`, 'i').exec(desc);
        const value = (m && m[1]) ? m[1].trim() : null;
        if (!value) return interaction.reply({ content: 'Not found.', ephemeral: true });
        return interaction.reply({ content: value, ephemeral: true });
      }
      if (id === 'ticket:save_close') {
        await interaction.deferReply({ ephemeral: true });
        await generateAndSendTranscript(interaction, 'delete');
        return;
      }
      if (id === 'ticket:delete_only') {
        await interaction.deferReply({ ephemeral: true });
        await interaction.followUp({ content: 'Deleting this ticket...', ephemeral: true });
        setTimeout(() => interaction.channel.delete().catch(() => { }), 1500);
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    // /help
    if (interaction.commandName === 'help') {
      const e = new EmbedBuilder().setColor(0x2dd4bf).setTitle('INVINCIBLE EATS — Commands').setDescription([
        '**Tickets**: /closeticket',
        '**Payments**: /setpay /delpay /pay',
        '**Orders**: /ueinspect',
        '**Vouch**: /vouch /vouchcount',
        '**Moderation**: /scanpromos (auto anti-promo is on)',
        '**Bump**: /bump_config /bump /bumpstatus',
        '**Announce**: /announce /sayembed /invoice',
        '**Help**: /help',
      ].join('\n'));
      return interaction.reply({ embeds: [e], ephemeral: true });
    }

    // /scanpromos
    if (interaction.commandName === 'scanpromos') {
      const limit = interaction.options.getInteger('limit') || 200;
      await interaction.deferReply({ ephemeral: true });
      const removed = await bulkScanPromos(interaction.channel, limit);
      return interaction.editReply(`Removed **${removed}** promotional messages.`);
    }

    // /setpay  (Justice Chef or Manage Guild)
    if (interaction.commandName === 'setpay') {
      const member = interaction.member;
      const hasManageGuild = member.permissions.has(PermissionFlagsBits.ManageGuild);
      const hasJusticeChef = member.roles.cache.has(JUSTICE_CHEF_ROLE_ID);

      if (!hasManageGuild && !hasJusticeChef) {
        return interaction.reply({
          content: 'You must have the **Justice Chef on patrol** role or **Manage Server** permission to use `/setpay`.',
          ephemeral: true,
        });
      }

      const staff = interaction.options.getUser('staff', true);
      const info = { name: interaction.options.getString('name', true) };
      for (const [, key] of PAYMENT_FIELDS.slice(1)) {
        const v = interaction.options.getString(key); if (v) info[key] = v;
      }
      payStore[staff.id] = info; writeJson('pay.json', payStore);
      return interaction.reply({ content: `Saved payment fields for **${info.name}**.`, ephemeral: true });
    }

    // /delpay  (Justice Chef or Manage Guild)
    if (interaction.commandName === 'delpay') {
      const member = interaction.member;
      const hasManageGuild = member.permissions.has(PermissionFlagsBits.ManageGuild);
      const hasJusticeChef = member.roles.cache.has(JUSTICE_CHEF_ROLE_ID);

      if (!hasManageGuild && !hasJusticeChef) {
        return interaction.reply({
          content: 'You must have the **Justice Chef on patrol** role or **Manage Server** permission to use `/delpay`.',
          ephemeral: true,
        });
      }

      const staff = interaction.options.getUser('staff', true);
      if (!payStore[staff.id]) {
        return interaction.reply({
          content: `No payment info is saved for **${staff.tag}**.`,
          ephemeral: true,
        });
      }

      delete payStore[staff.id];
      writeJson('pay.json', payStore);
      return interaction.reply({
        content: `Deleted saved payment fields for **${staff.tag}**.`,
        ephemeral: true,
      });
    }

    // /pay
    if (interaction.commandName === 'pay') {
      const staff = interaction.options.getUser('staff', true);
      const amount = interaction.options.getNumber('amount', true);
      const note = interaction.options.getString('note') || '';
      const info = payStore[staff.id] || { name: staff.tag };
      const embed = buildPayEmbed(interaction.user, staff, info, amount, note);
      const rows = buildPayButtons(info);
      return interaction.reply({ content: `${staff}`, embeds: [embed], components: rows, ephemeral: false });
    }

    // /bump_config
    if (interaction.commandName === 'bump_config') {
      const interval = interaction.options.getInteger('interval') || 120;
      bumpStore[interaction.guildId] = { channelId: interaction.channelId, intervalMin: interval, lastBumpTs: Date.now() };
      writeJson('bumps.json', bumpStore); scheduleBumpTimer(interaction.guildId);
      return interaction.reply({ content: `Bump reminders enabled here every **${interval}** minutes.`, ephemeral: true });
    }

    // /bump
    if (interaction.commandName === 'bump') {
      if (!bumpStore[interaction.guildId]) {
        return interaction.reply({ content: 'Use **/bump_config** in a channel first to enable reminders.', ephemeral: true });
      }
      bumpStore[interaction.guildId].lastBumpTs = Date.now(); writeJson('bumps.json', bumpStore); scheduleBumpTimer(interaction.guildId);
      return interaction.reply({ content: 'Got it! Timer reset from now.', ephemeral: true });
    }

    // /bumpstatus
    if (interaction.commandName === 'bumpstatus') {
      const cfg = bumpStore[interaction.guildId];
      if (!cfg) return interaction.reply({ content: 'Bump reminder is not enabled. Use **/bump_config**.', ephemeral: true });
      const ms = (cfg.intervalMin || 120) * 60 * 1000;
      const next = (cfg.lastBumpTs || Date.now()) + ms;
      const minsLeft = Math.max(0, Math.ceil((next - Date.now()) / 60000));
      return interaction.reply({ content: `Next reminder in **${minsLeft}** min.`, ephemeral: true });
    }

    // /vouch
    if (interaction.commandName === 'vouch') {
      const staff = interaction.options.getUser('staff', true);
      const text = interaction.options.getString('message', true);
      const image = interaction.options.getAttachment('image');
      const outChannel = interaction.options.getChannel('channel') || interaction.channel;
      const embed = new EmbedBuilder().setColor(0xf59e0b).setTitle('✅ New Vouch').setDescription(text)
        .addFields(
          { name: 'Customer', value: `${interaction.user}`, inline: true },
          { name: 'Served by', value: `${staff}`, inline: true },
        )
        .setTimestamp();
      if (image) embed.setImage(image.url);
      await outChannel.send({ embeds: [embed] });
      vouchByStaff[staff.id] = (vouchByStaff[staff.id] || 0) + 1;
      vouchByCust[interaction.user.id] = (vouchByCust[interaction.user.id] || 0) + 1;
      writeJson('vouches_by_staff.json', vouchByStaff);
      writeJson('vouches_by_customer.json', vouchByCust);
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (member) await applyCustomerRoles(interaction.guild, member, vouchByCust[interaction.user.id]);
      return interaction.reply({ content: 'Thanks! Your vouch has been recorded.', ephemeral: true });
    }

    // /vouchcount
    if (interaction.commandName === 'vouchcount') {
      const user = interaction.options.getUser('user') || interaction.user;
      const count = vouchByCust[user.id] || 0;
      const tier = tierForCount(count);
      const e = new EmbedBuilder().setColor(0x8b5cf6).setTitle('Customer Loyalty Status')
        .setDescription([
          `**User:** ${user}`,
          `**Vouches (as customer):** ${count}`,
          `**Tier:** ${tier ? tier.label : '—'}`,
        ].join('\n'));
      return interaction.reply({ embeds: [e], ephemeral: true });
    }

    // /announce
    if (interaction.commandName === 'announce') {
      const title = interaction.options.getString('title', true);
      const body = interaction.options.getString('body', true);
      const ch = interaction.options.getChannel('channel') || interaction.channel;
      const embed = new EmbedBuilder().setColor(0x3498db).setTitle(title).setDescription(body).setTimestamp();
      await ch.send({ embeds: [embed] });
      return interaction.reply({ content: 'Announcement posted.', ephemeral: true });
    }

    // /sayembed
    if (interaction.commandName === 'sayembed') {
      const text = interaction.options.getString('text', true);
      const embed = new EmbedBuilder().setColor(0x1f2937).setDescription(text).setTimestamp();
      await interaction.channel.send({ embeds: [embed] });
      return interaction.reply({ content: 'Sent.', ephemeral: true });
    }

    // /invoice
    if (interaction.commandName === 'invoice') {
      const customer = interaction.options.getUser('customer', true);
      const amount = interaction.options.getNumber('amount', true);
      const items = interaction.options.getString('items', true);
      const e = new EmbedBuilder().setColor(0x22c55e).setTitle('🧾 Invoice / Receipt')
        .addFields(
          { name: 'Customer', value: `${customer}`, inline: true },
          { name: 'Amount', value: fmtMoney(amount), inline: true },
        )
        .setDescription(items)
        .setFooter({ text: `Generated by ${interaction.user.tag}` })
        .setTimestamp();
      await interaction.channel.send({ embeds: [e] });
      return interaction.reply({ content: 'Invoice posted.', ephemeral: true });
    }

    // /ueinspect
    if (interaction.commandName === 'ueinspect') {
      const url = interaction.options.getString('url', true);
      const m = url.match(UE_REGEX);
      if (!m) return interaction.reply({ content: 'Please provide a valid **Uber Eats group** URL.', ephemeral: true });
      const forwarded = await forwardUE(m[0], interaction.user);
      if (forwarded) return interaction.reply({ content: 'Forwarded to the tickets channel. 👍', ephemeral: true });
      return interaction.reply({ content: 'Could not forward to the tickets channel. Check the channel ID.', ephemeral: true });
    }

    // /closeticket — show panel
    if (interaction.commandName === 'closeticket') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({ content: 'You need **Manage Channels** permission.', ephemeral: true });
      }
      const e = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('Close Ticket')
        .setDescription(
          'Choose an option:\n' +
          '**Save & Close** — generate transcript, DM opener, log & delete.\n' +
          '**Delete Only** — delete this channel without saving.'
        );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket:save_close').setStyle(ButtonStyle.Success).setEmoji('💾').setLabel('Save & Close'),
        new ButtonBuilder().setCustomId('ticket:delete_only').setStyle(ButtonStyle.Danger).setEmoji('🗑️').setLabel('Delete Only'),
      );
      return interaction.reply({ embeds: [e], components: [row], ephemeral: true });
    }

  } catch (err) {
    console.error('Interaction error', err);
    if (!interaction.replied) {
      await interaction.reply({ content: 'Something went wrong.', ephemeral: true }).catch(() => { });
    }
  }
});

// ============ Register & login ============
(async () => {
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
    console.log('⚠️ Set DISCORD_TOKEN and CLIENT_ID in your environment.');
  }
  try { await registerCommands(); }
  catch (e) { console.error('Command registration failed:', e.message || e); }
  client.login(process.env.DISCORD_TOKEN);
})();