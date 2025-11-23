// routes/auth.ts
import { Router, Request, Response } from 'express';
import { getSupabaseClient } from '../lib/supabase'; // Ajusta la ruta según tu estructura
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
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

    if (error || !user) {
      console.log('❌ User not found:', email);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    console.log(`🔍 User found: ${user.email}`);
    console.log(`🔑 Stored password: ${user.password}`);
    console.log(`🔎 Password starts with $2a$: ${user.password.startsWith('$2a$')}`);
    console.log(`📏 Password length: ${user.password.length}`);

    // Verificar la contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log(`✅ Password valid: ${isPasswordValid}`);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    console.log("jwt_secret: "+ process.env.JWT_SECRET);
    // Generar el token JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email 
      },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' } // Token expira en 24 horas
    );

    // Devolver el token y la información del usuario (sin la contraseña)
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Error en el login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;