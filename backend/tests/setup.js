// Isola os testes do backend/.env do usuário (dotenv não sobrescreve variáveis já definidas).
process.env.DB_PATH = ':memory:';
process.env.PORT = '3001';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.SLOW_ITEM_DAYS = '21';
