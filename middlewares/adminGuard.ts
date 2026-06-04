import { Context, NextFunction } from "grammy";
import logger from "../core/logger";
import { getUserById } from "../services/userDbServices";

export const adminGuard = async (userId: number): Promise<boolean> => {
    try {
        let user = await getUserById(userId);

        if (!user) {
            return false;
        }

        return user.isAdmin === true;
    } catch (error) {
        logger.error(error, {
            section: "adminGuard",
        });

        return false;
    }
};

export const requireAdmin = async (ctx: Context, next: NextFunction) => {
    let userId = ctx.from?.id;

    if (!userId) {
        return;
    }

    let isAdmin = await adminGuard(userId);

    if (!isAdmin) {
        await ctx.reply("⛔ Access denied. Admin privileges required.\n\nUse /login <username> <password> to authenticate.");
        return;
    }

    return next();
};
