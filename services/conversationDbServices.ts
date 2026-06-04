import logger from "../core/logger";
import dbContext from "./dbContext";

export const addMessage = async (userId: number, role: string, content: string) => {
    try {
        let message = await dbContext.conversation.create({
            data: {
                userId,
                role,
                content,
            },
        });

        return {
            success: true,
            message: "Message saved",
            data: message,
        };
    } catch (error) {
        logger.error(error, {
            section: "addMessage",
        });

        return {
            success: false,
            message: "Failed to save message",
        };
    }
};

export const getConversationHistory = async (userId: number, limit: number = 50) => {
    try {
        let messages = await dbContext.conversation.findMany({
            where: {
                userId,
            },
            orderBy: {
                createdAt: "desc",
            },
            take: limit,
        });

        return {
            success: true,
            data: messages.reverse(),
            message: "Conversation history retrieved",
        };
    } catch (error) {
        logger.error(error, {
            section: "getConversationHistory",
        });

        return {
            success: false,
            message: "Failed to retrieve conversation history",
        };
    }
};

export const clearConversation = async (userId: number) => {
    try {
        await dbContext.conversation.deleteMany({
            where: {
                userId,
            },
        });

        return {
            success: true,
            message: "Conversation cleared",
        };
    } catch (error) {
        logger.error(error, {
            section: "clearConversation",
        });

        return {
            success: false,
            message: "Failed to clear conversation",
        };
    }
};
