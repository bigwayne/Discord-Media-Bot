const { PermissionsBitField } = require('discord.js');

class PermissionUtils {
    constructor() {
        // predefined permission sets for common use cases
        this.presets = {
            BASIC_BOT: [
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.ReadMessageHistory
            ],
            MUSIC_BOT: [
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak,
                PermissionsBitField.Flags.UseVAD
            ],
            MEDIA_BOT: [
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak,
                PermissionsBitField.Flags.UseVAD
            ],
            ADMIN_BOT: [
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak,
                PermissionsBitField.Flags.UseVAD,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageGuild
            ]
        };
    }

    // generate OAuth2 authorization URL with specified permissions
    generateAuthUrl(clientId, permissions = 'MEDIA_BOT', guildId = null) {
        try {
            if (!clientId || typeof clientId !== 'string') {
                throw new Error('Valid client ID is required');
            }

            let permissionValue;
            
            // handle preset names or direct permission arrays/values
            if (typeof permissions === 'string' && this.presets[permissions]) {
                permissionValue = new PermissionsBitField(this.presets[permissions]).bitfield;
            } else if (Array.isArray(permissions)) {
                permissionValue = new PermissionsBitField(permissions).bitfield;
            } else if (typeof permissions === 'bigint' || typeof permissions === 'string') {
                permissionValue = BigInt(permissions);
            } else {
                throw new Error('Invalid permissions format');
            }

            const baseUrl = 'https://discord.com/oauth2/authorize';
            const params = new URLSearchParams({
                client_id: clientId,
                scope: 'bot',
                permissions: permissionValue.toString()
            });

            if (guildId) {
                params.append('guild_id', guildId);
            }

            return `${baseUrl}?${params.toString()}`;
        } catch (error) {
            console.error('Error generating auth URL:', error.message);
            throw new Error(`Failed to generate authorization URL: ${error.message}`);
        }
    }

    // check if bot has required permissions in a channel
    checkPermissions(member, channel, requiredPermissions) {
        try {
            if (!member || !channel) {
                return { hasPermissions: false, missing: [], error: 'Missing member or channel' };
            }

            const permissions = channel.permissionsFor(member);
            if (!permissions) {
                return { hasPermissions: false, missing: [], error: 'Unable to fetch permissions' };
            }

            let permsToCheck;
            if (typeof requiredPermissions === 'string' && this.presets[requiredPermissions]) {
                permsToCheck = this.presets[requiredPermissions];
            } else if (Array.isArray(requiredPermissions)) {
                permsToCheck = requiredPermissions;
            } else {
                return { hasPermissions: false, missing: [], error: 'Invalid permissions format' };
            }

            const missing = permsToCheck.filter(perm => !permissions.has(perm));
            
            return {
                hasPermissions: missing.length === 0,
                missing: missing.map(perm => this.getPermissionName(perm)),
                error: null
            };
        } catch (error) {
            console.error('Error checking permissions:', error.message);
            return { hasPermissions: false, missing: [], error: error.message };
        }
    }

    // get human-readable permission name
    getPermissionName(permission) {
        try {
            // handle both flag values and string names
            if (typeof permission === 'string') {
                return permission.replace(/([A-Z])/g, ' $1').trim();
            }
            
            // find permission name from flags
            for (const [name, value] of Object.entries(PermissionsBitField.Flags)) {
                if (value === permission) {
                    return name.replace(/([A-Z])/g, ' $1').trim();
                }
            }
            
            return 'Unknown Permission';
        } catch (error) {
            return 'Unknown Permission';
        }
    }

    // validate permissions for specific module functionality
    validateModulePermissions(member, channel, moduleName) {
        try {
            let requiredPerms;
            
            switch (moduleName.toLowerCase()) {
                case 'nowwatching':
                    requiredPerms = [
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.ManageMessages
                    ];
                    break;
                case 'shoutcast':
                    requiredPerms = 'MUSIC_BOT';
                    break;
                default:
                    requiredPerms = 'BASIC_BOT';
            }

            return this.checkPermissions(member, channel, requiredPerms);
        } catch (error) {
            console.error(`Error validating permissions for ${moduleName}:`, error.message);
            return { hasPermissions: false, missing: [], error: error.message };
        }
    }

    // get permission value for common bot types
    getPermissionValue(preset) {
        try {
            if (!this.presets[preset]) {
                throw new Error(`Unknown permission preset: ${preset}`);
            }
            return new PermissionsBitField(this.presets[preset]).bitfield;
        } catch (error) {
            console.error('Error getting permission value:', error.message);
            throw error;
        }
    }

    // create a permission bitfield from array of permission names/flags
    createPermissionBitfield(permissions) {
        try {
            if (!Array.isArray(permissions)) {
                throw new Error('Permissions must be an array');
            }
            return new PermissionsBitField(permissions);
        } catch (error) {
            console.error('Error creating permission bitfield:', error.message);
            throw error;
        }
    }
}

module.exports = PermissionUtils;