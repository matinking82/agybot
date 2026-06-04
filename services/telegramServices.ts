import bot from "../bot";
import logger from "../core/logger";


export const getTelegramUserInformation = async (userId: number) => {
    try {
        let user = await bot.api.getChat(userId);

        return {
            id: user.id,
            username: user.username,
            first_name: user.first_name,
            last_name: user.last_name,
        };
    } catch (error) {
        logger.error(error, {
            section: "getTelegramUserInformation",
        });

        return null;
    }
};

export const sendTelegramMessage = async (userId: number, message: string) => {
    try {
        await bot.api.sendMessage(userId, message);

        return true;
    } catch (error) {
        logger.error(error, {
            section: "sendTelegramMessage",
        });

        return false;
    }
};