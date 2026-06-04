import { Context, InlineKeyboard, Keyboard } from "grammy";
import logger from "../core/logger";
import { UserState } from "../core/enums";
import { getUserState, setUserState } from "../services/userDbServices";

export const startHandler = async (ctx: Context, start = true) => {
    let userId = ctx.from.id;

    let setState = await setUserState(userId, UserState.start);

    if (!setState.success) {
        await ctx.reply(setState.message/*"مشکلی پیش آمد"*/);
        return;
    }

    await ctx.reply("خوش آمدید");
};



export const callBackHandler = async (ctx: Context) => {
    let userId = ctx.from?.id as number;
    let callBackq = ctx.callbackQuery?.data.split("_");

    logger.info(`User ${userId} sent a callback query: ${ctx.callbackQuery?.data}`);

    switch (callBackq[0]) {
    }
}

export const cancelHandler = async (ctx: Context) => {
    let userId = ctx.from.id;

    let state = await getUserState(userId);

    if (!state) {
        await ctx.reply("خطا در دریافت وضعیت شما❌");
        return;
    }

    logger.info(`User ${userId} is trying to cancell in state : ${state}`);

    let setState = await setUserState(userId, UserState.start);

    if (!setState.success) {
        await ctx.reply(setState.message/*"مشکلی پیش آمد"*/);
        return;
    }

    await startHandler(ctx);
};


export const messagesHandler = async (ctx: Context) => {
    let text = ctx.message?.text;

    switch (text) {
    }


    let state = await getUserState(ctx.from.id);

    if (!state) {
        await ctx.reply("مشکلی پیش آمد❌");
        return;
    }

    logger.info(`User ${ctx.from.id} sent a message in state : ${state}`);

    switch (state) {
        default:
            return await ctx.reply("متوجه منظور شما نشدم");
    }
};