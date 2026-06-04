import { Bot } from "grammy";
import { callBackHandler, messagesHandler, startHandler } from "./botHandlers/generalHandlers";
import { loginUserMiddleware } from "./middlewares/botAuth";
import { adminLoginHandler, adminLogoutHandler } from "./botHandlers/adminHandlers";
import logger from "./core/logger";



const token = process.env.BOT_TOKEN;

if (!token) {
    throw new Error("BOT_TOKEN is required");
}

const bot = new Bot(token, process.env.PROXY_TELEGRAM_API ? {
    client: {
        apiRoot: process.env.PROXY_TELEGRAM_API
    }
} : undefined);

bot.use(loginUserMiddleware);

bot.command("start", (ctx) => {
    new Promise(async () => {
        try {
            await startHandler(ctx);
        } catch (error) {
            logger.error(error, {
                section: "startHandler",
            });
        }
    });
});

bot.command("login", async (ctx) => {
    new Promise(async () => {
        try {
            await adminLoginHandler(ctx);
        } catch (error) {
            logger.error(error, {
                section: "adminLoginHandler",
            });
        }
    });
});

bot.command("logout", async (ctx) => {
    new Promise(async () => {
        try {
            await adminLogoutHandler(ctx);
        } catch (error) {
            logger.error(error, {
                section: "adminLogoutHandler",
            }); 
        }
    });
});

bot.command("help", async (ctx) => {
    new Promise(async () => {
        try {
            await ctx.reply(
                "🤖 *Antigravity Agent Bot*\n\n" +
                "*Commands:*\n" +
                "/start \\- Start the bot\n" +
                "/login \\<username\\> \\<password\\> \\- Login as admin\n" +
                "/logout \\- Logout from admin\n" +
                "/help \\- Show this message\n\n" +
                "*Agent Features \\(Admin only\\):*\n" +
                "💬 Chat with Agent \\- AI\\-powered conversations\n" +
                "📂 Projects \\- Create and manage projects\n" +
                "⚡ Execute Command \\- Run shell commands\n" +
                "🖥️ System Info \\- View system details\n" +
                "📋 Task History \\- View past tasks",
                { parse_mode: "MarkdownV2" }
            );
        } catch (error) {
            logger.error(error, {
                section: "helpHandler",
            });
        }
    });
});

bot.on("message", (ctx) => {
    new Promise(async () => {
        try {
            await messagesHandler(ctx);
        } catch (error) {
            logger.error(error, {
                section: "messagesHandler",
            });
        }
    });
});

bot.on("callback_query:data", (ctx) => {
    new Promise(async () => {
        try {
            await callBackHandler(ctx);
        } catch (error) {
            logger.error(error, {
                section: "callBackHandler",
            });
        }
    });
});


export default bot;