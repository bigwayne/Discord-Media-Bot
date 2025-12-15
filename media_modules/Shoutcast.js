const { EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const axios = require('axios');
const { parseString } = require('xml2js');

class Shoutcast {
    constructor() {
        this.name = 'Shoutcast Radio';
        this.commands = ['radio!start', 'radio!stop'];
        this.description = 'Stream radio to voice channels with support for Shoutcast, PLS, M3U, and XSPF formats';
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
                case 'radio!start':
                    await this.handleStart(message, args);
                    break;
                case 'radio!stop':
                    await this.handleStop(message);
                    break;
            }
        } catch (error) {
            console.error(`Radio error: ${error.message}`);
            await message.reply('❌ An error occurred while processing your request.');
        }
    }

    async handleStart(message, args) {
        if (args.length < 2) {
            return message.reply('❌ Please provide a stream URL: `radio!start <url>` (supports Shoutcast, .pls, .m3u, .xspf)');
        }

        const inputUrl = args[1];
        if (!this.isValidUrl(inputUrl)) {
            return message.reply('❌ Please provide a valid URL (must be HTTP/HTTPS)');
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

        if (this.connections.has(message.guild.id)) {
            return message.reply('❌ Already streaming in this server. Use `radio!stop` first.');
        }

        // parse playlist and get stream URLs
        let streamUrls = [];
        let playlistType = 'direct';
        
        try {
            const playlistData = await this.parsePlaylist(inputUrl);
            streamUrls = playlistData.urls;
            playlistType = playlistData.type;
            
            if (streamUrls.length === 0) {
                return message.reply('❌ No valid streams found in playlist');
            }
        } catch (error) {
            return message.reply(`❌ Cannot process stream/playlist: ${error.message}`);
        }

        // use first stream URL for playback
        const streamUrl = streamUrls[0];
        
        // validate the actual stream
        try {
            await this.validateStream(streamUrl);
        } catch (error) {
            return message.reply(`❌ Cannot connect to stream: ${error.message}`);
        }

        // get stream info
        const streamInfo = await this.getStreamInfo(streamUrl, playlistType);
        
        const joinEmbed = new EmbedBuilder()
            .setTitle('🎵 Radio Stream Starting')
            .setDescription(streamInfo.name || 'Unknown Station')
            .addFields(
                { name: 'Station', value: streamInfo.name || 'Unknown', inline: true },
                { name: 'Genre', value: streamInfo.genre || 'Unknown', inline: true },
                { name: 'Format', value: playlistType.toUpperCase(), inline: true },
                { name: 'Voice Channel', value: `[Join ${voiceChannel.name}](https://discord.com/channels/${message.guild.id}/${voiceChannel.id})`, inline: false }
            )
            .setColor(0x1db954);

        await message.channel.send({ embeds: [joinEmbed] });

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            const player = createAudioPlayer();
            const resource = createAudioResource(streamUrl, {
                inlineVolume: true,
                inputType: this.getInputType(streamUrl)
            });

            connection.subscribe(player);
            player.play(resource);

            this.connections.set(message.guild.id, {
                connection,
                player,
                channel: message.channel,
                streamUrl,
                streamUrls, // backup URLs for failover
                currentUrlIndex: 0,
                streamInfo,
                currentTrack: null,
                playlistType
            });

            connection.on(VoiceConnectionStatus.Disconnected, () => {
                this.cleanup(message.guild.id);
            });

            player.on(AudioPlayerStatus.Playing, () => {
                console.log(`Radio streaming started in ${message.guild.name}`);
            });

            player.on('error', async (error) => {
                console.error(`Radio player error: ${error.message}`);
                const connectionData = this.connections.get(message.guild.id);
                if (connectionData && connectionData.streamUrls.length > 1) {
                    await this.handleFailover(message.guild.id);
                } else {
                    message.channel.send('❌ Audio streaming error occurred');
                    this.cleanup(message.guild.id);
                }
            });

            this.startTrackMonitoring(message.guild.id);

        } catch (error) {
            console.error(`Voice connection error: ${error.message}`);
            return message.reply('❌ Failed to join voice channel or start streaming');
        }
    }

    async handleStop(message) {
        if (!this.connections.has(message.guild.id)) {
            return message.reply('❌ No active radio stream in this server');
        }

        const botVoiceChannel = message.guild.members.me?.voice?.channel;
        const userVoiceChannel = message.member?.voice?.channel;

        if (botVoiceChannel && userVoiceChannel?.id !== botVoiceChannel.id) {
            return message.reply('❌ You must be in the same voice channel as the bot to stop streaming');
        }

        this.cleanup(message.guild.id);
        
        const stopEmbed = new EmbedBuilder()
            .setTitle('🛑 Radio Stream Stopped')
            .setDescription('Stream has been disconnected')
            .setColor(0xff0000);

        await message.channel.send({ embeds: [stopEmbed] });
    }

    async parsePlaylist(url) {
        const urlLower = url.toLowerCase();
        
        // direct stream URL
        if (!urlLower.includes('.pls') && !urlLower.includes('.m3u') && !urlLower.includes('.xspf')) {
            return { urls: [url], type: 'direct' };
        }

        try {
            const response = await axios.get(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot)',
                    'Accept': '*/*'
                }
            });

            const content = response.data;

            if (urlLower.includes('.pls')) {
                return this.parsePLS(content);
            } else if (urlLower.includes('.m3u')) {
                return this.parseM3U(content, url);
            } else if (urlLower.includes('.xspf')) {
                return await this.parseXSPF(content);
            }
        } catch (error) {
            throw new Error(`Failed to fetch playlist: ${error.message}`);
        }

        throw new Error('Unsupported playlist format');
    }

    parsePLS(content) {
        const urls = [];
        const lines = content.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('File') && trimmed.includes('=')) {
                const url = trimmed.split('=', 2)[1].trim();
                if (this.isValidUrl(url)) {
                    urls.push(url);
                }
            }
        }
        
        return { urls, type: 'pls' };
    }

    parseM3U(content, baseUrl) {
        const urls = [];
        const lines = content.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                let url = trimmed;
                // handle relative URLs
                if (!this.isValidUrl(url) && baseUrl) {
                    try {
                        const base = new URL(baseUrl);
                        url = new URL(url, base.origin).href;
                    } catch (e) {
                        continue;
                    }
                }
                
                if (this.isValidUrl(url)) {
                    urls.push(url);
                }
            }
        }
        
        return { urls, type: 'm3u' };
    }

    async parseXSPF(content) {
        return new Promise((resolve, reject) => {
            parseString(content, (err, result) => {
                if (err) {
                    reject(new Error(`Failed to parse XSPF: ${err.message}`));
                    return;
                }

                const urls = [];
                try {
                    const tracks = result?.playlist?.trackList?.[0]?.track || [];
                    
                    for (const track of tracks) {
                        const location = track.location?.[0];
                        if (location && this.isValidUrl(location)) {
                            urls.push(location);
                        }
                    }
                } catch (parseError) {
                    reject(new Error('Invalid XSPF format'));
                    return;
                }

                resolve({ urls, type: 'xspf' });
            });
        });
    }

    async handleFailover(guildId) {
        const connectionData = this.connections.get(guildId);
        if (!connectionData) return;

        const nextIndex = (connectionData.currentUrlIndex + 1) % connectionData.streamUrls.length;
        const nextUrl = connectionData.streamUrls[nextIndex];

        try {
            await this.validateStream(nextUrl);
            
            const resource = createAudioResource(nextUrl, {
                inlineVolume: true,
                inputType: this.getInputType(nextUrl)
            });

            connectionData.player.play(resource);
            connectionData.streamUrl = nextUrl;
            connectionData.currentUrlIndex = nextIndex;

            console.log(`Failover successful to backup stream ${nextIndex + 1}`);
            
        } catch (error) {
            console.error(`Failover failed: ${error.message}`);
            connectionData.channel.send('❌ Stream connection lost and backup failed');
            this.cleanup(guildId);
        }
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

        console.log(`Cleaned up radio resources for guild ${guildId}`);
    }

    startTrackMonitoring(guildId) {
        const connectionData = this.connections.get(guildId);
        if (!connectionData) return;

        const interval = setInterval(async () => {
            try {
                const currentInfo = await this.getStreamInfo(connectionData.streamUrl, connectionData.playlistType);
                const newTrack = currentInfo.currentSong;

                if (newTrack && newTrack !== connectionData.currentTrack && newTrack !== 'Unknown Track') {
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
        }, 15000); // check every 15 seconds to reduce load

        this.trackCheckIntervals.set(guildId, interval);
    }

    isValidUrl(url) {
        try {
            const parsedUrl = new URL(url);
            return ['http:', 'https:'].includes(parsedUrl.protocol);
        } catch {
            return false;
        }
    }

    async validateStream(url) {
        try {
            const response = await axios.head(url, {
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot)',
                    'Icy-MetaData': '1'
                },
                maxRedirects: 5
            });
            
            const contentType = response.headers['content-type'];
            const icyName = response.headers['icy-name'];
            
            // more flexible content type checking
            if (contentType && !this.isAudioContent(contentType) && !icyName) {
                throw new Error('URL does not appear to be an audio stream');
            }
        } catch (error) {
            if (error.code === 'ENOTFOUND' || error.code === 'ENOENT') {
                throw new Error('Stream URL not found');
            } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
                throw new Error('Stream connection timeout');
            } else if (error.response?.status >= 400) {
                throw new Error(`Stream returned error: ${error.response.status}`);
            }
            throw error;
        }
    }

    isAudioContent(contentType) {
        const audioTypes = [
            'audio/', 'application/ogg', 'video/ogg', 'application/x-ogg',
            'application/octet-stream', 'video/mp2t'
        ];
        return audioTypes.some(type => contentType.includes(type));
    }

    getInputType(url) {
        const urlLower = url.toLowerCase();
        if (urlLower.includes('.ogg') || urlLower.includes('ogg')) {
            return 'ogg/opus';
        } else if (urlLower.includes('.webm')) {
            return 'webm/opus';
        }
        return undefined; // let Discord.js auto-detect
    }

    async getStreamInfo(url, type = 'direct') {
        // try to get icecast/shoutcast metadata
        try {
            const response = await axios.get(url, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot)',
                    'Icy-MetaData': '1',
                    'Range': 'bytes=0-1023' // only get small chunk for metadata
                },
                responseType: 'stream'
            });

            const headers = response.headers;
            const streamInfo = {
                name: headers['icy-name'] || headers['ice-audio-info'] || 'Internet Radio',
                genre: headers['icy-genre'] || 'Various',
                currentSong: headers['icy-description'] || 'Unknown Track',
                bitRate: headers['icy-br'] || 'Unknown'
            };

            response.data.destroy(); // close stream
            return streamInfo;
            
        } catch (error) {
            // fallback to basic info
            return {
                name: `${type.toUpperCase()} Stream`,
                genre: 'Various',
                currentSong: 'Unknown Track',
                listeners: '0',
                bitRate: 'Unknown'
            };
        }
    }
}

module.exports = Shoutcast;