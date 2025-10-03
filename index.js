// index.js

require('dotenv').config();
const { 
    Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ChannelType, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, Events 
} = require('discord.js');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// --- CONFIGURATION ---
const CLIENT_ID = process.env.CLIENT_ID || '1422439800627003562';                 
const GUILD_ID = process.env.GUILD_ID || '1386924124433023058';              
const TRANSCRIPT_LOG_CHANNEL_ID = process.env.TRANSCRIPT_LOG_CHANNEL_ID || '1386924127041880081'; 

// --- VOUCH CHANNEL CONFIGURATION (NEW) ---
// Vouch Channel IDs
const FOOD_VOUCH_CHANNEL_ID = '1386924126844879012';            // For UB3R & D00RDASH
const SUBSCRIPTION_VOUCH_CHANNEL_ID = '1386924126844879013';    // For SUBSCRIPTION, AIRPODS, & CHEAP GAS
const MEAL_KIT_VOUCH_CHANNEL_ID = '1386924126844879014';        // For MEAL KITS
const DEFAULT_VOUCH_CHANNEL_ID = SUBSCRIPTION_VOUCH_CHANNEL_ID; 

// --- TICKET CATEGORY IDs (NEW) ---
const UB3R_TICKETS_CATEGORY_ID = '1386924125834051744';
const DOORDASH_TICKETS_CATEGORY_ID = '1386940540351680513';
const SUBSCRIPTION_TICKETS_CATEGORY_ID = '1386924125834051739';
const MEAL_KITS_TICKETS_CATEGORY_ID = '1404872522016751759';
const CHEAP_GAS_TICKETS_CATEGORY_ID = '1409936283135901707';

// --- LOYALTY CHANNEL CONFIGURATION ---
const LOYALTY_TIER_REDIRECT_ID = '1422979794449989702'; 

// --- STAFF PAYMENT DATA ---
const STAFF_PAYMENTS = {
    '1311570447564804116': { 
        name: 'distrodaddy',
        chime: '$only1pradag-34',
        zelle: 'navac0326@outlook.com',
        stripe: 'https://buy.stripe.com/7sY6oJboL4F50hxawx8og00'
    },
    '123456789012345678': {
        name: 'Alice (Placeholder)',
        paypal: 'alice@paypal.com',
        cashapp: '$AliceCash',
        venmo: '@Alice-Venmo'
    },
    '987654321098765432': {
        name: 'Bob (Placeholder)',
        btc: 'bc1q...bobaddress',
        paypal: 'bob@paypal.com'
    },
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const app = express();
const PORT = process.env.PORT || 5000;

const TRANSCRIPTS_DIR = './transcripts';

// --- SLASH COMMANDS DATA (UPDATED FOR DM SUPPORT) ---
const commands = [{
    name: 'closeticket',
    description: 'Closes the current ticket channel and saves the transcript.',
    default_member_permissions: PermissionFlagsBits.ManageChannels.toString(),
    // Command remains guild-only (default behavior)
}, 
{
    name: 'pay',
    description: 'Shows the available payment methods for a specified staff member.',
    // ENAELES /pay command to be used in Direct Messages (DMs)
    dm_permission: true, 
    options: [{
        name: 'staff_member',
        description: 'The staff member you are paying.',
        type: 6,
        required: true,
    }],
},
{
    name: 'announce',
    description: 'Announces the loyalty tier system and referral program.',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    // Command remains guild-only (default behavior)
}];

async function ensureTranscriptsDir() {
    try {
        await fs.access(TRANSCRIPTS_DIR);
    } catch {
        await fs.mkdir(TRANSCRIPTS_DIR, { recursive: true });
    }
}

async function saveTranscript(channelId, messages, ticketInfo) {
    await ensureTranscriptsDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ticket-${channelId}-${timestamp}.json`;
    const filepath = path.join(TRANSCRIPTS_DIR, filename);

    const domain = process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
        : `http://localhost:${PORT}`;

    const transcriptData = {
        ticketId: channelId,
        ticketInfo: ticketInfo,
        messages: messages,
        closedAt: new Date().toISOString(),
        transcriptUrl: `${domain}/transcript/${filename}`
    };

    await fs.writeFile(filepath, JSON.stringify(transcriptData, null, 2));

    return {
        filename: filename,
        url: transcriptData.transcriptUrl
    };
}

async function fetchChannelMessages(channel) {
    const messages = [];
    let lastId;

    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) break;

        batch.forEach(msg => {
            const avatarURL = msg.author.displayAvatarURL({ extension: 'png', size: 64 });

            messages.push({
                id: msg.id,
                author: {
                    id: msg.author.id,
                    username: msg.author.username,
                    tag: msg.author.tag,
                    bot: msg.author.bot,
                    avatarURL: avatarURL 
                },
                content: msg.content,
                timestamp: msg.createdAt.toISOString(),
                attachments: msg.attachments.map(att => ({
                    name: att.name,
                    url: att.url,
                    contentType: att.contentType
                })),
                embeds: msg.embeds.map(embed => embed.toJSON())
            });
        });

        lastId = batch.last().id;
        if (batch.size < 100) break;
    }

    return messages.reverse();
}

client.on(Events.ClientReady, async c => {
    console.log(`✅ Bot is online as ${c.user.tag}`);
    console.log(`📝 Transcript viewer available at: ${process.env.REPLIT_DEV_DOMAIN || `http://localhost:${PORT}`}`);

    if (process.env.DISCORD_TOKEN && CLIENT_ID) {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        try {
            console.log('Started refreshing GLOBAL application (/) commands.');

            await rest.put(
                Routes.applicationCommands(CLIENT_ID),
                { body: commands }, 
            );
            console.log('✅ Successfully registered /closeticket, /pay, and /announce commands GLOBALLY.');
            console.log('Note: Global commands may take up to an hour to appear in all servers.');
        } catch (error) {
            console.error('Error registering commands. Check CLIENT_ID or permissions:', error);
        }
    } else {
        console.error('❌ CLIENT_ID or DISCORD_TOKEN is missing. Slash commands will not be registered.');
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) {
        return;
    }

    if (interaction.commandName === 'closeticket') {
        await interaction.deferReply({ ephemeral: true });

        // Ensure the command is used in a guild text channel (prevents DM usage)
        if (interaction.channel.type !== ChannelType.GuildText) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setDescription('❌ This command must be used in a text channel.');

            return interaction.editReply({ embeds: [errorEmbed] });
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.editReply('❌ You do not have permission to close tickets!');
        }

        try {
            const channel = interaction.channel;

            const closingEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('📝 Saving Transcript...')
                .setDescription('Please wait while we save the ticket transcript...')
                .setTimestamp();

            await interaction.editReply({ embeds: [closingEmbed] });

            const messages = await fetchChannelMessages(channel);

            let ticketCreatorId = null;
            if (channel.topic) {
                const topicMatch = channel.topic.match(/User ID: (\d+)/);
                if (topicMatch) {
                    ticketCreatorId = topicMatch[1];
                }
            }
            if (!ticketCreatorId && messages.length > 0) {
                const firstMsg = messages[0];
                const mentionMatch = firstMsg.content.match(/<@!?(\d+)>/);
                if (mentionMatch) {
                    ticketCreatorId = mentionMatch[1];
                }
            }

            let customerInfo = null;
            if (ticketCreatorId) {
                try {
                    const creator = await client.users.fetch(ticketCreatorId);
                    customerInfo = {
                        id: creator.id,
                        username: creator.username,
                        tag: creator.tag
                    };
                } catch (error) {
                    console.error('Could not fetch customer info:', error);
                }
            }

            const ticketInfo = {
                channelName: channel.name,
                channelId: channel.id,
                closedBy: {
                    id: interaction.user.id,
                    username: interaction.user.username,
                    tag: interaction.user.tag
                },
                customer: customerInfo,
                creatorId: ticketCreatorId,
                messageCount: messages.length,
                createdAt: channel.createdAt.toISOString()
            };

            const transcript = await saveTranscript(channel.id, messages, ticketInfo);

            const successEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ Ticket Closed Successfully')
                .setDescription(`This ticket has been closed and archived.`)
                .addFields(
                    { name: '📊 Messages Saved', value: `${messages.length} messages`, inline: true },
                    { name: '👤 Closed By', value: interaction.user.tag, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: `Ticket ID: ${channel.id}` });

            const button = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('View Transcript')
                        .setURL(transcript.url)
                        .setStyle(ButtonStyle.Link)
                );

            await channel.send({ embeds: [successEmbed], components: [button] });

            await interaction.editReply({ content: `Transcript saved and final message sent. Deleting channel in 5 seconds.`, embeds: [] });

            const logChannel = interaction.guild.channels.cache.get(TRANSCRIPT_LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send({ embeds: [successEmbed], components: [button] });
            }

            // --- START: NEW CONDITIONAL VOUCH LOGIC ---
            if (ticketInfo.creatorId) {
                try {
                    const creator = await client.users.fetch(ticketInfo.creatorId);

                    const parentId = channel.parentId; 
                    let vouchChannelId = DEFAULT_VOUCH_CHANNEL_ID; 

                    // 1. MEAL KITS go to MEAL KITS Vouch
                    if (parentId === MEAL_KITS_TICKETS_CATEGORY_ID) {
                        vouchChannelId = MEAL_KIT_VOUCH_CHANNEL_ID;
                    } 
                    // 2. UB3R and DOORDASH go to FOOD Vouch
                    else if (parentId === UB3R_TICKETS_CATEGORY_ID || 
                             parentId === DOORDASH_TICKETS_CATEGORY_ID) {
                        vouchChannelId = FOOD_VOUCH_CHANNEL_ID;
                    }
                    // 3. SUBSCRIPTION & CHEAP GAS go to SUBSCRIPTION Vouch
                    else if (parentId === SUBSCRIPTION_TICKETS_CATEGORY_ID || 
                             parentId === CHEAP_GAS_TICKETS_CATEGORY_ID) {
                        vouchChannelId = SUBSCRIPTION_VOUCH_CHANNEL_ID;
                    }

                    // Construct the final vouch message with a channel mention
                    const vouchMessage = `\n\n**Action Required:** If you haven't yet, please leave a vouch for your experience in the correct channel: <#${vouchChannelId}>`;

                    const dmEmbed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('📋 Your Ticket Has Been Closed')
                        // Append the vouch message to the description
                        .setDescription(`Your ticket **${ticketInfo.channelName}** has been closed and archived.${vouchMessage}`)
                        .addFields(
                            { name: '📊 Messages Saved', value: `${messages.length} messages`, inline: true },
                            { name: '👤 Closed By', value: interaction.user.tag, inline: true }
                        )
                        .setTimestamp()
                        .setFooter({ text: `Ticket ID: ${channel.id}` });

                    await creator.send({ embeds: [dmEmbed], components: [button] });
                } catch (error) {
                    console.error('Could not DM ticket creator:', error);
                }
            }
            // --- END: NEW CONDITIONAL VOUCH LOGIC ---

            setTimeout(async () => {
                try {
                    await channel.delete('Ticket closed via /closeticket command');
                } catch (error) {
                    console.error(`Error deleting channel ${channel.id}:`, error);
                }
            }, 5000); 

        } catch (error) {
            console.error('Error closing ticket:', error);
            interaction.editReply('❌ An error occurred while closing the ticket. Please try again.');
        }
    }

    else if (interaction.commandName === 'pay') {
        // This command works in DMs now because dm_permission is set to true
        await interaction.deferReply({ ephemeral: false }); 

        const user = interaction.options.getUser('staff_member');
        const staffId = user.id;

        const paymentInfo = STAFF_PAYMENTS[staffId];

        if (!paymentInfo) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setDescription(`❌ **${user.tag}** is not currently registered in the payment list or is not a staff member.`)
                .setFooter({ text: 'Ensure the staff member is registered in the STAFF_PAYMENTS map.'});

            return interaction.editReply({ embeds: [errorEmbed] });
        }

        let paymentDetails = [];
        if (paymentInfo.paypal) paymentDetails.push(`PayPal: \`${paymentInfo.paypal}\``);
        if (paymentInfo.cashapp) paymentDetails.push(`CashApp: \`${paymentInfo.cashapp}\``);
        if (paymentInfo.venmo) paymentDetails.push(`Venmo: \`${paymentInfo.venmo}\``);
        if (paymentInfo.btc) paymentDetails.push(`Bitcoin (BTC): \`${paymentInfo.btc}\``);
        if (paymentInfo.chime) paymentDetails.push(`Chime: \`${paymentInfo.chime}\``);
        if (paymentInfo.zelle) paymentDetails.push(`Zelle (Email): \`${paymentInfo.zelle}\``);
        if (paymentInfo.stripe) paymentDetails.push(`Stripe Link: [Click to Pay](${paymentInfo.stripe})`);

        if (paymentDetails.length === 0) {
            paymentDetails.push("No payment methods are currently configured for this staff member.");
        }

        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle(`💸 Payment Methods for ${paymentInfo.name}`)
            .setDescription(`Please use one of the following methods to send payment to **${user.tag}**:`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: 'Available Methods', value: paymentDetails.join('\n'), inline: false },
                { name: 'Important', value: 'Double-check the username/tag before finalizing payment!', inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    else if (interaction.commandName === 'announce') { 
        // This command will automatically be restricted to guilds (servers)
        // since dm_permission is not set to true.
        if (interaction.channel.type !== ChannelType.GuildText) {
             return interaction.reply({ 
                content: '❌ This command can only be used in a server channel.', 
                ephemeral: true 
            });
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ 
                content: '❌ You need the Administrator permission to use this command.', 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const loyaltyEmbed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('👑 Check Out Our Loyalty Tiers & Referral Program!')
            .setDescription(`
                We're excited to offer amazing rewards for our loyal customers and dedicated promoters! 

                Click the **<#${LOYALTY_TIER_REDIRECT_ID}>** channel link below to see the **discounts** and **perks** associated with each tier role.
            `)
            .addFields(
                { 
                    name: '⭐ Tier Benefits', 
                    value: `Visit **<#${LOYALTY_TIER_REDIRECT_ID}>** to see what **tier role** you have! The more you order, the better the discounts get.`, 
                    inline: false 
                },
                { 
                    name: '🤝 Referral Program Rewards', 
                    value: 'It pays to bring friends who order!',
                    inline: false 
                },
                { 
                    name: '🎁 Free Order Bonus', 
                    value: 'For **every two invites** who join AND order from us, you get a **FREE ORDER** at absolutely no cost.', 
                    inline: true 
                },
                { 
                    name: '💰 At-Cost Order', 
                    value: 'For **every single invite** who joins AND orders from us, you get an order at **COST** (our price, no markup!).', 
                    inline: true 
                }
            )
            .setTimestamp()
            .setFooter({ text: 'Thank you for being a part of our community!' });

        try {
            await interaction.channel.send({ embeds: [loyaltyEmbed] });

            await interaction.editReply({ 
                content: `✅ Loyalty announcement successfully sent to **#${interaction.channel.name}**! It redirects to the #loyalty-tiers channel.`
            });

        } catch (error) {
            console.error('Error sending loyalty announcement:', error);
            await interaction.editReply('❌ An error occurred while sending the message. Check bot permissions in the current channel.');
        }
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    if (message.content.toLowerCase() === '!help') {
        const helpEmbed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle('🎫 Ticket Bot Commands')
            .setDescription('Here are the available commands:')
            .addFields(
                { name: '/closeticket (Server Only)', value: 'Close the current ticket and save transcript.', inline: false },
                { name: '/pay @StaffMember (Server & DM)', value: 'Shows the available payment methods for a staff member.', inline: false },
                { name: '/announce (Server Only)', value: 'Announces the loyalty tier system and referral program.', inline: false }
            )
            .setTimestamp();

        message.reply({ embeds: [helpEmbed] });
    }
});

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

app.get('/transcript/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;

        // Use a strict regex check for filename validation to prevent directory traversal
        const filenameRegex = /^ticket-[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z\.json$/;

        if (!filename.match(filenameRegex)) {
            return res.status(400).send('Invalid transcript filename format.');
        }

        // Use the strictly validated filename
        const filepath = path.join(TRANSCRIPTS_DIR, filename); 

        const data = await fs.readFile(filepath, 'utf8');
        const transcript = JSON.parse(data);

        let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ticket Transcript - ${escapeHtml(transcript.ticketInfo.channelName)}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/moment-timezone/0.5.43/moment-timezone-with-data.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: #36393f;
            color: #dcddde;
            padding: 20px;
        }
        .container { max-width: 1200px; margin: 0 auto; background: #2f3136; border-radius: 8px; overflow: hidden; }
        .header { 
            background: #202225; 
            padding: 20px; 
            border-bottom: 1px solid #202225;
        }
        .header h1 { color: #fff; margin-bottom: 10px; }
        .ticket-info { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
            gap: 15px; 
            margin-top: 15px;
        }
        .info-item { background: #36393f; padding: 10px; border-radius: 4px; }
        .info-label { color: #8e9297; font-size: 12px; text-transform: uppercase; margin-bottom: 5px; }
        .info-value { color: #fff; font-size: 14px; }
        .messages { padding: 20px; }
        .message { 
            display: flex; 
            padding: 10px; 
            margin-bottom: 10px;
            border-radius: 4px;
            transition: background 0.2s;
        }
        .message:hover { background: #32353b; }
        .avatar { 
            width: 40px; 
            height: 40px; 
            border-radius: 50%; 
            margin-right: 15px;
            flex-shrink: 0;
            object-fit: cover;
        }
        .message-content { flex: 1; }
        .message-header { margin-bottom: 5px; }
        .username { color: #fff; font-weight: 600; margin-right: 8px; }
        .bot-tag { 
            background: #5865f2; 
            color: #fff; 
            font-size: 10px; 
            padding: 2px 4px; 
            border-radius: 3px;
            margin-right: 8px;
        }
        .timestamp { color: #72767d; font-size: 12px; cursor: help; }
        .message-text { color: #dcddde; white-space: pre-wrap; word-wrap: break-word; line-height: 1.5; }
        .attachment { 
            margin-top: 8px; 
            padding: 8px; 
            background: #36393f; 
            border-radius: 4px;
            display: inline-block;
        }
        .attachment a { color: #00b0f4; text-decoration: none; }
        .attachment a:hover { text-decoration: underline; }
        .attachment img {
            max-width: 100%; 
            max-height: 300px;
            border-radius: 4px;
            margin-top: 8px;
            display: block;
        }
        .timezone-info {
            background: #36393f;
            padding: 10px;
            margin: 20px;
            border-radius: 4px;
            text-align: center;
            color: #8e9297;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎫 ${escapeHtml(transcript.ticketInfo.channelName)}</h1>
            <div class="ticket-info">
                <div class="info-item">
                    <div class="info-label">Ticket ID</div>
                    <div class="info-value">${escapeHtml(transcript.ticketInfo.channelId)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Customer</div>
                    <div class="info-value">${escapeHtml(transcript.ticketInfo.customer ? transcript.ticketInfo.customer.tag : 'Unknown')}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Closed By</div>
                    <div class="info-value">${escapeHtml(transcript.ticketInfo.closedBy.tag)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Messages</div>
                    <div class="info-value">${transcript.ticketInfo.messageCount}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Created At</div>
                    <div class="info-value timestamp" data-time="${transcript.ticketInfo.createdAt}">${transcript.ticketInfo.createdAt}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Closed At</div>
                    <div class="info-value timestamp" data-time="${transcript.closedAt}">${transcript.closedAt}</div>
                </div>
            </div>
        </div>
        <div class="timezone-info">
            All timestamps are displayed in your local timezone: <strong id="user-timezone">Loading...</strong>
        </div>
        <div class="messages">
`;

        for (const msg of transcript.messages) {
            const botTag = msg.author.bot ? '<span class="bot-tag">BOT</span>' : '';

            html += `
            <div class="message">
                <img class="avatar" src="${escapeHtml(msg.author.avatarURL)}" alt="${escapeHtml(msg.author.username)}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                <div class="message-content">
                    <div class="message-header">
                        <span class="username">${escapeHtml(msg.author.username)}</span>
                        ${botTag}
                        <span class="timestamp" data-time="${escapeHtml(msg.timestamp)}">${escapeHtml(msg.timestamp)}</span>
                    </div>
                    <div class="message-text">${escapeHtml(msg.content || '')}</div>
`;

            for (const att of msg.attachments) {
                html += `<div class="attachment">`;
                html += `<a href="${escapeHtml(att.url)}" target="_blank">📎 ${escapeHtml(att.name)}</a>`;

                if (att.contentType && att.contentType.startsWith('image/')) {
                    html += `<img src="${escapeHtml(att.url)}" alt="${escapeHtml(att.name)}">`;
                }

                html += `</div>`;
            }

            html += `
                </div>
            </div>
`;
        }

        html += `
        </div>
    </div>
    <script>
        const userTimezone = moment.tz.guess();
        document.getElementById('user-timezone').textContent = userTimezone;

        document.querySelectorAll('.timestamp').forEach(el => {
            const isoTime = el.getAttribute('data-time');
            if (isoTime) {
                const localTime = moment(isoTime).tz(userTimezone).format('YYYY-MM-DD HH:mm:ss z');
                el.textContent = localTime;
                el.title = 'Original: ' + isoTime;
            }
        });
    </script>
</body>
</html>
`;

        res.send(html);
    } catch (error) {
        console.error('Error serving transcript:', error);
        res.status(404).send('Transcript not found');
    }
});

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Discord Ticket Bot</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background: #36393f;
                        color: #dcddde;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                    }
                    .container {
                        text-align: center;
                        background: #2f3136;
                        padding: 40px;
                        border-radius: 8px;
                    }
                    h1 { color: #fff; }
                    .status { color: #43b581; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🎫 Discord Ticket Bot</h1>
                    <p>Bot is running and ready to handle tickets!</p>
                    <div class="status">✅ Online</div>
                </div>
            </body>
        </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ ERROR: DISCORD_TOKEN is not set in environment variables!');
    console.error('Please add your Discord bot token to continue.');
} else {
    client.login(process.env.DISCORD_TOKEN).catch(error => {
        console.error('❌ Failed to login to Discord:', error);
    });
}
