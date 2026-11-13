import { Bot } from "grammy";
import { callBackHandler, messagesHandler, startHandler } from "./botHandlers/generalHandlers";
import { loginUserMiddleware } from "./middlewares/botAuth";
import { adminLoginHandler, adminLogoutHandler } from "./botHandlers/adminHandlers";
import { stopHandler, getFileHandler } from "./botHandlers/agentHandlers";
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

bot.command("stop", (ctx) => {
    new Promise(async () => {
        try {
            await stopHandler(ctx);
        } catch (error) {
            logger.error(error, {
                section: "stopHandler",
            });
        }
    });
});

bot.command("get", (ctx) => {
    new Promise(async () => {
        try {
            await getFileHandler(ctx);
        } catch (error) {
            logger.error(error, {
                section: "getFileHandler",
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
                "/start \\- Show the main menu\n" +
                "/login \\<username\\> \\<password\\> \\- Login as admin \\(the message is deleted\\)\n" +
                "/logout \\- Logout from admin\n" +
                "/stop \\- Stop the running agent or command\n" +
                "/get \\<path\\> \\- Download a file \\(relative to the active project\\)\n" +
                "/help \\- Show this message\n\n" +
                "*Menu \\(Admin only\\):*\n" +
                "💬 Chat with Agent \\- talk to the agy agent; New Chat and Sessions to switch conversations\n" +
                "📂 Projects \\- create, clone, open projects; run commands, ask the agent, git buttons\n" +
                "⚡ Execute Command \\- run shell commands with live output\n" +
                "🖥️ System Info \\- tool versions and workspace\n" +
                "📋 Task History \\- past commands, view output, run again\n" +
                "🤖 Model Selection \\- pick the agy model\n" +
                "📊 Usage Quota Stats \\- counts and agy quota\n\n" +
                "📎 Send a file or photo to save it in the active project\\. In chat mode the agent is told about it\\.",
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
        // Stops the button spinner on paths that did not answer; fails harmlessly if already answered.
        await ctx.answerCallbackQuery().catch(() => {});
    });
});


export default bot;