# Ícone do aplicativo

O Skins Manager ainda usa o ícone padrão do Electron.

## Como colocar o seu ícone

1. Crie uma imagem PNG de **1024x1024** pixels, com fundo transparente.
2. Salve como `desktop/build/icon.png` (neste mesmo diretório, com este nome exato).
3. Gere o instalador de novo: na raiz do projeto, `npm run desktop:dist`.

O electron-builder encontra `build/icon.png` sozinho e gera o `.ico` do instalador, do
executável e dos atalhos. Se o arquivo não existir, o build usa o ícone padrão e não falha.
Não é preciso mudar nenhuma configuração.

Se preferir, pode colocar direto um `icon.ico` (com os tamanhos 16 a 256) em vez do PNG.
