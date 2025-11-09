// lib/encryption.ts
import CryptoJS from 'crypto-js'

export function encrypt(text: string): string {
  const encryptionKey = process.env.ENCRYPTION_KEY
  
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY no está definida en las variables de entorno')
  }
  
  return CryptoJS.AES.encrypt(text, encryptionKey).toString()
}

export function decrypt(encryptedText: string): string {
  const encryptionKey = process.env.ENCRYPTION_KEY
  
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY no está definida en las variables de entorno')
  }
  
  const bytes = CryptoJS.AES.decrypt(encryptedText, encryptionKey)
  const result = bytes.toString(CryptoJS.enc.Utf8)
  
  if (!result) {
    throw new Error('Error al desencriptar el texto')
  }
  
  return result
}