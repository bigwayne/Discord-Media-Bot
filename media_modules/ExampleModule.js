const { EmbedBuilder } = require('discord.js');

class ExampleModule {
    constructor() {
        this.name = 'ExampleModule';
        this.commands = ['!example', '!demo'];
        this.description = 'Example module demonstrating the modular system structure';
    }

    // check if this module should handle the message
    shouldHandle(message) {
        if (message.author.bot) return false;
        
        // handle messages that start with any of our commands
        return this.commands.some(cmd => message.content.startsWith(cmd));
    }

    // main handler for the module
    async handle(message) {
        const command = message.content.split(' ')[0];
        
        switch (command) {
            case '!example':
                return this.handleExample(message);
            case '!demo':
                return this.handleDemo(message);
            default:
                return message.reply('Unknown command for ExampleModule');
        }
    }

    async handleExample(message) {
        const embed = new EmbedBuilder()
            .setTitle('Example Module')
            .setDescription('This is an example of how easy it is to create new modules!')
            .addFields(
                { name: 'Module Name', value: this.name, inline: true },
                { name: 'Commands', value: this.commands.join(', '), inline: true },
                { name: 'How it works', value: 'Each module is a class with shouldHandle() and handle() methods', inline: false }
            )
            .setColor(0x00ff00); // green

        return message.channel.send({ embeds: [embed] });
    }

    async handleDemo(message) {
        return message.reply('🎉  Demo command works! The modular system is functioning correctly.');
    }
}

module.exports = ExampleModule;