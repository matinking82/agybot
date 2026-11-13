import logger from "../core/logger";
import dbContext from "./dbContext";

// The title is only set when the session is created (first prompt of the conversation).
export const upsertSession = async (userId: number, conversationId: string, title: string, projectPath?: string) => {
    try {
        let session = await dbContext.agentSession.upsert({
            where: {
                userId_conversationId: { userId, conversationId },
            },
            create: {
                userId,
                conversationId,
                title,
                projectPath,
            },
            update: {
                projectPath,
            },
        });

        return { success: true, data: session, message: "Session saved" };
    } catch (error) {
        logger.error(error, {
            section: "upsertSession",
        });

        return { success: false, message: "Failed to save session" };
    }
};

export const getSessions = async (userId: number, take = 10) => {
    try {
        let sessions = await dbContext.agentSession.findMany({
            where: { userId },
            orderBy: { updatedAt: "desc" },
            take,
        });

        return { success: true, data: sessions, message: "Sessions retrieved" };
    } catch (error) {
        logger.error(error, {
            section: "getSessions",
        });

        return { success: false, data: [], message: "Failed to retrieve sessions" };
    }
};

export const getSessionById = async (id: number, userId: number) => {
    try {
        let session = await dbContext.agentSession.findFirst({
            where: { id, userId },
        });

        if (!session) {
            return { success: false, message: "Session not found" };
        }

        return { success: true, data: session, message: "Session retrieved" };
    } catch (error) {
        logger.error(error, {
            section: "getSessionById",
        });

        return { success: false, message: "Failed to retrieve session" };
    }
};
