# Ícone do aplicativo

A logo vem de `logo.svg` (a arte completa) e `logo-small.svg` (variante só com o "S", sem o fuzil, usada
nos tamanhos 16, 24 e 32 px, onde o fuzil vira borrão).

## Como regerar

Só quando uma das duas logos mudar. Na raiz do projeto:

```
npm --prefix desktop run icons
```

O script (`desktop/scripts/generateIcons.js`, com `@resvg/resvg-js`) gera e grava:

- `desktop/build/icon.png` (1024), `icon-512.png`, `icon-256.png`
- `desktop/build/icon.ico` (16, 24, 32, 48, 64, 128 e 256 px), usado pelo electron-builder no executável,
  no instalador, no desinstalador e nos atalhos
- `desktop/src/assets/icon.png` (256): ícone da janela quando roda com `electron .`
- `frontend/public/favicon.ico` (16, 32, 48) e `frontend/public/icon.svg`: favicon da interface
- `desktop/build/icons.manifest.json`: sha256 das fontes e das saídas; um teste do desktop falha se alguma
  saída estiver desatualizada em relação às logos

As saídas ficam versionadas. O script não roda no `stage`, no `dist` nem no `release`.

## Aviso

O Windows guarda ícones em cache: depois de atualizar, o atalho pode mostrar o ícone antigo por um tempo.
Some sozinho ou reiniciando o Explorer.
