'use client';

import { CheckControl, type CheckboxProps } from './Checkbox';

export type SwitchProps = Omit<CheckboxProps, 'indeterminate'>;

// O mesmo <input type="checkbox">, com role="switch". Só para efeito imediato (ativar uma loja, por exemplo).
export default function Switch(props: SwitchProps) {
  return <CheckControl {...props} asSwitch />;
}
