// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { renderUi } from '@/test/renderUi';
import { UpdateSection } from './UpdateGallery';

afterEach(cleanup);

// Guia vivo (12.10, parte 3): cada cenário abre o UpdateModal com um estado simulado, sem tocar no processo principal.
describe('UpdateSection do guia /design', () => {
  test('oferece todos os estados simulados', () => {
    renderUi(<UpdateSection />);
    for (const name of ['available', 'portable-available', 'downloading (42%)', 'downloading (sem %)', 'ready', 'installing', 'error (download)', 'error (install)']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  test('available mostra as notas no idioma e "Download and install" simula o download', async () => {
    renderUi(<UpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: 'available' }));
    expect(screen.getByRole('dialog', { name: 'Update available' })).toHaveTextContent('1.4.2 → 2.0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Download and install' }));
    expect(screen.getByRole('dialog', { name: 'Downloading the update' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow');
  });

  test('"Not now" fecha; esconder o download deixa o botão de reabrir', async () => {
    renderUi(<UpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: 'available' }));
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'downloading (42%)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep using the app' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'reopen' }));
    expect(screen.getByRole('dialog', { name: 'Downloading the update' })).toBeInTheDocument();
  });
});
