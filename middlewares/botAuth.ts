import { Context, InlineKeyboard, NextFunction } from "grammy";
import logger from "../core/logger";
import { createUser, isExist } from "../services/userDbServices";

const checkChannels = async (ctx: Context) => {
    let channels = process.env.JOINCHANNELS as string;
    if (channels === "" || channels === undefined) {
        logger.error("No channels to check");
        return true;
    }
    let userId = ctx.from?.id;

    let parts = channels.split(",").filter(channel => channel.trim().length > 0);

    let joinedChannels = 0;
    let notJoinedChannels = [];

    for (const channel of parts) {
        try {
            const chatMember = await ctx.api.getChatMember(channel, userId);

            // Check if the user is a member
            if (['member', 'administrator', 'creator'].includes(chatMember.status)) {
                joinedChannels++;
            } else {
                notJoinedChannels.push(channel);
            }
        } catch (error) {
            logger.error(error, {
                section: "checkUserSubscription",
            });
            notJoinedChannels.push(channel);
        }
    }

    if (joinedChannels === parts.length) {
        return true;
    }

    let message = `ابتدا باید در کانال های زیر عضو شوید:`;

    let kb = new InlineKeyboard();

    for (const channel of notJoinedChannels) {
        kb.url(channel, `https://t.me/${channel.replace("@", "")}`).row();
    }

    kb.text("تایید", "start");

    await ctx.reply(message, {
        reply_markup: kb,
    });
}

export const loginUserMiddleware = async (ctx: Context, next: NextFunction) => {
    //check if channel return;
    if (ctx.channelPost) {
        return;
    }

    let result = await checkChannels(ctx);
    if (!result) {
        return;
    }

    let user = ctx.from;

    let checklogin = await isExist(user.id);

    if (checklogin) {
        return next();
    }

    logger.info(`User is not logged in, creating user ${user.id}`, {
        section: "UserLoginMiddleware",
    });
    let createdUser = await createUser(user.id);

    if (!createdUser.success) {
        logger.error(createdUser.message);
        await ctx.reply(createdUser.message);
        return;
    }

    logger.info(`User created ${user.id}`, {
        section: "UserLoginMiddleware",
    });
    return next();
};
