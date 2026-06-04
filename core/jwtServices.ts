import jwt from "jsonwebtoken";

let JWT_SECRET = process.env.JWT_SECRET ?? "secret";

export function generateJWT(user: { id: number; }) {
  if (!user || !user.id) return;
  let payload = {
    id: user.id,
  };
  let token = jwt.sign(payload, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "48h",
  });
  return token;
}

export function validateJWT(token: string) {
  try {
    let result = jwt.verify(token, JWT_SECRET);
    return result as { id: number; };
  } catch (error) {
    return null;
  }
}



export function generateJWTForAdmin(user: { id: number; }) {
  if (!user || !user.id) return;
  let payload = {
    id: user.id,
  };
  let token = jwt.sign(payload, JWT_SECRET + JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "48h",
  });
  return token;
}

export function validateAdminJWT(token: string) {
  try {
    let result = jwt.verify(token, JWT_SECRET + JWT_SECRET);
    return result as { id: number; };
  } catch (error) {
    return null;
  }
}
