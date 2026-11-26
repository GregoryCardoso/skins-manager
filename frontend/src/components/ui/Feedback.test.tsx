// @vitest-environment jsdom
import '@/test/setupDom';
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadMessages, renderUi } from '@/test/renderUi';
import Banner from './Banner';
import ConfirmDialog from './ConfirmDialog';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import Skeleton from './Skeleton';
import { ToastProvider, useToast } from './Toast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Banner', () => {
  test('info e success usam role=status; danger e warning usam role=alert', () => {
    renderUi(
      <>
        <Banner tone="info">Info text</Banner>
        <Banner tone="success">Success text</Banner>
        <Banner tone="warning">Warning text</Banner>
        <Banner tone="danger">Danger text</Banner>
      </>,
    );
    expect(screen.getByText('Info text').closest('[role]')).toHaveAttribute('role', 'status');
    expect(screen.getByText('Success text').closest('[role]')).toHaveAttribute('role', 'status');
    expect(screen.getByText('Warning text').closest('[role]')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Danger text').closest('[role]')).toHaveAttribute('role', 'alert');
  });

  test('announce={false} tira o papel de alerta (já estava na tela ao carregar)', () => {
    renderUi(<Banner tone="danger" announce={false}>Quiet</Banner>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Quiet')).toBeInTheDocument();
  });

  test('o ícone é decorativo (aria-hidden) e o título aparece', () => {
    const { container } = renderUi(<Banner tone="info" title="Heads up">Body</Banner>);
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('Tentar de novo chama onRetry e, com retrying, fica em carregamento', async () => {
    const onRetry = vi.fn();
    const { rerender } = renderUi(<Banner tone="danger" onRetry={onRetry}>Failed</Banner>);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<Banner tone="danger" onRetry={onRetry} retrying>Failed</Banner>);
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true');
  });

  test('Dispensar chama onDismiss, com o nome traduzido', async () => {
    const onDismiss = vi.fn();
    renderUi(<Banner tone="info" onDismiss={onDismiss}>Hello</Banner>);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  test('o nome do botão Dispensar vem do dicionário do idioma', async () => {
    const messages = await loadMessages('pt-BR');
    renderUi(<Banner tone="info" onDismiss={() => {}}>Oi</Banner>, { language: 'pt-BR', messages });
    expect(screen.getByRole('button', { name: 'Dispensar' })).toBeInTheDocument();
  });

  test('ação com href vira link; sem href vira botão com onClick', async () => {
    const onClick = vi.fn();
    renderUi(
      <>
        <Banner tone="info" action={{ label: 'Open settings', href: '/settings' }}>A</Banner>
        <Banner tone="info" action={{ label: 'Do it', onClick }}>B</Banner>
      </>,
    );
    expect(screen.getByRole('link', { name: 'Open settings' })).toHaveAttribute('href', '/settings');
    await userEvent.click(screen.getByRole('button', { name: 'Do it' }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('ConfirmDialog com Banner', () => {
  test('o erro aparece como alerta de perigo dentro do diálogo', async () => {
    renderUi(<ConfirmDialog title="T" message="M" confirmLabel="Go" error="Server failed" onConfirm={() => {}} onCancel={() => {}} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Server failed');
  });
});

function ToastDemo({ tone = 'success' as 'success' | 'danger' | 'info', withAction = false }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => toast.show({ tone, message: 'Saved ok', durationMs: 1000, action: withAction ? { label: 'Undo', onClick: () => {} } : undefined })}
    >
      go
    </button>
  );
}

describe('Toast', () => {
  test('show mostra a mensagem e a região tem o rótulo traduzido', async () => {
    renderUi(
      <ToastProvider>
        <ToastDemo />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(await screen.findByText('Saved ok')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Notifications/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument();
  });

  test('o rótulo da região vem do idioma', async () => {
    const messages = await loadMessages('de');
    renderUi(
      <ToastProvider>
        <ToastDemo />
      </ToastProvider>,
      { language: 'de', messages },
    );
    expect(screen.getByRole('region', { name: /Benachrichtigungen/ })).toBeInTheDocument();
  });

  test('success some sozinho; danger não', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderUi(
      <ToastProvider>
        <ToastDemo tone="success" />
        <ToastDemo tone="danger" />
      </ToastProvider>,
    );
    const [success, danger] = screen.getAllByRole('button', { name: 'go' });
    await act(async () => {
      success.click();
    });
    expect(await screen.findByText('Saved ok')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByText('Saved ok')).toBeNull();

    await act(async () => {
      danger.click();
    });
    expect(await screen.findByText('Saved ok')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(screen.getByText('Saved ok')).toBeInTheDocument();
  });

  test('a ação do aviso aparece e dispensar o remove', async () => {
    renderUi(
      <ToastProvider>
        <ToastDemo tone="danger" withAction />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Saved ok')).toBeNull();
  });

  test('useToast fora do provider avisa com um erro claro', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderUi(<ToastDemo />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});

describe('EmptyState e ErrorState', () => {
  test('EmptyState mostra título, descrição e ação; o ícone é decorativo', () => {
    const { container } = renderUi(<EmptyState icon="inventory" title="Nothing here" description="Add one" action={<button type="button">Add</button>} />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Add one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('ErrorState é role=alert e o botão Tentar de novo chama onRetry', async () => {
    const onRetry = vi.fn();
    renderUi(<ErrorState title="Could not load" message="Timed out" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Timed out');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  test('ErrorState sem onRetry não mostra o botão', () => {
    renderUi(<ErrorState message="Timed out" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Skeleton', () => {
  test('é aria-hidden e repete as linhas pedidas', () => {
    const { container } = renderUi(<Skeleton lines={3} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.children).toHaveLength(3);
  });

  test('largura e altura vão para o estilo', () => {
    const { container } = renderUi(<Skeleton width="8rem" height="2rem" radius="pill" />);
    const bar = (container.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
    expect(bar.style.width).toBe('8rem');
    expect(bar.style.height).toBe('2rem');
  });
});
