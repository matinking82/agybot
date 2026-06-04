import { UserState } from "../core/enums";
import logger from "../core/logger";
import dbContext from "./dbContext";

export const isExist = async (userId: number) => {
    try {
        let user = await dbContext.user.findUnique({
            where: {
                Id: userId,
            },
        });

        if (!user) {
            return false;
        }

        return true;

    } catch (error) {
        logger.error(error, {
            section: "isExist",
        })

        return false;
    }
}

export const createUser = async (userId: number) => {
    try {
        let user = await dbContext.user.create({
            data: {
                Id: userId,
                state: UserState.start,
                data: {},
            },
        });

        if (!user) {
            return {
                success: false,
                message: "خطا در ایجاد کاربر",
            };
        }

        return {
            success: true,
            message: "کاربر با موفقیت ایجاد شد",
        };

    } catch (error) {
        logger.error(error, {
            section: "createUser",
        })

        return {
            success: false,
            message: "خطا در ایجاد کاربر",
        };
    }
}

export const getUserById = async (userId: number) => {
    try {
        let user = await dbContext.user.findUnique({
            where: {
                Id: userId,
            },
        });

        if (!user) {
            return;
        }

        //@ts-ignore    
        user.Id = Number(user.Id.toString());

        return user;

    } catch (error) {
        logger.error(error, {
            section: "getUserById",
        })

        return;
    }
};

export const getUserState = async (userId: number) => {
    try {
        let user = await dbContext.user.findUnique({
            where: {
                Id: userId,
            },
        });

        if (!user) {
            return;
        }

        return user.state as UserState;

    } catch (error) {
        logger.error(error, {
            section: "getUserState",
        })

        return;
    }
};

export const setUserState = async (userId: number, state: UserState) => {
    try {
        let user = await dbContext.user.update({
            where: {
                Id: userId,
            },
            data: {
                state: state,
            },
        });

        if (!user) {
            return {
                success: false,
                message: "خطا در تغییر وضعیت شما",
            };
        }

        return {
            success: true,
            message: "وضعیت شما با موفقیت تغییر یافت",
        };

    } catch (error) {
        logger.error(error, {
            section: "setUserState",
        })

        return {
            success: false,
            message: "خطا در تغییر وضعیت شما",
        };
    }
};


export const setUserAdmin = async (userId: number, admin: boolean = true) => {
    try {
        let user = await dbContext.user.update({
            where: {
                Id: userId,
            },
            data: {
                isAdmin: admin,
            },
        });

        if (!user) {
            return {
                success: false,
                message: "خطا در تغییر وضعیت شما",
            };
        }

        return {
            success: true,
            message: "وضعیت شما با موفقیت تغییر یافت",
        };

    } catch (error) {
        logger.error(error, {
            section: "setUsersAdmin",
        })

        return {
            success: false,
            message: "خطا در تغییر وضعیت شما",
        };
    }
};

export const getUserData = async (userId: number) => {
    try {
        let user = await dbContext.user.findUnique({
            where: {
                Id: userId,
            },
        });

        if (!user) {
            return {
                success: false,
                message: "کاربر یافت نشد",
            }
        }

        return {
            success: true,
            data: user.data as any || {},
            message: "اطلاعات کاربر با موفقیت دریافت شد",
        }
    } catch (error) {
        logger.error(error, {
            section: "getUserData",
        })

        return {
            success: false,
            message: "خطا در دریافت اطلاعات کاربر",
        }
    }
}

export const setUserData = async (userId: number, data: any) => {
    try {
        let user = await dbContext.user.update({
            where: {
                Id: userId,
            },
            data: {
                data: data,
            },
        });

        if (!user) {
            return {
                success: false,
                message: "خطا در تغییر اطلاعات کاربر",
            };
        }

        return {
            success: true,
            message: "اطلاعات کاربر با موفقیت تغییر یافت",
        };

    } catch (error) {
        logger.error(error, {
            section: "setUserData",
        })

        return {
            success: false,
            message: "خطا در تغییر اطلاعات کاربر",
        };
    }
}