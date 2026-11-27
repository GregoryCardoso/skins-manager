// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderUi, setViewport } from '@/test/renderUi';
import NavPreferences from './NavPreferences';

const prefs = vi.hoisted(() => ({
  theme: 'LIGHT' as 'LIGHT' | 'DARK',
  language: 'en',
  displayCurrency: 'USD',
  setTheme: vi.fn(),
  setLanguage: vi.fn(),
  changeDisplayCurrency: vi.fn(),
  updatePreferences: vi.fn(),
}));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => prefs }));

beforeEach(() => {
  setViewport(1440, 900);
  prefs.theme = 'LIGHT';
  prefs.displayCurrency = 'USD';
  for (const fn of [prefs.setTheme, prefs.setLanguage, prefs.changeDisplayCurrency, prefs.updatePreferences]) fn.mockClear();
});
afterEach(cleanup);

describe('NavPreferences expandido', () => {
  test('o tema alterna pelo grupo de opções (setTheme)', async () => {
    renderUi(<NavPreferences compact={false} onPickCurrency={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(prefs.setTheme).toHaveBeenCalledWith('DARK');
  });

  test('o idioma chama setLanguage, e cada opção leva o próprio lang', async () => {
    renderUi(<NavPreferences compact={false} onPickCurrency={() => {}} />);
    const select = screen.getByRole('combobox', { name: 'Language' });
    expect(screen.getByRole('option', { name: 'Deutsch' })).toHaveAttribute('lang', 'de');
    await userEvent.selectOptions(select, 'de');
    expect(prefs.setLanguage).toHaveBeenCalledWith('de');
  });

  test('escolher outra moeda só avisa quem usa (onPickCurrency); nada é gravado aqui', async () => {
    const onPick = vi.fn();
    renderUi(<NavPreferences compact={false} onPickCurrency={onPick} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Conversion currency' }));
    await userEvent.click(await screen.findByRole('option', { name: /EUR/ }));
    expect(onPick).toHaveBeenCalledWith('EUR');
    expect(prefs.changeDisplayCurrency).not.toHaveBeenCalled();
    expect(prefs.updatePreferences).not.toHaveBeenCalled();
  });

  test('escolher a moeda que já vale não faz nada', async () => {
    const onPick = vi.fn();
    renderUi(<NavPreferences compact={false} onPickCurrency={onPick} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Conversion currency' }));
    await userEvent.click(await screen.findByRole('option', { name: /USD/ }));
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('NavPreferences recolhido', () => {
  test('o botão do tema alterna direto, com o rótulo "Theme: X. Click to switch to Y."', async () => {
    renderUi(<NavPreferences compact onPickCurrency={() => {}} />);
    const button = screen.getByRole('button', { name: 'Theme: Light. Click to switch to Dark.' });
    await userEvent.click(button);
    expect(prefs.setTheme).toHaveBeenCalledWith('DARK');
  });

  test('o Popover abre com Enter, mostra idioma e moeda, e Esc devolve o foco ao botão', async () => {
    renderUi(<NavPreferences compact onPickCurrency={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Preferences' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('combobox', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Conversion currency' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Language' })).toBeNull());
    expect(trigger).toHaveFocus();
  });

  test('escolher a moeda no Popover o fecha e avisa quem usa', async () => {
    const onPick = vi.fn();
    renderUi(<NavPreferences compact onPickCurrency={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    await userEvent.click(await screen.findByRole('combobox', { name: 'Conversion currency' }));
    await userEvent.click(await screen.findByRole('option', { name: /EUR/ }));
    expect(onPick).toHaveBeenCalledWith('EUR');
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Language' })).toBeNull());
  });
});
