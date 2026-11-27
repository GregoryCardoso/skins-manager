import Illustration from './Illustration';

// Passo 2: o menu de perfil de uma conta (avatar e três itens, um deles marcado).
export default function Step2ProfileMenu({ alt }: { alt: string }) {
  return (
    <Illustration alt={alt}>
      <circle cx="116" cy="22" r="9" fill="var(--brand-soft)" stroke="var(--brand)" />
      <circle cx="116" cy="19" r="3" fill="var(--brand)" />
      <path d="M109 28a7 7 0 0 1 14 0z" fill="var(--brand)" />
      <rect x="62" y="36" width="84" height="50" rx="6" fill="var(--surface)" stroke="var(--line)" />
      <rect x="70" y="43" width="52" height="6" rx="3" fill="var(--line)" />
      <rect x="68" y="54" width="70" height="10" rx="4" fill="var(--brand-soft)" stroke="var(--brand)" />
      <rect x="74" y="57" width="42" height="4" rx="2" fill="var(--brand)" />
      <rect x="70" y="70" width="46" height="6" rx="3" fill="var(--line)" />
    </Illustration>
  );
}
