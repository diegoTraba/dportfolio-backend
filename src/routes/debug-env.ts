// routes/debug-env.ts
import { Router } from 'express';

const router = Router();

router.get('/env-details', (req, res) => {
  const envDetails = {
    // Variables específicas de JWT
    JWT_SECRET: {
      defined: !!process.env.JWT_SECRET_KEY,
      length: process.env.JWT_SECRET_KEY ? process.env.JWT_SECRET_KEY.length : 0,
      value: process.env.JWT_SECRET_KEY ? '***HIDDEN***' : undefined
    },
    
    // Otras variables que deberían estar definidas
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    
    // Variables de Railway
    RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT,
    RAILWAY_SERVICE_NAME: process.env.RAILWAY_SERVICE_NAME,
    RAILWAY_PROJECT_NAME: process.env.RAILWAY_PROJECT_NAME,
    
    // Todas las variables que contienen "JWT" o "SECRET"
    allJwtVars: Object.keys(process.env).filter(key => 
      key.toUpperCase().includes('JWT') || key.toUpperCase().includes('SECRET')
    ).reduce((acc, key) => {
      acc[key] = process.env[key] ? '***DEFINED***' : 'undefined';
      return acc;
    }, {} as Record<string, string>)
  };
  
  res.json(envDetails);
});

export default router;