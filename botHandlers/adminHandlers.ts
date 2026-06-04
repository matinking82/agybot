import { Context } from "grammy";
import { loginAdmin } from "../services/adminDbServices";
import { setUserAdmin } from "../services/userDbServices";
import { adminGuard } from "../middlewares/adminGuard";
import { adminMenuKeyboard } from "../core/keyboards";

export const adminLoginHandler = async (ctx: Context) => {
    let text = ctx.message?.text;
    let parts = text?.split(" ");

    if (parts.length !== 3) {
        return await ctx.reply(
            "❌ Usage: /login <username> <password>\n\n" +
            "Example: /login admin admin"
        );
    }

    let result = await loginAdmin(parts[1], parts[2]);

    if (!result.success) {
        return await ctx.reply(`❌ ${result.message}`);
    }

    let adminId = ctx.from?.id;

    let setResult = await setUserAdmin(adminId as number);

    if (!setResult.success) {
        return await ctx.reply(`❌ ${setResult.message}`);
    }

    return await ctx.reply(
        "✅ *Successfully logged in as Admin\\!*\n\n" +
        "🤖 You now have access to all agent features\\.",
        {
            parse_mode: "MarkdownV2",
            reply_markup: adminMenuKeyboard(),
        }
    );
};

export const adminLogoutHandler = async (ctx: Context) => {
    let adminId = ctx.from?.id;

    let isAdmin = await adminGuard(adminId);
    if (!isAdmin) {
        return await ctx.reply("❌ You are not logged in as admin.");
    }

    let setResult = await setUserAdmin(adminId as number, false);

    if (!setResult.success) {
        return await ctx.reply(`❌ ${setResult.message}`);
    }

    return await ctx.reply("✅ Successfully logged out. Agent features are now disabled.");
};