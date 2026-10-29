import "dotenv/config";

// Cada archivo de tests de integración usa la base de TEST, pagos simulados y SMTP desactivado.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.PAYMENTS_PROVIDER = "simulado";
process.env.APP_URL = "http://localhost:3000";
process.env.SMTP_HOST = "";
process.env.DB_POOL_LIMIT = "10";
process.env.LOG_LEVEL = "error";
// Credenciales falsas de Mercado Pago: la API se simula con un fetch de prueba.
process.env.MP_ACCESS_TOKEN = "TEST-0000000000000000-000000-token-de-prueba";
process.env.MP_WEBHOOK_SECRET = "secreto-de-prueba";
