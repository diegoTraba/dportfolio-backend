// scripts/generate-secret.js
const crypto = require('crypto');

// Genera una clave segura de 64 bytes (512 bits)
const secret = crypto.randomBytes(64).toString('hex');
console.log('JWT_SECRET=', secret);