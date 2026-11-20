# Skins Manager

Aplicativo pessoal e local para controlar o inventário e o giro de itens de CS2: custo, preço mínimo de venda
por loja (já considerando as taxas), itens parados há muito tempo, vendas e lucro. Cada instalação tem o próprio
banco de dados; não há login nem servidor central.

<!-- Prints da interface: coloque as imagens em assets/screenshots/ e referencie aqui.
![Inventário](assets/screenshots/inventario.png)
![Vendas](assets/screenshots/vendas.png)
-->

## Requisitos

- Windows 10 ou mais novo
- [Node.js](https://nodejs.org) 20 ou mais novo (versão LTS; já inclui o npm)
- Não precisa de compilador C++: o `better-sqlite3` usa binário pronto.

## Instalação

```powershell
npm.cmd run install:all
```

> **PowerShell:** se aparecer o erro de que `npm.ps1` não pode ser carregado (política de execução), use
> `npm.cmd` no lugar de `npm` (como nos exemplos) ou libere para o seu usuário com
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Como rodar

### Uso diário

Dê dois cliques em `start-app.bat` ou rode:

```powershell
npm.cmd start
```

O app compila a interface e sobe tudo em <http://localhost:3001> (interface e API na mesma porta; o navegador
abre sozinho com o `.bat`). Para fechar, feche a janela do terminal.

- `start-app.bat` instala as dependências na primeira vez, só recompila a interface quando o código mudou e,
  se o app já estiver aberto, apenas abre o navegador.
- `npm.cmd start` sempre recompila. `npm.cmd run serve` sobe sem recompilar.
- O servidor escuta somente em `127.0.0.1`: outros aparelhos da rede não acessam o app.

### Desenvolvimento

```powershell
npm.cmd run dev        # interface em http://localhost:3000 e API em http://localhost:3001
npm.cmd run dev:demo   # igual, com o banco de exemplo (inventory.dev.sqlite)
```

## Testes

```powershell
npm.cmd test                          # backend (Jest) + frontend (Vitest)
npm.cmd run test:backend
npm.cmd run test:frontend
npm.cmd --prefix frontend run typecheck
```

## Estrutura

```
backend/    API Express + SQLite (MVC + services); também serve a interface compilada
frontend/   Next.js (exportação estática, TypeScript)
scripts/    auxiliares do start-app.bat
assets/     imagens para o README
docs/       especificação e decisões (não versionado)
```

## Configuração técnica (opcional)

`backend/.env` (modelo em `backend/.env.example`): `PORT` (padrão 3001), `DB_PATH`, `CORS_ORIGIN` e
`SLOW_ITEM_DAYS` (padrão 21). Taxas, cotação e demais preferências pessoais são configuradas pela interface.

## Onde ficam os dados

- Banco: `backend/data/inventory.sqlite` (pessoal, fora do Git).
- Backups automáticos antes de migrações do banco: `backend/data/backups/`.
- Banco de exemplo do modo `dev:demo`: `backend/data/inventory.dev.sqlite`.
- Para copiar seus dados para outro lugar, feche o app e copie a pasta `backend/data/`. Exportar e importar
  backup pela interface virá em uma etapa futura.
- As lojas iniciais são criadas na primeira execução e recriadas se a tabela de lojas ficar vazia.

## Créditos

Catálogo e imagens dos itens vêm da [CSGO-API](https://github.com/ByMykel/CSGO-API), de ByMykel.
Este projeto não tem afiliação com a Valve.
