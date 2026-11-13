import { Context } from "grammy";
import { loginAdmin } from "../services/adminDbServices";
import { setUserAdmin } from "../services/userDbServices";
import { adminGuard } from "../middlewares/adminGuard";
import { adminMenuKeyboard } from "../core/keyboards";
import logger from "../core/logger";

const MAX_FAILED_LOGINS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// shortcut: in memory, so a restart resets the counters; persist them if brute force over restarts becomes a concern.
let failedLogins = new Map<number, { count: number; firstAt: number }>();

const isAllowedUser = (userId: number) => {
    let allowed = (process.env.ALLOWED_USER_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
    return allowed.length === 0 || allowed.includes(String(userId));
};

export const adminLoginHandler = async (ctx: Context) => {
    // The message holds the password in plain text: remove it from the chat.
    try {
        await ctx.deleteMessage();
    } catch (e) {
        // Fails harmlessly where the bot cannot delete messages.
    }

    let adminId = ctx.from?.id as number;
    let text = ctx.message?.text || "";
    let parts = text.trim().split(/\s+/);

    if (parts.length !== 3) {
        return await ctx.reply(
            "❌ Usage: /login <username> <password>\n\n" +
            "Example: /login admin admin"
        );
    }

    let now = Date.now();
    let attempts = failedLogins.get(adminId);
    if (attempts && now - attempts.firstAt > LOGIN_WINDOW_MS) {
        failedLogins.delete(adminId);
        attempts = undefined;
    }
    if (attempts && attempts.count >= MAX_FAILED_LOGINS) {
        logger.warn(`Login blocked for ${adminId}: too many failed attempts`, { section: "adminLoginHandler" });
        return await ctx.reply("⛔ Too many failed attempts. Try again later.");
    }

    // Same generic reply for unknown user, wrong password and ids outside ALLOWED_USER_IDS.
    let result = isAllowedUser(adminId) ? await loginAdmin(parts[1], parts[2]) : { success: false };

    if (!result.success) {
        failedLogins.set(adminId, { count: (attempts?.count || 0) + 1, firstAt: attempts?.firstAt || now });
        return await ctx.reply("❌ Invalid credentials");
    }

    failedLogins.delete(adminId);

    let setResult = await setUserAdmin(adminId);

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
