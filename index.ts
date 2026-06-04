import dotenv from "dotenv";
dotenv.config();

import bot from "./bot";
import app from "./server";


const PORT = process.env.PORT || 8080;

(async () => {
    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });

    await bot.init();
    console.log("Bot with username @" + bot.botInfo.username + " is running");
    await bot.start();
})();
