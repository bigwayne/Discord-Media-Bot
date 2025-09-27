require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ],
});

// store loaded modules
const modules = new Map();

// function to load all modules from media_modules directory
function loadModules() {
    const modulesPath = path.join(__dirname, 'media_modules');
    
    if (!fs.existsSync(modulesPath)) {
        console.log('No media_modules directory found');
        return;
    }

    const moduleFiles = fs.readdirSync(modulesPath).filter(file => file.endsWith('.js'));
    
    console.log(`Loading ${moduleFiles.length} module(s)...`);
    
    for (const file of moduleFiles) {
        try {
            const ModuleClass = require(path.join(modulesPath, file));
            const moduleInstance = new ModuleClass();
            
            modules.set(moduleInstance.name, moduleInstance);
            console.log(`✅  Loaded module: ${moduleInstance.name}`);
            console.log(`   Commands: ${moduleInstance.commands.join(', ')}`);
            console.log(`   Description: ${moduleInstance.description}`);
        } catch (error) {
            console.error(`❌  Failed to load module ${file}:`, error.message);
        }
    }
    
    console.log(`Total modules loaded: ${modules.size}`);
}

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
    loadModules();
});

client.on('messageCreate', async (message) => {
    // skip bot messages
    if (message.author.bot) return;
    
    // try each module to see if it should handle this message
    for (const [name, module] of modules) {
        try {
            if (module.shouldHandle && module.shouldHandle(message)) {
                console.log(`📨  Module ${name} handling message: ${message.content}`);
                await module.handle(message);
                return; // stop after first module handles the message
            }
        } catch (error) {
            console.error(`❌  Error in module ${name}:`, error);
            // continue to next module instead of crashing
        }
    }
});

// reload modules (for dev)
function reloadModules() {
    // clear module cache
    const modulesPath = path.join(__dirname, 'media_modules');
    if (fs.existsSync(modulesPath)) {
        const moduleFiles = fs.readdirSync(modulesPath).filter(file => file.endsWith('.js'));
        for (const file of moduleFiles) {
            const modulePath = path.join(modulesPath, file);
            delete require.cache[require.resolve(modulePath)];
        }
    }
    
    // clear modules map and reload
    modules.clear();
    loadModules();
}

// export for potential external use
module.exports = { client, modules, reloadModules };

client.login(process.env.DISCORD_BOT_TOKEN);