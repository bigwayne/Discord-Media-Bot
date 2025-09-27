const { EmbedBuilder } = require('discord.js');
const axios = require('axios');

// IMDB genre-based colors
const genreColors = {
    'Action': 0xff0000,
    'Adventure': 0xffa500,
    'Animation': 0xffc0cb,
    'Comedy': 0xffff00,
    'Crime': 0x8b0000,
    'Documentary': 0x2e8b57,
    'Drama': 0x00008b,
    'Fantasy': 0x800080,
    'Horror': 0x000000,
    'Music': 0x00ced1,
    'Mystery': 0x708090,
    'Romance': 0xff69b4,
    'Sci-Fi': 0x7fffd4,
    'Thriller': 0x4b0082,
    'War': 0x556b2f,
    'Western': 0xcd853f,
};

class NowWatching {
    constructor() {
        this.name = 'NowWatching';
        this.commands = ['!watching'];
        this.description = 'Announce what you\'re watching with movie/show info or YouTube videos';
    }

    // check if this module should handle the message
    shouldHandle(message) {
        if (!message.content.startsWith('!watching') || message.author.bot) return false;
        if (message.channel.id !== process.env.DISCORD_CHANNEL_ID) return false;
        return true;
    }

    // main handler for the module
    async handle(message) {
        const args = message.content.split(' ').slice(1);
        const query = args.join(' ');
        
        if (!query) {
            return message.reply('Please provide a movie, show name, or YouTube link.');
        }

        const member = message.guild.members.cache.get(message.author.id);
        const voiceChannel = member?.voice?.channel;
        if (!voiceChannel) {
            return message.reply('You must be in a voice channel to announce.');
        }

        const voiceChannelLink = `https://discord.com/channels/${message.guild.id}/${voiceChannel.id}`;

        // route to appropriate handler
        if (this.isYouTubeLink(query)) {
            return this.handleYouTube(query, voiceChannelLink, message);
        } else {
            return this.handleOmdb(query, voiceChannelLink, message);
        }
    }

    isYouTubeLink(input) {
        return /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)/.test(input);
    }

    async handleYouTube(link, voiceChannelLink, message) {
        const videoId = link.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/)?.[1];
        if (!videoId) return message.reply('Invalid YouTube link.');

        const oEmbedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

        try {
            const ytResponse = await axios.get(oEmbedUrl);
            const { title, thumbnail_url, author_name } = ytResponse.data;

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(`Shared by ${author_name}`)
                .setThumbnail(thumbnail_url)
                .addFields(
                    { name: 'Platform', value: 'YouTube', inline: true },
                    { name: '', value: `[Click to Join the Show!](${voiceChannelLink})`, inline: false }
                )
                .setColor(0xff0000); // YouTube red

            await message.delete(); // remove the user's command to hide other embeds
            return await message.channel.send({ embeds: [embed] });
        } catch (err) {
            console.error('YouTube fetch error:', err);
            return message.reply('Could not fetch YouTube video info.');
        }
    }

    async handleOmdb(title, voiceChannelLink, message) {
        const omdbUrl = `http://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${process.env.OMDB_API_KEY}`;
        try {
            const response = await axios.get(omdbUrl);
            const data = response.data;

            if (data.Response === 'False') {
                return message.reply('Movie or show not found.');
            }

            const firstGenre = data.Genre?.split(',')[0]?.trim();
            const genreColor = genreColors[firstGenre] || 0x7289da; // Discord purple

            const embed = new EmbedBuilder()
                .setTitle(`${data.Title} (${data.Year})`)
                .setDescription(data.Plot || 'No plot available.')
                .setThumbnail(data.Poster)
                .addFields(
                    { name: 'Genre', value: data.Genre || 'N/A', inline: true },
                    { name: '', value: `[Click to Join the Show!](${voiceChannelLink})`, inline: false }
                )
                .setColor(genreColor);

            await message.delete();
            return await message.channel.send({ embeds: [embed] });
        } catch (err) {
            console.error('OMDb fetch error:', err);
            return message.reply('An error occurred while fetching movie data.');
        }
    }
}

module.exports = NowWatching;
