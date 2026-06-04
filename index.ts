import dotenv from "dotenv";
dotenv.config();

import bot from "./bot";
import { initializeAdmin } from "./services/adminDbServices";
import logger from "./core/logger";


(async () => {
    // Initialize admin account
    let adminResult = await initializeAdmin();
    logger.info(adminResult.message, { section: "init" });

    // Start bot
    await bot.init();
    console.log("🤖 Bot with username @" + bot.botInfo.username + " is running");
    console.log("📂 Agent workspace: " + (process.env.AGENT_WORKSPACE || "/tmp/agent-workspace"));
    await bot.start();
})();
