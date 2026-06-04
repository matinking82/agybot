import { NextFunction, Request, Response } from "express";
import { validateAdminJWT, validateJWT } from "../core/jwtServices";
import { AuthenticatedRequest } from "../interfaces/AuthenticatedRequest";
import { isExist } from "../services/userDbServices";

export const protect = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const bearer = req.headers.authorization;

  if (!bearer) {
    res.status(401);
    res.json({ message: "Not Authorized" });
    return;
  }

  const [, token] = bearer.split(" ");
  if (!token) {
    res.status(401);
    res.json({ message: "Not Authorized" });
    return;
  }

  try {
    const user = validateJWT(token);

    if (!user) {
      res.status(401);
      res.json({ message: "Not valid token" });
      return;
    }

    let check = await isExist(user.id);

    if (!check) {
      res.status(401);
      res.json({ message: "User not found" });
      return;
    }

    req.user = {
      id: user.id,
    };
  } catch (e) {
    res.status(401);
    res.json({ message: "Not valid token" });
    return;
  }

  next();
};



export const protectAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const bearer = req.headers.authorization;

  if (!bearer) {
    res.status(401);
    res.json({ message: "Not Authorized" });
    return;
  }

  const [, token] = bearer.split(" ");
  if (!token) {
    res.status(401);
    res.json({ message: "Not Authorized" });
    return;
  }

  try {
    const user = validateAdminJWT(token);

    if (!user) {
      res.status(401);
      res.json({ message: "Not valid token" });
      return;
    }

    req.user = {
      id: user.id,
    };
  } catch (e) {
    res.status(401);
    res.json({ message: "Not valid token" });
    return;
  }

  next();
};
