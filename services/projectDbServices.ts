import logger from "../core/logger";
import dbContext from "./dbContext";

export const createProject = async (name: string, path: string, createdBy: number, description?: string) => {
    try {
        let project = await dbContext.project.create({
            data: {
                name,
                path,
                createdBy,
                description,
            },
        });

        return {
            success: true,
            message: "Project created successfully",
            data: project,
        };
    } catch (error) {
        logger.error(error, {
            section: "createProject",
        });

        return {
            success: false,
            message: "Failed to create project",
        };
    }
};

export const getProjects = async (userId: number) => {
    try {
        let projects = await dbContext.project.findMany({
            where: {
                createdBy: userId,
            },
            orderBy: {
                updatedAt: "desc",
            },
        });

        return {
            success: true,
            data: projects,
            message: "Projects retrieved",
        };
    } catch (error) {
        logger.error(error, {
            section: "getProjects",
        });

        return {
            success: false,
            message: "Failed to retrieve projects",
        };
    }
};

export const getProjectById = async (id: number) => {
    try {
        let project = await dbContext.project.findUnique({
            where: {
                id,
            },
        });

        if (!project) {
            return {
                success: false,
                message: "Project not found",
            };
        }

        return {
            success: true,
            data: project,
            message: "Project found",
        };
    } catch (error) {
        logger.error(error, {
            section: "getProjectById",
        });

        return {
            success: false,
            message: "Failed to retrieve project",
        };
    }
};

export const deleteProject = async (id: number) => {
    try {
        await dbContext.project.delete({
            where: {
                id,
            },
        });

        return {
            success: true,
            message: "Project deleted successfully",
        };
    } catch (error) {
        logger.error(error, {
            section: "deleteProject",
        });

        return {
            success: false,
            message: "Failed to delete project",
        };
    }
};
