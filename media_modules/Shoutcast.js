const { EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const axios = require('axios');

class Shoutcast {
    constructor() {
        this.name = 'Shoutcast';
        this.commands = ['shout!start', 'shout!stop'];
        this.description = 'Stream Shoutcast radio to voice channels with track information';
        this.connections = new Map(); // guild -> connection data
        this.trackCheckIntervals = new Map(); // guild -> interval
    }

    shouldHandle(message) {
        if (message.author.bot) return false;
        return this.commands.some(cmd => message.content.startsWith(cmd));
    }

    async handle(message) {
        const args = message.content.split(' ');
        const command = args[0];

        try {
            switch (command) {
                case 'shout!start':
                    await this.handleStart(message, args);
                    break;
                case 'shout!stop':
                    await this.handleStop(message);
                    break;
            }
        } catch (error) {
            console.error(`Shoutcast error: ${error.message}`);
            await message.reply('❌ An error occurred while processing your request.');
        }
    }

    async handleStart(message, args) {
        if (args.length < 2) {
            return message.reply('❌ Please provide a Shoutcast URL: `shout!start <shoutcast_url>`');
        }

        const shoutcastUrl = args[1];
        if (!this.isValidShoutcastUrl(shoutcastUrl)) {
            return message.reply('❌ Please provide a valid Shoutcast URL (must be HTTP/HTTPS)');
        }

        const member = message.guild?.members?.cache?.get(message.author.id);
        const voiceChannel = member?.voice?.channel;

        if (!voiceChannel) {
            return message.reply('❌ You must be in a voice channel to start streaming');
        }

        const botPermissions = voiceChannel.permissionsFor(message.guild.members.me);
        if (!botPermissions.has(['Connect', 'Speak'])) {
            return message.reply('❌ I need Connect and Speak permissions in your voice channel');
        }

        // check if already streaming in this guild
        if (this.connections.has(message.guild.id)) {
            return message.reply('❌ Already streaming in this server. Use `shout!stop` first.');
        }

        // validate shoutcast stream
        try {
            await this.validateShoutcastStream(shoutcastUrl);
        } catch (error) {
            return message.reply(`❌ Cannot connect to Shoutcast stream: ${error.message}`);
        }

        // get initial stream info
        const streamInfo = await this.getShoutcastInfo(shoutcastUrl);
        
        // show initial embed with stream info
        const joinEmbed = new EmbedBuilder()
            .setTitle('🎵 Shoutcast Stream Starting')
            .setDescription(streamInfo.name || 'Unknown Station')
            .addFields(
                { name: 'Station', value: streamInfo.name || 'Unknown', inline: true },
                { name: 'Genre', value: streamInfo.genre || 'Unknown', inline: true },
                { name: 'Voice Channel', value: `[Join ${voiceChannel.name}](https://discord.com/channels/${message.guild.id}/${voiceChannel.id})`, inline: false }
            )
            .setColor(0x1db954); // spotify green

        await message.channel.send({ embeds: [joinEmbed] });

        // join voice channel and start streaming
        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            const player = createAudioPlayer();
            const resource = createAudioResource(shoutcastUrl, {
                inlineVolume: true
            });

            connection.subscribe(player);
            player.play(resource);

            // store connection data
            this.connections.set(message.guild.id, {
                connection,
                player,
                channel: message.channel,
                shoutcastUrl,
                streamInfo,
                currentTrack: null
            });

            // handle connection events
            connection.on(VoiceConnectionStatus.Disconnected, () => {
                this.cleanup(message.guild.id);
            });

            player.on(AudioPlayerStatus.Playing, () => {
                console.log(`Shoutcast streaming started in ${message.guild.name}`);
            });

            player.on('error', (error) => {
                console.error(`Shoutcast player error: ${error.message}`);
                message.channel.send('❌ Audio streaming error occurred');
                this.cleanup(message.guild.id);
            });

            // start track monitoring
            this.startTrackMonitoring(message.guild.id);

        } catch (error) {
            console.error(`Voice connection error: ${error.message}`);
            return message.reply('❌ Failed to join voice channel or start streaming');
        }
    }

    async handleStop(message) {
        if (!this.connections.has(message.guild.id)) {
            return message.reply('❌ No active Shoutcast stream in this server');
        }

        // check if user is in same voice channel as bot
        const connectionData = this.connections.get(message.guild.id);
        const botVoiceChannel = message.guild.members.me?.voice?.channel;
        const userVoiceChannel = message.member?.voice?.channel;

        if (botVoiceChannel && userVoiceChannel?.id !== botVoiceChannel.id) {
            return message.reply('❌ You must be in the same voice channel as the bot to stop streaming');
        }

        this.cleanup(message.guild.id);
        
        const stopEmbed = new EmbedBuilder()
            .setTitle('🛑 Shoutcast Stream Stopped')
            .setDescription('Stream has been disconnected')
            .setColor(0xff0000);

        await message.channel.send({ embeds: [stopEmbed] });
    }

    cleanup(guildId) {
        const connectionData = this.connections.get(guildId);
        if (connectionData) {
            connectionData.player.stop();
            connectionData.connection.destroy();
            this.connections.delete(guildId);
        }

        const interval = this.trackCheckIntervals.get(guildId);
        if (interval) {
            clearInterval(interval);
            this.trackCheckIntervals.delete(guildId);
        }

        console.log(`Cleaned up Shoutcast resources for guild ${guildId}`);
    }

    startTrackMonitoring(guildId) {
        const connectionData = this.connections.get(guildId);
        if (!connectionData) return;

        // check every 10 seconds for track changes
        const interval = setInterval(async () => {
            try {
                const currentInfo = await this.getShoutcastInfo(connectionData.shoutcastUrl);
                const newTrack = currentInfo.currentSong;

                if (newTrack && newTrack !== connectionData.currentTrack) {
                    connectionData.currentTrack = newTrack;
                    
                    const trackEmbed = new EmbedBuilder()
                        .setTitle('🎵 Now Playing')
                        .setDescription(newTrack)
                        .addFields(
                            { name: 'Station', value: currentInfo.name || 'Unknown', inline: true },
                            { name: 'Genre', value: currentInfo.genre || 'Unknown', inline: true }
                        )
                        .setColor(0x1db954)
                        .setTimestamp();

                    await connectionData.channel.send({ embeds: [trackEmbed] });
                }
            } catch (error) {
                console.error(`Track monitoring error: ${error.message}`);
            }
        }, 10000);

        this.trackCheckIntervals.set(guildId, interval);
    }

    isValidShoutcastUrl(url) {
        try {
            const parsedUrl = new URL(url);
            return ['http:', 'https:'].includes(parsedUrl.protocol);
        } catch {
            return false;
        }
    }

    async validateShoutcastStream(url) {
        try {
            const response = await axios.head(url, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot)'
                }
            });
            
            const contentType = response.headers['content-type'];
            if (!contentType || !contentType.includes('audio')) {
                throw new Error('URL does not appear to be an audio stream');
            }
        } catch (error) {
            if (error.code === 'ENOTFOUND') {
                throw new Error('Stream URL not found');
            } else if (error.code === 'ETIMEDOUT') {
                throw new Error('Stream connection timeout');
            } else if (error.response?.status >= 400) {
                throw new Error(`Stream returned error: ${error.response.status}`);
            }
            throw error;
        }
    }

    async getShoutcastInfo(url) {
        return {
                name: 'Shoutcast Radio',
                genre: 'Various',
                currentSong: 'Unknown Track',
                listeners: '0',
                bitRate: 'Unknown'
        };
    }
}

module.exports = Shoutcast;