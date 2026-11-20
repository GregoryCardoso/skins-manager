// Isola os testes do backend/.env do usuário (dotenv não sobrescreve variáveis já definidas).
process.env.DB_PATH = ':memory:';
process.env.PORT = '3001';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.SLOW_ITEM_DAYS = '21';

// Fixtures do catálogo são pequenas: o padrão de validação do download (T36) é relaxado nos testes.
// Os testes da validação passam `validation` explícito (estrito) ou chamam setDefaultCatalogValidation(null).
require('../src/services/catalogService').setDefaultCatalogValidation({
  minRows: {}, maxSkippedRatio: 1, requireSkinShape: false,
});
