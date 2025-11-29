// middleware/auth.ts
//esta clase sirve para exigir la autenticacion en las rutas de los endpoints
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Extiende la interfaz Request de Express
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
      };
    }
  }
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Token de acceso requerido' });
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET_KEY, (err, user) => {
      if (err) {
        return res.sendStatus(403);
      }
      req.user = user;
      next();
    });
  } catch (error) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
};