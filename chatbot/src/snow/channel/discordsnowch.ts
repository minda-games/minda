import Discord from "discord.js"
import { GidType } from "../config/baseguildcfg"
import SnowMessage from "../snowmessage"
import { SnowPerm } from "../snowperm"
import SnowUser from "../snowuser"
import { getFirst } from "../snowutil"
import SnowChannel, { ConfigDepth, CreateChannelOpts } from "./snowchannel"

export default class DiscordSnowCh extends SnowChannel {
    public readonly provider = "discord"
    public readonly id:GidType
    public readonly groupId:GidType
    public supportFile = true
    protected channel:Discord.TextChannel | Discord.DMChannel | Discord.GroupDMChannel
    protected client:Discord.Client
    public constructor(channel:Discord.TextChannel | Discord.DMChannel | Discord.GroupDMChannel) {
        super()
        this.channel = channel
        this.client = channel.client
        this.id = channel.id
        if (channel instanceof Discord.TextChannel) {
            this.groupId = channel.guild.id
        } else {
            this.groupId = this.id
        }
    }
    public async send(text:string, image?:string | Buffer) {
        return this._send(text, image == null ? [] : [image])
    }
    public async sendFiles(files:Array<string | Buffer>, text?:string) {
        return this._send(text, files)
    }
    public async userList() {
        let users:SnowUser[] = []
        if (this.channel instanceof Discord.TextChannel) {
            users = this.channel.guild.members.array().map((v) => userToSnow(v))
        } else if (this.channel instanceof Discord.GroupDMChannel) {
            users = this.channel.recipients.array().map((v) => userToSnow(v))
        } else if (this.channel instanceof Discord.DMChannel) {
            users = [userToSnow(this.channel.recipient)]
        }
        return users
    }
    public async dm(user:string | SnowUser) {
        const id = typeof user === "object" ? user.id : user
        const nativeU = this.client.users.find((v) => v.id === id)
        if (nativeU != null) {
            const ch = await nativeU.createDM()
            return new DiscordSnowCh(ch)
        }
        return null
    }
    public mention(user:string | SnowUser) {
        const id = typeof user === "object" ? user.id : user
        return `<@!${id}>`
    }
    public name() {
        if (this.channel instanceof Discord.TextChannel) {
            return `${this.channel.guild.name} #${this.channel.name}`
        } else if (this.channel instanceof Discord.DMChannel) {
            return `${this.channel.recipient.username}`
        } else {
            return this.channel.recipients.map((v) => v.username).join(", ")
        }
    }
    public async decodeArgs(args:string[]) {
        const out:Array<string | SnowChannel | SnowUser> = []
        for (const arg of args) {
            if (/^<@!?\d+>$/i.test(arg)) {
                const id = arg.match(/\d+/i)[0]
                const u = await this.user(id)
                if (u != null) {
                    out.push(u)
                }
            } else if (/^<#\d+>$/i.test(arg)) {
                const id = arg.match(/\d+/i)[0]
                const client = this.channel.client
                const ch = client.channels.find((v) => v.id === id)
                if (ch != null && (ch instanceof Discord.TextChannel)) {
                    out.push(new DiscordSnowCh(ch))
                }
            } else {
                out.push(arg)
            }
        }
        return out
    }
    public async permissions(user?:string | SnowUser):Promise<SnowPerm> {
        if (user == null) {
            user = this.channel.client.user.id
        }
        if (typeof user === "object") {
            user = user.id
        }
        if (this.channel instanceof Discord.TextChannel) {
            const perms = this.channel.permissionsFor(user)
            return {
                view: perms.has("READ_MESSAGES"),
                viewHistory: perms.has("READ_MESSAGE_HISTORY"),
                edit: perms.has("SEND_MESSAGES"),
                send: perms.has("SEND_MESSAGES"),
                deleteOther: perms.has("MANAGE_MESSAGES"),
            }
        } else {
            return {
                view: true,
                viewHistory: true,
                edit: true,
                send: true,
                deleteOther: false,
            }
        }
    }
    public async createChannel(name:string, options:CreateChannelOpts) {
        // options: pseudo category code
        if (this.channel instanceof Discord.TextChannel) {
            const guild = this.channel.guild
            if (guild.me.permissions.has("MANAGE_CHANNELS")) {
                const findCh = guild.channels.find(
                    (v) => v.id === options.category)
                if (findCh != null && findCh instanceof Discord.CategoryChannel) {
                    const ch = await guild.createChannel(name, "text") as Discord.TextChannel
                    ch.setParent(findCh)
                    return new DiscordSnowCh(ch)
                } else {
                    const ch = await guild.createChannel(name, "text") as Discord.TextChannel
                    return new DiscordSnowCh(ch)
                }
            } else {
                throw new Error("No MANAGE_CHANNELS permission in bot")
            }
        } else {
            throw new Error("Not Guild Channel (Cannot make channels)")
        }
    }
    public async deleteChannel() {
        try {
            await this.channel.delete()
            return true
        } catch (err) {
            console.error(err)
            return false
        }
    }
    protected async _send(text:string, files:Array<string | Buffer>) {
        if (this.channel instanceof Discord.TextChannel) {
            const sendable = this.channel.permissionsFor(this.channel.client.user).has("SEND_MESSAGES")
            if (!sendable) {
                return null
            }
        }
        let message:Discord.Message
        if (text != null) {
            message = getFirst(await this.channel.send(text, {
                files,
            }))
        } else {
            message = getFirst(await this.channel.send({
                files,
            }))
        }
        if (message != null) {
            return messageToSnow(message)
        }
        return null
    }
}
/**
 * Discord Message -> SnowMessage (Partial)
 * @param msg Discord Message
 */
export function messageToSnow(msg:Discord.Message) {
    const images:string[] = []
    const files:string[] = []
    if (msg.attachments.size >= 1) {
        for (const attach of  msg.attachments.array()) {
            if (attach.width >= 1 && attach.height >= 1) {
                images.push(attach.url)
            } else {
                files.push(attach.url)
            }
        }
    }
    const snowM = new SnowMessage()
    snowM.content = msg.content
    snowM.fields = []
    if (images.length >= 1) {
        snowM.image = images.splice(0, 1)[0]
        if (images.length >= 1) {
            for (const i of images) {
                snowM.fields.push({
                    type: "image",
                    data: i, 
                })
            }
        }
    }
    if (files.length >= 1) {
        for (const f of files) {
            snowM.fields.push({
                type: "file",
                data: f,
            })
        }
    }
    snowM.id = msg.id
    snowM.author = userToSnow(msg.member == null ? msg.author : msg.member)
    return snowM
}
/**
 * Discord user -> SnowUser
 * @param user User
 */
export function userToSnow(user:Discord.GuildMember | Discord.User) {
    const snowU = new SnowUser()
    snowU.id = user.id
    if (user instanceof Discord.GuildMember) {
        snowU.nickname = user.nickname == null ? user.user.username : user.nickname
    } else {
        snowU.nickname = user.username
    }
    snowU.platform = "discord"
    const uImage = (u:Discord.User) => {
        if (u.displayAvatarURL != null) {
            return u.displayAvatarURL
        } else {
            return u.defaultAvatarURL
        }
    }
    snowU.profileImage = uImage((user instanceof Discord.GuildMember) ? user.user : user)
    return snowU
}