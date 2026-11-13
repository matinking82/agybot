import logger from "../core/logger";
import dbContext from "./dbContext";

export const createTask = async (userId: number, command: string, projectId?: number) => {
    try {
        let task = await dbContext.agentTask.create({
            data: {
                userId,
                command,
                projectId,
                status: "pending",
            },
        });

        return {
            success: true,
            message: "Task created",
            data: task,
        };
    } catch (error) {
        logger.error(error, {
            section: "createTask",
        });

        return {
            success: false,
            message: "Failed to create task",
        };
    }
};

export const updateTaskStatus = async (id: number, status: string, output?: string, error?: string) => {
    try {
        let task = await dbContext.agentTask.update({
            where: {
                id,
            },
            data: {
                status,
                output,
                error,
                completedAt: ["completed", "failed"].includes(status) ? new Date() : undefined,
            },
        });

        return {
            success: true,
            message: "Task updated",
            data: task,
        };
    } catch (error) {
        logger.error(error, {
            section: "updateTaskStatus",
        });

        return {
            success: false,
            message: "Failed to update task",
        };
    }
};

export const getTasksByUser = async (userId: number, limit: number = 10) => {
    try {
        let tasks = await dbContext.agentTask.findMany({
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
            data: tasks,
            message: "Tasks retrieved",
        };
    } catch (error) {
        logger.error(error, {
            section: "getTasksByUser",
        });

        return {
            success: false,
            message: "Failed to retrieve tasks",
        };
    }
};

// Filters on userId too, so one admin cannot read another's task by guessing an id.
export const getTaskById = async (id: number, userId: number) => {
    try {
        let task = await dbContext.agentTask.findFirst({
            where: {
                id,
                userId,
            },
        });

        if (!task) {
            return {
                success: false,
                message: "Task not found",
            };
        }

        return {
            success: true,
            data: task,
            message: "Task retrieved",
        };
    } catch (error) {
        logger.error(error, {
            section: "getTaskById",
        });

        return {
            success: false,
            message: "Failed to retrieve task",
        };
    }
};

export const getUsageCounts = async (userId: number) => {
    try {
        let [projects, tasks, messages] = await Promise.all([
            dbContext.project.count({ where: { createdBy: userId } }),
            dbContext.agentTask.count({ where: { userId } }),
            dbContext.conversation.count({ where: { userId } }),
        ]);

        return { success: true, data: { projects, tasks, messages }, message: "Counts retrieved" };
    } catch (error) {
        logger.error(error, {
            section: "getUsageCounts",
        });

        return { success: false, data: { projects: 0, tasks: 0, messages: 0 }, message: "Failed to retrieve counts" };
    }
};
