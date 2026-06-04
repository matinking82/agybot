import logger from "../core/logger"
import { comparePassword, hashPassword } from "../core/passwordHelper"
import dbContext from "./dbContext"

export const registerAdmin = async (username: string, password: string) => {
    try {
        let admin = await dbContext.admin.create({
            data: {
                username,
                password: hashPassword(password)
            }
        })

        return {
            success: true,
            message: "admin registered successfully"
        }
    } catch (error) {
        logger.error(error, {
            section: "registeradmin"
        })

        return {
            success: false,
            message: "An error occurred"
        }
    }
}

export const loginAdmin = async (username: string, password: string) => {
    try {
        let admin = await dbContext.admin.findUnique({
            where: {
                username
            }
        })

        if (!admin) {
            return {
                success: false,
                message: "admin not found"
            }
        }

        if (!comparePassword(password, admin.password)) {
            return {
                success: false,
                message: "admin not found"
            }
        }

        return {
            success: true,
            message: "admin logged in successfully",
            admin: admin
        }
    } catch (error) {
        logger.error(error, {
            section: "loginadmin"
        })

        return {
            success: false,
            message: "An error occurred"
        }
    }
}

export const getAdminById = async (id: number) => {
    try {
        let admin = await dbContext.admin.findUnique({
            where: {
                id
            }
        })

        return {
            success: true,
            message: "admin found",
            data: admin
        }
    } catch (error) {
        logger.error(error, {
            section: "getadminById"
        })

        return {
            success: false,
            message: "An error occurred"
        }
    }
}


export const initializeAdmin = async () => {
    try {
        let username = process.env.INITUSERNAME;
        let password = process.env.INITPASSWORD;

        if (!username || !password) {
            return {
                success: false,
                message: "Username or password not provided"
            }
        }

        let adminscount = await dbContext.admin.count();

        if (adminscount > 0) {
            return {
                success: true,
                message: "Admin already exists"
            }
        }

        let result = await registerAdmin(username, password);

        if (!result.success) {
            return {
                success: false,
                message: result.message
            }
        }

        return {
            success: true,
            message: "Admin initialized successfully"
        }
    } catch (error) {
        logger.error(error, {
            section: "initializeAdmin"
        })

        return {
            success: false,
            message: "An error occurred"
        }
    }
}