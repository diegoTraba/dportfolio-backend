// Ruta para loguearse en la API
import { Router, Request, Response } from 'express';
import { getSupabaseClient } from '../lib/supabase';
import jwt, { JwtPayload } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { servicioUsuario } from '../services/servicioUsuario';

const router = Router();
interface Usuario {
  id: number;
  email: string;
  password:string;
  nombre: string;
  ultimoAcceso: string | null;
}
// Middleware para verificar token (reutilizable)
const verifyToken = (token: string): JwtPayload | null => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET_KEY!) as JwtPayload;
  } catch (error) {
    return null;
  }
};

router.post('/login', async (req: Request, res: Response) => {
  try {
    //obtengo el email y contraseña que se envian en el body de la peticion
    const { email, password } = req.body;

    console.log(`🔐 Login attempt for: ${email}`);

    // Validar que se proporcionen email y contraseña
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    const usuario : Usuario= await servicioUsuario.obtenerUsuarioEmail(email);
    
    // Verificar la contraseña
    const isPasswordValid = await bcrypt.compare(password, usuario.password);
    console.log(`✅ Password valid: ${isPasswordValid}`);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    // Generar el token JWT
    const token = jwt.sign(
      { 
        id: usuario.id, 
        email: usuario.email 
      },
      process.env.JWT_SECRET_KEY!,
      { expiresIn: '2h' } // Token expira en 2 horas
    );

    // Devolver el token y la información del usuario (sin la contraseña)
    res.json({
      token,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        ultimoAcceso: usuario.ultimoAcceso
      }
    });
  } catch (error) {
    console.error('Error en el login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Nuevo endpoint para refrescar el token
router.post('/refresh-token', async (req: Request, res: Response) => {
  try {
    // Obtener el token del header Authorization
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1]; // Formato: Bearer <token>
    if (!token) {
      return res.status(401).json({ error: 'Formato de token inválido' });
    }

    // Verificar el token actual
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    // Buscar el usuario en la base de datos
    const supabase = getSupabaseClient();
    const { data: user, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', decoded.id)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    // Generar un nuevo token JWT
    const newToken = jwt.sign(
      { 
        id: user.id, 
        email: user.email 
      },
      process.env.JWT_SECRET_KEY!,
      { expiresIn: '2h' } // Nuevo token con 2 horas de expiración
    );

    // Devolver el nuevo token
    res.json({
      token: newToken,
      usuario: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        ultimoAcceso: user.ultimoAcceso
      }
    });
  } catch (error) {
    console.error('Error al refrescar el token:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;