// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadMessages, renderUi } from '@/test/renderUi';
import ImportButton from './ImportButton';

const mocks = vi.hoisted(() => ({ count: 0 as number | null, start: vi.fn(), disabledReason: null as string | null }));

vi.mock('./layout/useReviewCount', () => ({ useReviewCount: () => mocks.count }));
vi.mock('./useCsfloatImport', () => ({
  useCsfloatImport: () => ({ running: false, disabledReason: mocks.disabledReason, start: mocks.start, dialogs: null }),
}));
vi.mock('./ImportSetupModal', () => ({ default: () => null }));

beforeEach(() => {
  mocks.count = 0;
  mocks.disabledReason = null;
  mocks.start.mockReset();
});
afterEach(cleanup);

describe('ImportButton: link "para conferir" (12.4)', () => {
  test('com 0 (ou ainda carregando), não aparece link nenhum', () => {
    renderUi(<ImportButton />);
    expect(screen.queryByRole('link')).toBeNull();
    mocks.count = null;
    cleanup();
    renderUi(<ImportButton />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('com 3, um link para as importações com o selo no plural; o botão continua só importando', async () => {
    mocks.count = 3;
    renderUi(<ImportButton />);
    const link = screen.getByRole('link', { name: '3 to review' });
    expect(link.getAttribute('href')).toMatch(/^\/imports\/?$/);
    const button = screen.getByRole('button', { name: 'Import from CSFloat' });
    expect(button).not.toContainElement(link);
    await userEvent.click(button);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  test('o texto do selo vem do idioma (plural em pt-BR)', async () => {
    mocks.count = 1;
    const messages = await loadMessages('pt-BR');
    renderUi(<ImportButton />, { language: 'pt-BR', messages });
    expect(screen.getByRole('link', { name: '1 para conferir' })).toBeInTheDocument();
  });

  test('sem o CSFloat ligado (botão "Importar automaticamente"), o link também aparece', () => {
    mocks.count = 2;
    mocks.disabledReason = 'NO_KEY';
    renderUi(<ImportButton />);
    expect(screen.getByRole('link', { name: '2 to review' })).toBeInTheDocument();
  });
});
