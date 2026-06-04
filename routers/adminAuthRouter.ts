import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { generateJWTForAdmin } from '../core/jwtServices';
import { protectAdmin, } from '../middlewares/auth';
import { AuthenticatedRequest } from '../interfaces/AuthenticatedRequest';
import { loginAdmin, registerAdmin } from '../services/adminDbServices';

let router = express.Router();

let registerAdminValidator = [
    body('username').isString(),
    body('password').isString(),
]
router.post('/register', protectAdmin, registerAdminValidator, async (req: Request, res: Response) => {
    // #swagger.tags = ['Admin Auth']
    // #swagger.description = 'Endpoint to register a new admin'
    let error = validationResult(req);
    if (!error.isEmpty()) {
        res.status(400).json({ error: error.array() });
        return
    }

    let { username, password } = req.body;

    let result = await registerAdmin(username, password);

    if (!result.success) {
        res.status(400).json({ message: result.message });
        return
    }

    res.status(200).json({ message: result.message });
    return
});


let loginAdminValidator = [
    body('username').isString(),
    body('password').isString(),
]

router.post('/login', loginAdminValidator, async (req: Request, res: Response) => {
    // #swagger.tags = ['Admin Auth']
    // #swagger.description = 'Endpoint to login an admin'
    let error = validationResult(req);
    if (!error.isEmpty()) {
        res.status(400).json({ error: error.array() });
        return
    }

    let { username, password } = req.body;

    let result = await loginAdmin(username, password);

    if (!result.success) {
        res.status(400).json({ message: result.message });
        return
    }

    let token = generateJWTForAdmin({ id: result.admin.id });

    res.json({
        message: "User logged in successfully",
        token,
        token_type: "Bearer"
    });
    return
});

router.get('/validate', protectAdmin, async (req: AuthenticatedRequest, res: Response) => {
    // #swagger.tags = ['Admin Auth']
    // #swagger.description = 'Endpoint to validate an admin'
    res.json({
        message: "Admin is authenticated",
        user: req.user
    })
    return
});

export default router;