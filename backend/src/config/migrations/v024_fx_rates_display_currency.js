'use strict';

// Migração 24 (D369, Adendo 1, subetapa 11.2): cotações por moeda e moeda de conversão.
// - `fx_rates`: uma linha por moeda que não é USD, com a cotação "unidades da moeda por 1 US$" (a mesma semântica de hoje para o BRL).
//   A cotação do BRL (valor, origem, data da cotação, data da gravação e a fonte do "atualizar cotação") é COPIADA de `settings`; as
//   colunas antigas ficam sem uso (nada é apagado). A linha do BRL é criada sempre que a linha de `settings` existe, mesmo sem cotação,
//   porque ela guarda a fonte do botão "atualizar cotação".
// - `settings.display_currency`: a "moeda de conversão" (o "≈"). O padrão da coluna é USD (instalação nova, sem "≈"). Um banco que já
//   existia antes desta migração (versão inicial >= 1) recebe BRL, para a tela continuar igual à de hoje (A2). O critério é o mesmo
//   do backup automático (`backupBeforeMigrating`): `current >= 1` em `runMigrations`, repassado como `initialVersion`.
// Só se acrescentam tabela e coluna: nenhum valor existente é regravado ou convertido. Migração publicada nunca é editada (D69).
const SQL = `
CREATE TABLE fx_rates (
  currency TEXT PRIMARY KEY CHECK (length(currency) = 3 AND currency = upper(currency) AND currency <> 'USD'),
  rate REAL NULL CHECK (rate IS NULL OR rate > 0),
  source TEXT NULL CHECK (source IS NULL OR source IN ('MANUAL','PTAX','AWESOMEAPI')),
  refresh_source TEXT NOT NULL DEFAULT 'AWESOMEAPI' CHECK (refresh_source IN ('AWESOMEAPI','PTAX')),
  quoted_at TEXT NULL,
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO fx_rates (currency, rate, source, refresh_source, quoted_at, updated_at)
  SELECT 'BRL', usd_brl_rate, usd_brl_rate_source, fx_refresh_source, rate_quoted_at, COALESCE(usd_brl_rate_updated_at, updated_at)
  FROM settings WHERE id = 1;
ALTER TABLE settings ADD COLUMN display_currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(display_currency) = 3);
`;

module.exports = {
  version: 24,
  name: 'fx_rates_display_currency',
  up(db, { initialVersion = 0 } = {}) {
    db.exec(SQL);
    if (initialVersion >= 1) db.prepare("UPDATE settings SET display_currency = 'BRL'").run();
    const settingsRows = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
    const brlRows = db.prepare("SELECT COUNT(*) AS n FROM fx_rates WHERE currency = 'BRL'").get().n;
    if (brlRows !== settingsRows) throw new Error('Migração 24: a cópia da cotação do BRL perdeu linhas.');
  },
};
