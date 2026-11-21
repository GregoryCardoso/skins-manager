# Skins Manager

Controle o seu inventário de skins de CS2: quanto pagou, por quanto vender sem prejuízo e o que está parado há tempo demais.
*Keep track of your CS2 skins: what you paid, the lowest price that still avoids a loss, and what has been sitting too long.*

**[Português](#pt) · [English](#en)**

---

<a id="pt"></a>

## Português

### O que o app faz

- **Inventário com o catálogo do jogo:** escolha o item numa lista com nome e imagem, sem digitar tudo à mão.
- **Float, pattern e fase:** guarde os detalhes de cada skin (incluindo a fase das Doppler e Gamma Doppler).
- **Preço mínimo sem prejuízo:** para cada loja, o app calcula o menor preço de venda que ainda cobre o que você pagou, já descontando a taxa da loja.
- **Trade lock:** veja quais itens ainda estão bloqueados e quando são liberados.
- **Giro dos itens:** o app mostra o que vende rápido, o que está em giro normal e o que está "agarrado" (parado há muitos dias). Você escolhe os limites.
- **Vendas e histórico:** registre cada venda e veja o lucro, o tempo médio até vender e o preço médio de cada item.
- **Lojas configuráveis:** cadastre as lojas que você usa, com a moeda e as taxas de cada uma.
- **Cotação do dólar:** digite a cotação ou atualize com um clique (comercial em tempo real ou PTAX do Banco Central).
- **Backup:** exporte uma cópia de todos os seus dados e restaure quando precisar.
- **Tema claro ou escuro** e **português ou inglês**.
- **Atualização automática** (na versão instalada), sempre perguntando antes.

<!-- Prints e GIF: adicionar na Etapa 10, em assets/screenshots/ -->
> 📷 *Espaço reservado para imagens do app (`assets/screenshots/`).*

### Como usar

Existem duas formas. Os seus dados são os mesmos nas duas.

#### Opção 1: app para Windows (recomendado)

Não precisa instalar mais nada.

1. Abra a página da versão mais recente: <https://github.com/GregoryCardoso/skins-manager/releases/latest>
2. Em **Assets**, baixe **um** destes arquivos:

   | Arquivo | Para quem |
   | --- | --- |
   | `SkinsManager-Setup-<versão>.exe` | **Instalador (recomendado).** Instala o app, cria atalho na área de trabalho e no menu Iniciar e se atualiza sozinho (sempre perguntando antes). Não pede senha de administrador. |
   | `SkinsManager-Portable-<versão>.exe` | **Portátil.** Não instala nada: é só dar dois cliques no arquivo. Demora um pouco mais para abrir e não se atualiza sozinho; ele só avisa quando sai uma versão nova. |

   Os outros arquivos da página (`latest.yml` e `.blockmap`) são usados pela atualização automática. Você não precisa deles.
3. Dê dois cliques no arquivo baixado.
4. **Se aparecer "O Windows protegeu o computador":** clique em **Mais informações** e depois em **Executar assim mesmo**.
   Esse aviso aparece porque o app não tem uma assinatura digital paga, não porque tem vírus. Ele pode voltar a cada versão nova.
   Baixe o app **somente** pela página oficial acima, nunca de outros sites.

#### Opção 2: no navegador, pelo código

Para quem prefere usar o app numa aba do navegador.

1. Instale o **Node.js**, versão **LTS**, em <https://nodejs.org> (é só seguir o instalador com as opções padrão).
2. Na página da versão mais recente (<https://github.com/GregoryCardoso/skins-manager/releases/latest>), em **Assets**, baixe o **Source code (zip)**.
3. Clique com o botão direito no arquivo baixado e escolha **Extrair tudo**. Escolha uma pasta fixa (por exemplo, `Documentos`).
4. Abra a pasta extraída e dê dois cliques em **`start-app.bat`**.
   - Na primeira vez, ele baixa o que precisa e prepara o app. Isso exige internet e pode levar alguns minutos.
   - Depois, o app abre sozinho no navegador.
5. Para fechar o app, feche a janela preta do `start-app.bat`.

> Não abra o app para Windows e o `start-app.bat` ao mesmo tempo: os dois usam os mesmos dados, e só um pode ficar aberto.

### Seus dados

- Ficam **só no seu computador**. Nada é enviado para a internet nem para outra pessoa.
- A pasta é `%APPDATA%\SkinsManager` (normalmente `C:\Users\<seu usuário>\AppData\Roaming\SkinsManager`). As duas formas de uso, o instalador e o portátil, usam essa mesma pasta.
- **Fazer backup:** em **Configurações → Backup**, clique em **Exportar backup**. Guarde o arquivo num lugar seguro (um pen drive ou a nuvem, por exemplo) e não o compartilhe: ele contém todos os seus dados.
- **Restaurar:** em **Configurações → Backup**, clique em **Escolher arquivo de backup** e depois em **Substituir meus dados**. Antes de trocar, o app guarda uma cópia dos dados atuais.
- O app também faz cópias automáticas antes de importar um backup e antes de atualizar os dados para uma versão nova. O botão **Abrir pasta**, em **Configurações → Backup**, mostra onde elas ficam.
- **Desinstalar não apaga os seus dados.** Se instalar de novo, tudo continua lá. Para apagar tudo de vez, exclua a pasta `%APPDATA%\SkinsManager` (faça um backup antes, se quiser guardar algo).

### Atualização

Você vê a sua versão em **Configurações → Sobre**.

- **Instalador:** alguns segundos depois de abrir, o app procura uma versão nova. Também dá para procurar pelo botão **Verificar atualizações**, em **Configurações → Sobre**. Se houver novidade, uma janela mostra o que mudou:
  1. **Baixar e instalar** ou **Agora não** (com "Agora não", ele pergunta de novo na próxima vez que você abrir o app);
  2. depois do download: **Reiniciar agora** ou **Instalar ao fechar o app**.

  Nada é baixado nem instalado sem a sua resposta, e os seus dados são mantidos.
- **Portátil:** o app avisa da versão nova, e o botão **Abrir página de download** leva à página certa. Baixe o novo arquivo e use-o no lugar do antigo.
- **No navegador:** o app não procura versões novas. Baixe o **Source code (zip)** da versão nova, extraia numa pasta nova e use o `start-app.bat` dela. Os seus dados continuam em `%APPDATA%\SkinsManager`; depois, você pode apagar a pasta antiga.

### Sugestões e problemas

Encontrou um erro ou tem uma ideia? Abra uma **Issue**: <https://github.com/GregoryCardoso/skins-manager/issues> (há formulários prontos em português e inglês).
Não anexe o seu arquivo de backup, porque ele contém os seus dados pessoais.
Pull requests não são aceitos no momento.

### Créditos

O catálogo e as imagens dos itens vêm da [CSGO-API](https://github.com/ByMykel/CSGO-API), de ByMykel.
Este projeto não tem ligação com a Valve.

### Uso

O app é **livre para uso pessoal**. O código pertence ao autor: **todos os direitos reservados**.

---

<a id="en"></a>

## English

### What the app does

- **Inventory from the game catalog:** pick each item from a list with its name and picture instead of typing everything.
- **Float, pattern and phase:** keep the details of each skin (including Doppler and Gamma Doppler phases).
- **Minimum price with no loss:** for each store, the app works out the lowest selling price that still covers what you paid, after the store's fee.
- **Trade lock:** see which items are still locked and when they unlock.
- **Item turnover:** the app shows what sells fast, what is turning over normally and what is "stuck" (sitting for many days). You choose the limits.
- **Sales and history:** record each sale and see the profit, the average time to sell and the average price of each item.
- **Configurable stores:** add the stores you use, with each one's currency and fees.
- **Dollar exchange rate:** type the rate or update it with one click (real-time commercial rate or the Brazilian Central Bank PTAX).
- **Backup:** export a copy of all your data and restore it whenever you need.
- **Light or dark theme** and **Portuguese or English**.
- **Automatic updates** (in the installed version), always asking first.

<!-- Screenshots and GIF: to be added in Stage 10, in assets/screenshots/ -->
> 📷 *Placeholder for app screenshots (`assets/screenshots/`).*

### How to use it

There are two ways. Your data is the same in both.

#### Option 1: Windows app (recommended)

Nothing else to install.

1. Open the latest version page: <https://github.com/GregoryCardoso/skins-manager/releases/latest>
2. Under **Assets**, download **one** of these files:

   | File | For whom |
   | --- | --- |
   | `SkinsManager-Setup-<version>.exe` | **Installer (recommended).** Installs the app, adds shortcuts to the desktop and Start menu, and updates itself (always asking first). It does not ask for an administrator password. |
   | `SkinsManager-Portable-<version>.exe` | **Portable.** Installs nothing: just double-click the file. It takes a bit longer to open and does not update itself; it only tells you when a new version is out. |

   The other files on that page (`latest.yml` and `.blockmap`) are used by automatic updates. You don't need them.
3. Double-click the downloaded file.
4. **If you see "Windows protected your PC":** click **More info** and then **Run anyway**.
   This warning appears because the app does not have a paid digital signature, not because it has a virus. It may come back with each new version.
   Download the app **only** from the official page above, never from other sites.

#### Option 2: in the browser, from the code

For those who prefer to use the app in a browser tab.

1. Install **Node.js**, **LTS** version, from <https://nodejs.org> (just follow the installer with the default options).
2. On the latest version page (<https://github.com/GregoryCardoso/skins-manager/releases/latest>), under **Assets**, download **Source code (zip)**.
3. Right-click the downloaded file and choose **Extract All**. Pick a permanent folder (for example, `Documents`).
4. Open the extracted folder and double-click **`start-app.bat`**.
   - The first time, it downloads what it needs and sets the app up. This needs internet and may take a few minutes.
   - After that, the app opens by itself in the browser.
5. To close the app, close the black `start-app.bat` window.

> Don't open the Windows app and `start-app.bat` at the same time: both use the same data, and only one can be open.

### Your data

- It stays **only on your computer**. Nothing is sent to the internet or to anyone else.
- The folder is `%APPDATA%\SkinsManager` (usually `C:\Users\<your user>\AppData\Roaming\SkinsManager`). Both ways of using the app, the installer and the portable version, use this same folder.
- **Back up:** in **Settings → Backup**, click **Export backup**. Keep the file somewhere safe (a USB drive or the cloud, for example) and don't share it: it contains all your data.
- **Restore:** in **Settings → Backup**, click **Choose backup file** and then **Replace my data**. Before replacing anything, the app keeps a copy of your current data.
- The app also makes automatic copies before importing a backup and before updating your data for a new version. The **Open folder** button, in **Settings → Backup**, shows where they are.
- **Uninstalling does not delete your data.** If you install again, everything is still there. To delete everything for good, remove the `%APPDATA%\SkinsManager` folder (make a backup first if you want to keep anything).

### Updates

You can see your version in **Settings → About**.

- **Installer:** a few seconds after opening, the app looks for a new version. You can also check with the **Check for updates** button in **Settings → About**. If there is one, a window shows what changed:
  1. **Download and install** or **Not now** (with "Not now", it asks again the next time you open the app);
  2. after the download: **Restart now** or **Install when closing the app**.

  Nothing is downloaded or installed without your answer, and your data is kept.
- **Portable:** the app tells you about the new version, and the **Open download page** button takes you to the right page. Download the new file and use it instead of the old one.
- **In the browser:** the app does not look for new versions. Download the new version's **Source code (zip)**, extract it to a new folder and use its `start-app.bat`. Your data stays in `%APPDATA%\SkinsManager`; you can then delete the old folder.

### Suggestions and problems

Found a bug or have an idea? Open an **Issue**: <https://github.com/GregoryCardoso/skins-manager/issues> (there are ready-made forms in Portuguese and English).
Don't attach your backup file, because it contains your personal data.
Pull requests are not accepted at the moment.

### Credits

The item catalog and images come from [CSGO-API](https://github.com/ByMykel/CSGO-API), by ByMykel.
This project is not affiliated with Valve.

### Use

The app is **free for personal use**. The code belongs to the author: **all rights reserved**.
