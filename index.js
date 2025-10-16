// index.js
require('dotenv').config();
const { 
    Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ChannelType, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, Events 
} = require('discord.js');
const express = require('express');
const fs = require('fs').promises;
const fs_sync = require('fs'); // For file streams
const path = require('path');
const axios = require('axios'); // For downloading images

// --- CONFIGURATION ---
const CLIENT_ID = process.env.CLIENT_ID || '1422439800627003562';                 
const GUILD_ID = process.env.GUILD_ID || '1386924124433023058';              
const TRANSCRIPT_LOG_CHANNEL_ID = process.env.TRANSCRIPT_LOG_CHANNEL_ID || '1386924127041880081'; 

// --- VOUCH CHANNEL CONFIGURATION ---
const FOOD_VOUCH_CHANNEL_ID = '1386924126844879012';
const SUBSCRIPTION_VOUCH_CHANNEL_ID = '1386924126844879013';
const MEAL_KIT_VOUCH_CHANNEL_ID = '1386924126844879014';
const DEFAULT_VOUCH_CHANNEL_ID = SUBSCRIPTION_VOUCH_CHANNEL_ID; 

// --- TICKET CATEGORY IDs ---
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
        chime: '$pradag-34',
        zelle: 'navac0326@outlook.com',
        stripe: 'https://buy.stripe.com/7sY6oJboL4F50hxawx8og00'
    },
    '123456789012345678': { name: 'Alice (Placeholder)', paypal: 'alice@paypal.com', cashapp: '$AliceCash', venmo: '@Alice-Venmo' },
    '987654321098765432': { name: 'Bob (Placeholder)', btc: 'bc1q...bobaddress', paypal: 'bob@paypal.com' },
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers
    ]
});

const app = express();
const PORT = process.env.PORT || 5000;

const TRANSCRIPTS_DIR = './transcripts';
const ATTACHMENTS_DIR = path.join(__dirname, 'public', 'attachments');

app.use('/attachments', express.static(ATTACHMENTS_DIR));

const commands = [
    { name: 'closeticket', description: 'Closes the current ticket channel and saves the transcript.', default_member_permissions: PermissionFlagsBits.ManageChannels.toString() }, 
    { name: 'pay', description: 'Shows the available payment methods for a specified staff member.', dm_permission: true, options: [{ name: 'staff_member', description: 'The staff member you are paying.', type: 6, required: true }] },
    { name: 'announce', description: 'Announces the loyalty tier system and referral program.', default_member_permissions: PermissionFlagsBits.Administrator.toString() }
];

async function ensureDir(dirPath) {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

async function saveTranscript(channelId, messages, ticketInfo) {
    await ensureDir(TRANSCRIPTS_DIR);
    await ensureDir(ATTACHMENTS_DIR);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ticket-${channelId}-${timestamp}.json`;
    const filepath = path.join(TRANSCRIPTS_DIR, filename);
    
    for (const message of messages) {
        if (message.attachments && message.attachments.length > 0) {
            for (const attachment of message.attachments) {
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    try {
                        const response = await axios({ method: 'get', url: attachment.url, responseType: 'stream' });
                        const attachmentFilename = `${message.id}-${attachment.name}`;
                        const attachmentPath = path.join(ATTACHMENTS_DIR, attachmentFilename);
                        const writer = fs_sync.createWriteStream(attachmentPath);
                        response.data.pipe(writer);
                        await new Promise((resolve, reject) => {
                            writer.on('finish', resolve);
                            writer.on('error', reject);
                        });
                        attachment.url = `/attachments/${attachmentFilename}`;
                    } catch (error) {
                        console.error(`Failed to download attachment ${attachment.url}:`, error);
                    }
                }
            }
        }
    }

    const domain = `http://192.168.1.49:${PORT}`;

    const transcriptData = {
        ticketId: channelId,
        ticketInfo: ticketInfo,
        messages: messages,
        closedAt: new Date().toISOString(),
        transcriptUrl: `${domain}/transcript/${filename}`
    };

    await fs.writeFile(filepath, JSON.stringify(transcriptData, null, 2));

    return { filename: filename, url: transcriptData.transcriptUrl };
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
            messages.push({
                id: msg.id,
                author: { id: msg.author.id, username: msg.author.username, tag: msg.author.tag, bot: msg.author.bot, avatarURL: msg.author.displayAvatarURL({ extension: 'png', size: 64 }) },
                content: msg.content,
                timestamp: msg.createdAt.toISOString(),
                attachments: msg.attachments.map(att => ({ name: att.name, url: att.url, contentType: att.contentType })),
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
    console.log(`📝 Transcript viewer available on your local network.`);

    if (process.env.DISCORD_TOKEN && CLIENT_ID) {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        try {
            console.log('Started refreshing GLOBAL application (/) commands.');
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
            console.log('✅ Successfully registered commands GLOBALLY.');
        } catch (error) {
            console.error('Error registering commands:', error);
        }
    } else {
        console.error('❌ CLIENT_ID or DISCORD_TOKEN is missing. Slash commands will not be registered.');
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'closeticket') {
        await interaction.deferReply({ ephemeral: true });

        if (interaction.channel.type !== ChannelType.GuildText) {
            const errorEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ This command must be used in a text channel.');
            return interaction.editReply({ embeds: [errorEmbed] });
        }
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.editReply('❌ You do not have permission to close tickets!');
        }
        try {
            const channel = interaction.channel;
            await interaction.editReply({ content: '✅ Command received. Saving transcript and closing ticket...', embeds: [] });

            const messages = await fetchChannelMessages(channel);
            let ticketCreatorId = null;
            if (channel.topic) {
                const topicMatch = channel.topic.match(/User ID: (\d+)/);
                if (topicMatch) ticketCreatorId = topicMatch[1];
            }
            if (!ticketCreatorId && messages.length > 0) {
                const firstMsg = messages[0];
                if (firstMsg && firstMsg.content) {
                    const mentionMatch = firstMsg.content.match(/<@!?(\d+)>/);
                    if (mentionMatch) ticketCreatorId = mentionMatch[1];
                }
            }

            let customerInfo = null;
            if (ticketCreatorId) {
                try {
                    const creator = await client.users.fetch(ticketCreatorId);
                    customerInfo = { id: creator.id, username: creator.username, tag: creator.tag };
                } catch (error) { console.error('Could not fetch customer info:', error); }
            }
            const ticketInfo = {
                channelName: channel.name, channelId: channel.id,
                closedBy: { id: interaction.user.id, username: interaction.user.username, tag: interaction.user.tag },
                customer: customerInfo, creatorId: ticketCreatorId, messageCount: messages.length, createdAt: channel.createdAt.toISOString()
            };
            
            const transcript = await saveTranscript(channel.id, messages, ticketInfo);
            
            // <<< FIX: The link is now directly in the description, and the button is removed.
            const successEmbed = new EmbedBuilder().setColor('#00FF00').setTitle('✅ Ticket Closed').setDescription(`This ticket has been archived. The channel will be deleted in 5 seconds.\n\n[**Click here to view the transcript**](${transcript.url})`)
                .addFields({ name: '📊 Messages Saved', value: `${messages.length}`, inline: true }, { name: '👤 Closed By', value: interaction.user.tag, inline: true })
                .setTimestamp().setFooter({ text: `Ticket ID: ${channel.id}` });
            
            await channel.send({ embeds: [successEmbed] }); // <<< FIX: No more 'components'
            
            const logChannel = interaction.guild.channels.cache.get(TRANSCRIPT_LOG_CHANNEL_ID);
            if (logChannel) await logChannel.send({ embeds: [successEmbed] }); // <<< FIX: No more 'components'

            if (ticketInfo.creatorId) {
                try {
                    const creator = await client.users.fetch(ticketInfo.creatorId);
                    const parentId = channel.parentId; let vouchChannelId = DEFAULT_VOUCH_CHANNEL_ID;
                    if (parentId === MEAL_KITS_TICKETS_CATEGORY_ID) vouchChannelId = MEAL_KIT_VOUCH_CHANNEL_ID;
                    else if (parentId === UB3R_TICKETS_CATEGORY_ID || parentId === DOORDASH_TICKETS_CATEGORY_ID) vouchChannelId = FOOD_VOUCH_CHANNEL_ID;
                    else if (parentId === SUBSCRIPTION_TICKETS_CATEGORY_ID || parentId === CHEAP_GAS_TICKETS_CATEGORY_ID) vouchChannelId = SUBSCRIPTION_VOUCH_CHANNEL_ID;
                    
                    const vouchMessage = `\n\n**Action Required:** Please leave a vouch for your experience in <#${vouchChannelId}>.`;
                    
                    // <<< FIX: The link is now directly in the description for DMs too.
                    const dmEmbed = new EmbedBuilder().setColor('#00FF00').setTitle('📋 Your Ticket Has Been Closed').setDescription(`Your ticket **${ticketInfo.channelName}** has been closed.\n\n[**Click here to view the transcript**](${transcript.url})${vouchMessage}`)
                        .addFields({ name: '📊 Messages Saved', value: `${messages.length}`, inline: true }, { name: '👤 Closed By', value: interaction.user.tag, inline: true })
                        .setTimestamp().setFooter({ text: `Ticket ID: ${channel.id}` });
                    await creator.send({ embeds: [dmEmbed] }); // <<< FIX: No more 'components'
                } catch (error) { console.error('Could not DM ticket creator:', error); }
            }
            setTimeout(async () => { try { await channel.delete('Ticket closed'); } catch (error) { console.error(`Error deleting channel ${channel.id}:`, error); } }, 5000); 
        } catch (error) {
            console.error('Error closing ticket:', error);
            try { await interaction.followUp({ content: '❌ An error occurred while closing the ticket. Please check the logs.', ephemeral: true }); } catch (followUpError) { console.error('Failed to send error reply:', followUpError); }
        }
    } else if (interaction.commandName === 'pay') {
        // ... (this command is unchanged)
    } else if (interaction.commandName === 'announce') { 
        // ... (this command is unchanged)
    }
});

client.on(Events.MessageCreate, async message => {
    // ... (this event is unchanged)
});

// ... The rest of the file (web server) is unchanged ...
function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
app.get('/transcript/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const filenameRegex = /^ticket-[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z\.json$/;
        if (!filename.match(filenameRegex)) return res.status(400).send('Invalid transcript filename.');
        
        const filepath = path.join(TRANSCRIPTS_DIR, filename); 
        const data = await fs.readFile(filepath, 'utf8');
        const transcript = JSON.parse(data);
        
        let html = `<!DOCTYPE html><html><head><title>Ticket Transcript</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src="https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/moment-timezone/0.5.43/moment-timezone-with-data.min.js"></script><style>body{font-family:sans-serif;background:#36393f;color:#dcddde;padding:20px}.container{max-width:1200px;margin:0 auto;background:#2f3136;border-radius:8px;overflow:hidden}.header{background:#202225;padding:20px}h1{color:#fff}.message{display:flex;padding:10px;margin-bottom:10px}.avatar{width:40px;height:40px;border-radius:50%;margin-right:15px}.username{color:#fff;font-weight:600}.timestamp{color:#72767d;font-size:12px}.attachment img{max-width:100%;max-height:300px;border-radius:4px;margin-top:8px}</style></head><body><div class="container"><div class="header"><h1>🎫 ${escapeHtml(transcript.ticketInfo.channelName)}</h1></div><div class="messages">`;
        for (const msg of transcript.messages) {
            html += `<div class="message"><img class="avatar" src="${escapeHtml(msg.author.avatarURL)}" alt="avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"><div class="message-content"><div class="message-header"><span class="username">${escapeHtml(msg.author.username)}</span> <span class="timestamp" data-time="${escapeHtml(msg.timestamp)}"></span></div><div class="message-text">${escapeHtml(msg.content||'')}</div>`;
            for (const att of msg.attachments) {
                if (att.contentType && att.contentType.startsWith('image/')) {
                    html += `<div class="attachment"><a href="${escapeHtml(att.url)}" target="_blank"><img src="${escapeHtml(att.url)}" alt="${escapeHtml(att.name)}"></a></div>`;
                }
            }
            html += `</div></div>`;
        }
        html += `</div></div><script>document.querySelectorAll('.timestamp').forEach(el=>{const isoTime=el.getAttribute('data-time');if(isoTime){el.textContent=moment(isoTime).tz(moment.tz.guess()).format('YYYY-MM-DD HH:mm:ss z');}});</script></body></html>`;
        res.send(html);
    } catch (error) {
        console.error('Error serving transcript:', error);
        res.status(404).send('Transcript not found.');
    }
});
app.get('/', (req, res) => {
    res.send(`<html><body style="font-family:sans-serif;background:#36393f;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;"><h1>🎫 Discord Ticket Bot is running!</h1></body></html>`);
});
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ ERROR: DISCORD_TOKEN is not set in environment variables!');
} else {
    client.login(process.env.DISCORD_TOKEN).catch(error => {
        console.error('❌ Failed to login to Discord:', error);
    });
}


