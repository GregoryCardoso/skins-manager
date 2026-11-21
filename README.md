# Skins Manager

Aplicativo pessoal e local para controlar o inventário e o giro de itens de CS2: custo, preço mínimo de venda
por loja (já considerando as taxas), itens parados há muito tempo, vendas e lucro. Cada instalação tem o próprio
banco de dados; não há login nem servidor central.

<!-- Prints da interface: coloque as imagens em assets/screenshots/ e referencie aqui.
![Inventário](assets/screenshots/inventario.png)
![Vendas](assets/screenshots/vendas.png)
-->

## Instalar no Windows

Esta é a forma mais simples de usar o Skins Manager: não precisa instalar o Node.js nem usar o terminal.

### 1. Baixar

Baixe **somente** pela página oficial de Releases: <https://github.com/GregoryCardoso/skins-manager/releases>
(abra a versão mais recente e, em "Assets", baixe o arquivo). Não use cópias de outros sites.

| Arquivo | O que é |
| --- | --- |
| `SkinsManager-Setup-<versão>.exe` | **Instalador** (recomendado) |
| `SkinsManager-Portable-<versão>.exe` | **Portátil**: um único `.exe`, sem instalar |

Os outros arquivos da release (`latest.yml` e `.blockmap`) são usados pela atualização automática; você não precisa deles.

### 2. Aviso do Windows (SmartScreen)

Ao abrir o instalador, o Windows pode mostrar "O Windows protegeu o computador". Clique em **Mais informações**
e depois em **Executar assim mesmo**. Isso acontece porque o app não tem assinatura digital paga, não porque tem
vírus. O aviso vale para o instalador **e também para o portátil**. Baixe só da página oficial de releases do GitHub.
O aviso pode voltar a cada versão nova.

### 3. Instalador ou portátil

| | Instalador | Portátil |
| --- | --- | --- |
| Instala no Windows (sem pedir administrador; você escolhe a pasta) | sim | não |
| Atalho na área de trabalho e no menu Iniciar | sim | não |
| Atualização automática | sim (sempre pergunta antes) | não: o app só avisa da versão nova e abre a página de download |
| Abertura | normal | mais lenta (o app se extrai numa pasta temporária a cada abertura) |
| Onde ficam os dados | `%APPDATA%\SkinsManager` | `%APPDATA%\SkinsManager` (os mesmos) |

### 4. Onde ficam os dados e os backups

Tudo fica na pasta `%APPDATA%\SkinsManager` (normalmente `C:\Users\<seu usuário>\AppData\Roaming\SkinsManager`),
a mesma no instalador, no portátil e no `start-app.bat`:

- `inventory.sqlite`: seu banco de dados;
- `backups\`: cópias automáticas;
- `logs\`: registros do app desktop (só para diagnóstico).

Em **Configurações → Backup** há o botão **Abrir pasta** (abre a pasta de backups no Explorador de Arquivos) e
**Copiar caminho**.

### 5. Como fazer backup

Em **Configurações → Backup**:

- **Exportar backup** gera um arquivo com todos os seus dados. Guarde-o em lugar seguro e não o compartilhe: ele contém
  seus dados pessoais (itens, valores, lojas e configurações).
- **Importar backup** (**Escolher arquivo de backup** e depois **Substituir meus dados**) troca TODOS os dados atuais
  pelos do arquivo. Uma cópia dos dados atuais é salva antes, na pasta de backups.
- O app também faz cópias automáticas na pasta `backups` antes de importar um backup e antes de atualizar o banco
  para uma versão nova do app. Ficam os 10 mais recentes de cada tipo.

### 6. Como atualizar

- **Instalador:** cerca de 10 segundos depois de abrir, o app procura versão nova (também pelo botão
  **Verificar atualizações** em Configurações → Sobre). Se houver, aparece uma janela com as novidades:
  1. **Baixar e instalar** ou **Agora não** (nesse caso ele pergunta de novo na próxima vez que você abrir o app);
  2. depois do download: **Reiniciar agora** ou **Instalar ao fechar o app**. Fechar essa janela sem escolher (no X)
     equivale a **Instalar ao fechar o app**.

  Nada é baixado ou instalado sem a sua resposta, e seus dados não são alterados.
- **Portátil:** o app avisa da versão nova e o botão **Abrir página de download** leva à página da release. Baixe o novo
  `.exe` e use-o no lugar do antigo (os dados continuam em `%APPDATA%\SkinsManager`).
- **Código-fonte (`start-app.bat`):** não verifica versão. Atualize com `git pull` ou baixe o código novo do
  repositório e rode o `start-app.bat` de novo.

### 7. Desinstalar sem perder os dados

Desinstale em **Configurações do Windows → Aplicativos** (instalador) ou apague o `.exe` (portátil). Desinstalar
**não apaga** `%APPDATA%\SkinsManager`: se instalar de novo, seus dados continuam lá. Para apagar tudo de vez, exclua
essa pasta manualmente (faça um backup antes, se quiser guardar algo).

### 8. Não abra o desktop e o `start-app.bat` ao mesmo tempo

Os dois usam a mesma pasta de dados e só um pode ficar com ela aberta. O que acontece depende da ordem:

- **App desktop aberto e depois o `start-app.bat`:** o `start-app.bat` percebe que o app já está respondendo, avisa
  "O Skins Manager já está aberto pelo app desktop." e só abre o navegador nele (não sobe um segundo servidor). Se o
  desktop estiver numa porta diferente da configurada no `backend/.env` (ele escolhe outra quando a 3001 está ocupada),
  o `start-app.bat` tenta subir o servidor e é recusado com o mesmo aviso.
- **`start-app.bat` aberto e depois o app desktop:** o desktop avisa que o Skins Manager já está aberto e oferece abrir
  o que já está rodando. Feche a janela do `start-app.bat` antes, se preferir usar o desktop.
- **Portátil e instalador abertos ao mesmo tempo:** os dois são o mesmo app para o Windows; o segundo só traz a janela
  que já está aberta para a frente (não abre outra).

**Travada depois de uma queda de energia ou de fechar à força?** A pasta de dados tem um arquivo de trava
(`skins-manager.lock`). O app já descarta sozinho a trava de um programa que não está mais rodando, mas, se mesmo assim
ele disser que a pasta está em uso e você tem certeza de que o Skins Manager está fechado, apague o arquivo
`%APPDATA%\SkinsManager\skins-manager.lock` e abra de novo. Seus dados não ficam nesse arquivo.

### 9. Vindo do `start-app.bat` antigo

Versões antigas guardavam os dados em `backend\data\`. **Só o `start-app.bat` novo migra esses dados**: na primeira
abertura ele os **copia uma única vez** para `%APPDATA%\SkinsManager`; os arquivos originais de `backend\data\` não são
apagados. O **app desktop não migra** `backend\data\`. Para trazer seus dados antigos para o desktop, faça uma destas
duas coisas:

1. rode o `start-app.bat` novo **uma vez, antes** de abrir o app desktop (ele faz a cópia; depois feche-o); ou
2. na versão antiga use **Exportar backup** e, no app desktop, **Importar backup**.

## Rodar pelo código-fonte

Para quem prefere rodar o código ou quer desenvolver.

### Requisitos

- Windows 10 ou mais novo
- [Node.js](https://nodejs.org) 20 ou mais novo (versão LTS; já inclui o npm)
- Não precisa de compilador C++: o `better-sqlite3` usa binário pronto.

### Instalação

```powershell
npm.cmd run install:all
```

> **PowerShell:** se aparecer o erro de que `npm.ps1` não pode ser carregado (política de execução), use
> `npm.cmd` no lugar de `npm` (como nos exemplos) ou libere para o seu usuário com
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### Como rodar

#### Uso diário

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

#### App desktop (desenvolvimento)

Na raiz do projeto, uma vez: `npm.cmd run desktop:install` (instala as dependências da pasta `desktop/`).

```powershell
npm.cmd run desktop:install   # instala as dependências do desktop (Electron e electron-builder)
npm.cmd run desktop:dev       # monta o app e abre a janela do Electron (sem instalador)
npm.cmd run desktop:stage     # só monta a pasta desktop/.stage (backend + interface compilada)
npm.cmd run desktop:dist      # gera o instalador e o portátil em desktop/dist (sem publicar)
```

O ícone do app é gerado a partir de um arquivo da pasta `desktop/build`; veja [desktop/build/LEIA-ME.md](desktop/build/LEIA-ME.md).

#### Desenvolvimento

```powershell
npm.cmd run dev        # interface em http://localhost:3000 e API em http://localhost:3001
npm.cmd run dev:demo   # igual, com o banco de exemplo (inventory.dev.sqlite)
```

### Testes

```powershell
npm.cmd test                          # backend (Jest) + frontend (Vitest)
npm.cmd run test:desktop              # app desktop (Jest)
npm.cmd run test:all                  # tudo
npm.cmd run test:backend
npm.cmd run test:frontend
npm.cmd --prefix frontend run typecheck
```

### Estrutura

```
backend/    API Express + SQLite (MVC + services); também serve a interface compilada
frontend/   Next.js (exportação estática, TypeScript)
desktop/    app desktop (Electron), empacotamento e publicação
scripts/    auxiliares do start-app.bat e da versão
assets/     imagens para o README
docs/       especificação e decisões (não versionado)
```

### Configuração técnica (opcional)

`backend/.env` (modelo em `backend/.env.example`): `PORT` (padrão 3001), `DB_PATH`, `CORS_ORIGIN` e
`SLOW_ITEM_DAYS` (padrão 21). Taxas, cotação e demais preferências pessoais são configuradas pela interface.

### Onde ficam os dados (código-fonte)

- Banco, backups e logs: `%APPDATA%\SkinsManager` (veja "Instalar no Windows", item 4). `DB_PATH` no `backend/.env`
  só serve para desenvolvimento e testes.
- Dados antigos de `backend/data/` são copiados uma única vez para a pasta nova (pelo `start-app.bat`; o app desktop não faz essa cópia), sem apagar o original.
- Banco de exemplo do modo `dev:demo`: `backend/data/inventory.dev.sqlite` (separado dos seus dados reais).
- As lojas iniciais são criadas na primeira execução e recriadas se a tabela de lojas ficar vazia.

## Publicar uma nova versão (mantenedor)

As versões saem no GitHub Releases pelo comando `npm run desktop:release`, que cria **um rascunho** com os arquivos;
você revisa e publica.

**Pré-requisito:** `npm run desktop:install` (instala as dependências do desktop, incluindo o electron-builder).

1. **Definir a versão** (atualiza os quatro `package.json` e os `package-lock.json` correspondentes: raiz, backend, frontend e desktop):

   ```powershell
   npm.cmd run version:set -- 1.0.1
   ```

   O formato é só `x.y.z` (sem `v` e sem sufixos). Regras: **MAJOR** para mudança que exija ação do usuário,
   **MINOR** para funcionalidade nova, **PATCH** para correção. A versão do app é independente da versão do esquema
   do banco.
2. **Commit e push** na branch principal. O rascunho é criado apontando para o commit atual (HEAD) e o GitHub cria a tag
   `v<versão>` nele ao publicar; por isso o commit e o push vêm **antes**.
3. **Definir o token do GitHub só na sessão do terminal** (nunca grave o token em arquivo). Serve um token clássico
   com o escopo `repo` ou um token fine-grained restrito ao repositório `skins-manager` com a permissão
   **Contents: Read and write**. No **CMD**:

   ```bat
   set GH_TOKEN=seu_token
   ```

   No PowerShell: `$env:GH_TOKEN = "seu_token"`. A variável vale só naquela janela.
4. **Gerar o rascunho** (no CMD, na raiz do projeto):

   ```bat
   npm run desktop:release
   ```

   Antes de tudo o script confere o Git: se houver mudanças rastreadas sem commit, ou se o commit atual ainda não
   estiver no GitHub, ele recusa (faça o commit e o push). O rascunho aponta para esse commit. Depois o script roda os testes, monta o app, empacota (sem publicar) e cria o rascunho `v<versão>` enviando os arquivos.
5. **Revisar no GitHub** (Releases → rascunho): confira `SkinsManager-Setup-<versão>.exe`,
   `SkinsManager-Portable-<versão>.exe`, `latest.yml` e o `.blockmap` do instalador; escreva as notas da versão (elas
   aparecem na janela de atualização) e clique em **Publish release**.

**Se der erro:**

- O script **recusa** se já existir release ou rascunho com a mesma tag. Se for um rascunho seu que não foi publicado,
  apague-o no GitHub e rode de novo; se a versão já foi publicada, aumente a versão (`version:set`).
- Se falhar **no meio** (por exemplo, no envio dos arquivos), nada foi publicado: apague o rascunho incompleto no GitHub
  e rode `npm run desktop:release` de novo.
- Sem `GH_TOKEN` o script para antes de qualquer passo.

## Uso e contribuições

- O código é visível, mas **todos os direitos reservados**: o projeto não adota licença open source e não há arquivo `LICENSE`.
- **Uso pessoal é livre** para qualquer pessoa.
- O download oficial é **somente** pelas [Releases](https://github.com/GregoryCardoso/skins-manager/releases) deste repositório.
- Sugestões e bugs: abra uma [Issue](https://github.com/GregoryCardoso/skins-manager/issues) (há modelos em português e
  inglês). **Pull requests não são aceitos no momento.**

## Créditos

Catálogo e imagens dos itens vêm da [CSGO-API](https://github.com/ByMykel/CSGO-API), de ByMykel.
Este projeto não tem afiliação com a Valve.
