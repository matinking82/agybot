import { Context } from "grammy";
import { loginAdmin } from "../services/adminDbServices";
import { setUserAdmin } from "../services/userDbServices";

export const adminLoginHandler = async (ctx: Context) => {
    let text = ctx.message?.text;
    let parts = text?.split(" ");

    if (parts.length !== 3) {
        return await ctx.reply("باید به صورت:\n/login <username> <password>\n وارد کنید❌");
    }

    let result = await loginAdmin(parts[1], parts[2]);

    if (!result.success) {
        return await ctx.reply(result.message);
    }

    let adminId = ctx.from?.id;

    let setResult = await setUserAdmin(adminId as number);

    if (!setResult.success) {
        return await ctx.reply(setResult.message);
    }

    return await ctx.reply("شما وارد شدید✅");
}

export const adminLogoutHandler = async (ctx: Context) => {
    let adminId = ctx.from?.id;

    let setResult = await setUserAdmin(adminId as number, false);

    if (!setResult.success) {
        return await ctx.reply(setResult.message);
    }

    return await ctx.reply("شما خارج شدید✅");
}