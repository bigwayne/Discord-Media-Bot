class EnvConfig {
    static getChannelIds(moduleName) {
        const envKey = `${moduleName.toUpperCase()}_CHANNEL_IDS`;
        const channelIds = process.env[envKey];
        
        if (!channelIds) {
            console.warn(`⚠️  Module ${moduleName}: Environment variable ${envKey} not set. Module may not respond to messages.`);
            return [];
        }
        
        return channelIds.split(',').map(id => id.trim()).filter(id => id);
    }
    
    static validateChannelIds(moduleName) {
        const channelIds = this.getChannelIds(moduleName);
        const validIds = channelIds.filter(id => /^\d{17,19}$/.test(id));
        
        if (validIds.length !== channelIds.length) {
            const invalidIds = channelIds.filter(id => !/^\d{17,19}$/.test(id));
            console.warn(`⚠️  Module ${moduleName}: Invalid channel IDs: ${invalidIds.join(', ')}`);
        }
        
        return validIds;
    }
    
    static getRequiredEnv(key, moduleName = 'System') {
        const value = process.env[key];
        if (!value) {
            console.warn(`⚠️  Module ${moduleName}: Required environment variable ${key} not set.`);
        }
        return value;
    }
}

module.exports = EnvConfig;