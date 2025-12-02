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

// Ruta actualizar último acceso
router.post('/actulizarUltimoAcceso', async (req: Request, res: Response) => {
  try {
    console.log('🚪 Procesando cierre de sesión...');

    // Obtener el token del header Authorization
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ Token no proporcionado en el header');
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
      console.log('❌ Formato de token inválido');
      return res.status(401).json({ error: 'Formato de token inválido' });
    }

    console.log('🔑 Token recibido para cierre de sesión');

    // Verificar y decodificar el token JWT
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET_KEY!);
      console.log(`✅ Token verificado para usuario: ${decodedToken.email}`);
    } catch (error) {
      console.error('❌ Error verificando token:', error);
      // Aún así intentamos actualizar la fecha si tenemos el userId en el body
      console.log('⚠️ Token inválido, intentando con userId del body...');
    }

    // Obtener userId del token decodificado o del body
    const userId = decodedToken?.id || req.body.userId;

    if (!userId) {
      console.log('❌ No se pudo obtener el ID del usuario');
      return res.status(400).json({ error: 'ID de usuario no proporcionado' });
    }

    console.log(`👤 Actualizando último acceso para usuario ID: ${userId}`);

    const supabase = getSupabaseClient();
    
    // Actualizar el campo últimoAcceso en la tabla users
    const { error: updateError } = await supabase
      .from('users')
      .update({ 
        ultimoAcceso: new Date().toISOString() 
      })
      .eq('id', userId);

    if (updateError) {
      console.error('❌ Error al actualizar último acceso:', updateError);
      return res.status(500).json({ 
        error: 'Error al actualizar último acceso',
        details: updateError.message 
      });
    }

    console.log(`✅ Último acceso actualizado para usuario ID: ${userId}`);
    
    // Opcional: Podrías invalidar el token aquí si implementas una blacklist
    // Pero con JWT stateless, simplemente el cliente eliminará el token

    res.json({
      success: true,
      message: 'Sesión cerrada y último acceso actualizado correctamente',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('💥 Error inesperado en logout:', error);
    res.status(500).json({ 
      error: 'Error interno del servidor al cerrar sesión',
      details: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
});

export default router;