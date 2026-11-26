// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { formatMoney } from '@/lib/format';
import { loadMessages, renderUi } from '@/test/renderUi';
import type { AgingBucket } from '@/types/api';
import BalanceBar, { barWidths } from './BalanceBar';
import Equation from './Equation';
import Money from './Money';
import Panel from './Panel';
import { PositionStrip, StatCard } from './StatCard';
import TurnoverRule, { TurnoverLegend } from './TurnoverRule';

afterEach(cleanup);

const LIMITS = { fastTurnoverDays: 7, slowItemDays: 21 };

describe('Panel', () => {
  test('section com aria-labelledby apontando para o título (h2 por padrão, h3 se pedido)', () => {
    renderUi(
      <>
        <Panel title="Balance" hint="Hint text">Body</Panel>
        <Panel title="Sub" headingLevel={3}>Body 2</Panel>
      </>,
    );
    expect(screen.getByRole('region', { name: 'Balance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Balance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Sub' })).toBeInTheDocument();
    expect(screen.getByText('Hint text')).toBeInTheDocument();
  });

  test('actions aparecem no cabeçalho; as="div" não vira região', () => {
    renderUi(<Panel title="T" as="div" actions={<button type="button">Act</button>}>x</Panel>);
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
  });
});

describe('StatCard e PositionStrip', () => {
  test('o grupo tem nome e cada cartão é dt + dd', () => {
    const { container } = renderUi(
      <PositionStrip label="Inventory position">
        <StatCard label="In holding" value="US$ 615.00" note="note text" />
        <StatCard label="Stuck" value="2 groups" tone="stuck" />
      </PositionStrip>,
    );
    expect(screen.getByRole('group', { name: 'Inventory position' })).toBeInTheDocument();
    expect(container.querySelectorAll('dl > div > dt')).toHaveLength(2);
    expect(container.querySelectorAll('dl > div > dd').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('2 groups').className).toMatch(/stuck/);
    expect(screen.getByText('note text')).toBeInTheDocument();
  });

  test('help vira um HelpTip acessível no teclado', async () => {
    renderUi(
      <PositionStrip label="Strip">
        <StatCard label="In stock" value="1" help="Explanation text" />
      </PositionStrip>,
    );
    const trigger = screen.getByRole('button', { name: 'Help: In stock' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('Explanation text')).toBeInTheDocument();
  });
});

describe('Equation', () => {
  test('os operadores aparecem como texto e o resultado tem variante própria', () => {
    const { container } = renderUi(
      <Equation
        rows={[
          { label: 'Paid out', value: '1' },
          { op: '+', label: 'Balance', note: 'available', value: '2' },
          { op: '−', label: 'Deposited', value: '3' },
          { op: '=', label: 'Real profit', variant: 'result', value: '4' },
        ]}
      />,
    );
    const terms = [...container.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(terms[1]).toContain('+');
    expect(terms[2]).toContain('−');
    expect(terms[3]).toContain('=');
    expect(container.querySelectorAll('dl > div')).toHaveLength(4);
    expect(container.querySelectorAll('dd')).toHaveLength(4);
    expect((container.querySelectorAll('dl > div')[3] as HTMLElement).className).toMatch(/result/);
    expect(screen.getByText('available')).toBeInTheDocument();
  });
});

describe('Money', () => {
  test('US$ com o "≈" da moeda de conversão menor e discreto', () => {
    renderUi(<Money cents={4415} approxCents={23986} approxCurrency="BRL" />);
    expect(screen.getByText(formatMoney(4415, 'USD', 'en'))).toBeInTheDocument();
    const approx = screen.getByText(`≈ ${formatMoney(23986, 'BRL', 'en')}`);
    expect(approx.className).toMatch(/approx/);
  });

  test('JPY sai sem casas decimais', () => {
    renderUi(<Money cents={150000} currency="JPY" />);
    expect(screen.getByText(/1,500$/)).toBeInTheDocument();
    expect(screen.queryByText(/\.00/)).toBeNull();
  });

  test('sem moeda de conversão, o "≈" não aparece', () => {
    renderUi(<Money cents={4415} approxCents={23986} />);
    expect(screen.queryByText(/≈/)).toBeNull();
  });

  test('estimated: "≈" antes do principal e a etiqueta "estimated"; estimatedBadge={false} esconde só a etiqueta', () => {
    const { rerender } = renderUi(<Money cents={123456} estimated />);
    expect(screen.getByText(`≈ ${formatMoney(123456, 'USD', 'en')}`)).toBeInTheDocument();
    expect(screen.getByText('estimated')).toBeInTheDocument();
    rerender(<Money cents={123456} estimated estimatedBadge={false} />);
    expect(screen.queryByText('estimated')).toBeNull();
    expect(screen.getByText(`≈ ${formatMoney(123456, 'USD', 'en')}`)).toBeInTheDocument();
  });

  test('indisponível: texto e a dica como HelpTip (sem title)', async () => {
    const { container } = renderUi(<Money cents={null} />);
    expect(screen.getByText('unavailable')).toBeInTheDocument();
    expect(container.querySelector('[title]')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Help: unavailable' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText(/exchange rate is missing/i)).toBeInTheDocument();
  });

  test('signed: positivo com "+" e classe profit; negativo com classe loss; zero neutro', () => {
    renderUi(
      <>
        <Money cents={116402} signed />
        <Money cents={-34000} signed />
        <Money cents={0} signed />
      </>,
    );
    const positive = screen.getByText(`+${formatMoney(116402, 'USD', 'en')}`);
    expect(positive.className).toMatch(/profit/);
    const negativeText = formatMoney(-34000, 'USD', 'en');
    const negative = screen.getByText(negativeText);
    expect(negative.className).toMatch(/loss/);
    expect(negativeText.startsWith('+')).toBe(false);
    const zero = screen.getByText(formatMoney(0, 'USD', 'en'));
    expect(zero.className).not.toMatch(/profit|loss/);
  });

  test('sem signed, o valor positivo não ganha "+" nem cor', () => {
    renderUi(<Money cents={500} />);
    const el = screen.getByText(formatMoney(500, 'USD', 'en'));
    expect(el.className).not.toMatch(/profit|loss/);
  });

  test('staleRateNote: relógio ao lado do "≈" com HelpTip', async () => {
    renderUi(<Money cents={4415} approxCents={23986} approxCurrency="BRL" staleRateNote="Fetched 9 days ago." />);
    const trigger = screen.getByRole('button', { name: 'Help: The exchange rate may be outdated' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('Fetched 9 days ago.')).toBeInTheDocument();
  });

  test('o texto de "estimado" vem do idioma', async () => {
    const messages = await loadMessages('pt-BR');
    renderUi(<Money cents={100} estimated />, { language: 'pt-BR', messages });
    expect(screen.getByText('estimado')).toBeInTheDocument();
  });
});

describe('TurnoverRule', () => {
  const rule = (bucket: AgingBucket, days: number | null = 13) =>
    renderUi(<TurnoverRule kind="item" bucket={bucket} daysForSale={days} limits={LIMITS} tradeLockText="6 d" offSaleSinceText="12 d" />);

  test.each([
    ['RECENTE', 4, 'Recent'],
    ['EM_GIRO', 13, 'Moving'],
    ['AGARRADO', 26, 'Stuck'],
  ] as const)('%s: trilho com pino, dias à venda e o nome da faixa', (bucket, days, name) => {
    const { container } = rule(bucket, days);
    expect(container.querySelector('[class*="pin"]')).not.toBeNull();
    expect(screen.getAllByText(`${days} days for sale`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(name)).length).toBeGreaterThan(0);
    expect(container.querySelector('[class*="track"]')).toHaveAttribute('aria-hidden', 'true');
  });

  test('o pino fica na posição calculada pela geometria (4 dias com 7/21: 11,4%)', () => {
    const { container } = rule('RECENTE', 4);
    const pin = container.querySelector('[class*="pin"]') as HTMLElement;
    expect(parseFloat(pin.style.left)).toBeCloseTo(11.4, 1);
  });

  test('AGARRADO marca o número em âmbar pela classe da régua', () => {
    const { container } = rule('AGARRADO', 26);
    expect((container.firstElementChild as HTMLElement).className).toMatch(/isStuck/);
  });

  test('trade lock: trilho sem pino e texto "Trade lock · releases in 6 d"', () => {
    const { container } = rule('EM_TRADE_LOCK', null);
    expect(container.querySelector('[class*="pin"]')).toBeNull();
    expect(screen.getByText('Trade lock · releases in 6 d')).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).className).toMatch(/isLock/);
  });

  test('FORA_DE_VENDA vira o selo do holding, sem régua', () => {
    const { container } = rule('FORA_DE_VENDA', null);
    expect(screen.getByText(/Holding · 12 d/)).toBeInTheDocument();
    expect(container.querySelector('[class*="track"]')).toBeNull();
  });

  test('CONSUMIDO não renderiza nada', () => {
    const { container } = rule('CONSUMIDO', null);
    expect(container).toBeEmptyDOMElement();
  });

  test('sem dias (null) na faixa com régua: só o nome da faixa, sem pino', () => {
    const { container } = rule('EM_GIRO', null);
    expect(container.querySelector('[class*="pin"]')).toBeNull();
    expect(screen.getByText('Moving')).toBeInTheDocument();
  });

  test('a faixa vem do bucket, não dos dias: 30 dias com bucket RECENTE continua na primeira faixa', () => {
    const { container } = rule('RECENTE', 30);
    const pin = container.querySelector('[class*="pin"]') as HTMLElement;
    expect(parseFloat(pin.style.left)).toBeLessThanOrEqual(20);
  });

  test('plural em pt-BR (1, 2 e 5 dias)', async () => {
    const messages = await loadMessages('pt-BR');
    const { rerender } = renderUi(<TurnoverRule kind="item" bucket="EM_GIRO" daysForSale={1} limits={LIMITS} />, { language: 'pt-BR', messages });
    expect(screen.getAllByText('1 dia à venda').length).toBeGreaterThan(0);
    rerender(<TurnoverRule kind="item" bucket="EM_GIRO" daysForSale={2} limits={LIMITS} />);
    expect(screen.getAllByText('2 dias à venda').length).toBeGreaterThan(0);
    rerender(<TurnoverRule kind="item" bucket="EM_GIRO" daysForSale={5} limits={LIMITS} />);
    expect(screen.getAllByText('5 dias à venda').length).toBeGreaterThan(0);
  });

  test.each([
    [1, 'день'],
    [2, 'дня'],
    [5, 'дней'],
  ])('plural em ru (%i)', async (days, word) => {
    const messages = await loadMessages('ru');
    renderUi(<TurnoverRule kind="item" bucket="EM_GIRO" daysForSale={days} limits={LIMITS} />, { language: 'ru', messages });
    expect(screen.getAllByText(new RegExp(`${days} ${word} в продаже`)).length).toBeGreaterThan(0);
  });

  test.each([
    [1, 'dzień'],
    [2, 'dni'],
    [5, 'dni'],
    [22, 'dni'],
  ])('plural em pl (%i)', async (days, word) => {
    const messages = await loadMessages('pl');
    renderUi(<TurnoverRule kind="item" bucket="EM_GIRO" daysForSale={days} limits={LIMITS} />, { language: 'pl', messages });
    expect(screen.getAllByText(new RegExp(`${days} ${word} w sprzedaży`)).length).toBeGreaterThan(0);
  });

  test('forma curta está no DOM junto da longa ("13 d · Moving")', () => {
    const { container } = rule('EM_GIRO', 13);
    expect(container.textContent).toContain('13 d');
  });

  test('kind="scale": o trilho com os limites escritos', () => {
    const { container } = renderUi(<TurnoverRule kind="scale" limits={LIMITS} />);
    expect(screen.getByText('7 d')).toBeInTheDocument();
    expect(screen.getByText('21 d')).toBeInTheDocument();
    expect(container.querySelector('[class*="pin"]')).toBeNull();
  });
});

describe('TurnoverLegend', () => {
  test('mostra as quatro faixas com os limites', () => {
    renderUi(<TurnoverLegend limits={LIMITS} />);
    expect(screen.getByText('Fast turnover up to 7 days')).toBeInTheDocument();
    expect(screen.getByText('Moving')).toBeInTheDocument();
    expect(screen.getByText('Stuck above 21 days')).toBeInTheDocument();
    expect(screen.getByText('Trade lock')).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(4);
  });
});

describe('BalanceBar', () => {
  test('larguras proporcionais ao máximo da escala', () => {
    expect(barWidths(62, 18, 100)).toEqual({ available: 62, pending: 18 });
    expect(barWidths(50, 0, 200)).toEqual({ available: 25, pending: 0 });
  });

  test('negativo, zero e escala 0 deixam a barra vazia, sem erro', () => {
    expect(barWidths(-10, -5, 100)).toEqual({ available: 0, pending: 0 });
    expect(barWidths(0, 0, 100)).toEqual({ available: 0, pending: 0 });
    expect(barWidths(10, 10, 0)).toEqual({ available: 0, pending: 0 });
    expect(barWidths(10, 10, -5)).toEqual({ available: 0, pending: 0 });
    expect(barWidths(Number.NaN, 5, 100)).toEqual({ available: 0, pending: 5 });
  });

  test('a soma nunca passa de 100%', () => {
    const { available, pending } = barWidths(80, 50, 100);
    expect(available + pending).toBeLessThanOrEqual(100);
    expect(barWidths(300, 50, 100)).toEqual({ available: 100, pending: 0 });
  });

  test('role=img com o nome "Available …, pending …" e as larguras no estilo', () => {
    const { container } = renderUi(
      <BalanceBar availableCents={62} pendingCents={18} scaleMaxCents={100} availableText="US$ 842.10" pendingText="US$ 190.00" />,
    );
    expect(screen.getByRole('img', { name: 'Available US$ 842.10, pending US$ 190.00' })).toBeInTheDocument();
    const bars = container.querySelectorAll('i');
    expect((bars[0] as HTMLElement).style.width).toBe('62%');
    expect((bars[1] as HTMLElement).style.width).toBe('18%');
  });

  test('label substitui o nome padrão', () => {
    renderUi(<BalanceBar availableCents={1} pendingCents={0} scaleMaxCents={1} availableText="a" pendingText="b" label="Custom" />);
    expect(screen.getByRole('img', { name: 'Custom' })).toBeInTheDocument();
  });
});
