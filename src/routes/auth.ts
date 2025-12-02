// routes/auth.ts
// Ruta para loguearse en la API
import { Router, Request, Response } from 'express';
import { getSupabaseClient } from '../lib/supabase';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    //obtengo el email y contraseña que se envian en el body de la peticion
    const { email, password } = req.body;

    console.log(`🔐 Login attempt for: ${email}`);
    console.log(`📝 Password received: ${password}`);

    // Validar que se proporcionen email y contraseña
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    const supabase = getSupabaseClient();
    // Buscar el usuario por email
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

      // Manejo el error si no se encuentra el usuario
    if (error || !user) {
      console.log('❌ User not found:', email);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    console.log(`🔍 User found: ${user.email}`);

    // Verificar la contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log(`✅ Password valid: ${isPasswordValid}`);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    // Generar el token JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email 
      },
      process.env.JWT_SECRET_KEY!,
      { expiresIn: '24h' } // Token expira en 24 horas
    );

    // Devolver el token y la información del usuario (sin la contraseña)
    res.json({
      token,
      usuario: {
        id: user.id,
        email: user.email,
        name: user.name,
        ultimoAcceso: user.ultimoAcceso
      }
    });
  } catch (error) {
    console.error('Error en el login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;