import { describe, expect, test } from 'vitest';
import { LANGUAGES } from '@/i18n/languages';
import { selectReleaseNotes } from './releaseNotes';

// Etapa 11.10 (D369, E-P3-Q17): as notas da versão aceitam um marcador `<!-- código -->` para cada um dos 13 idiomas, com
// reserva para `<!-- en -->` e, sem `en`, mostrando tudo.

const note = (code: string) => `Notas em ${code}`;
const allMarked = LANGUAGES.map((code) => `<!-- ${code} -->\n${note(code)}`).join('\n\n');

describe('notas da versão nos 13 idiomas', () => {
  test('o registro tem os 13 idiomas', () => {
    expect(LANGUAGES).toHaveLength(13);
  });

  test.each([...LANGUAGES])('escolhe a seção de %s, só ela', (code) => {
    expect(selectReleaseNotes(allMarked, code)).toBe(note(code));
  });

  test.each([...LANGUAGES])('marcador de %s em maiúsculas/minúsculas e com espaços', (code) => {
    expect(selectReleaseNotes(`  <!--   ${code.toUpperCase()}   -->  \nTexto`, code)).toBe('Texto');
  });

  test.each(LANGUAGES.filter((code) => code !== 'en' && code !== 'pt-BR'))('%s sem seção própria vê o inglês (pt-BR e en na versão)', (code) => {
    const onlyTwo = '<!-- pt-BR -->\nNovidades\n\n<!-- en -->\nWhat is new';
    expect(selectReleaseNotes(onlyTwo, code)).toBe('What is new');
  });

  test('sem seção en e sem a do idioma, mostra tudo', () => {
    expect(selectReleaseNotes('<!-- pt-BR -->\nA\n\n<!-- es -->\nB', 'ja')).toBe('A\n\nB');
  });

  test('texto antes do primeiro marcador vale para todos os idiomas', () => {
    expect(selectReleaseNotes('Topo\n\n<!-- en -->\nE\n\n<!-- ko -->\nK', 'ko')).toBe('Topo\n\nK');
  });
});
