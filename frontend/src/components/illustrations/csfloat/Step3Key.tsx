import Illustration from './Illustration';

// Passo 3: uma chave sendo criada numa lista (botão "novo" e uma chave).
export default function Step3Key({ alt }: { alt: string }) {
  return (
    <Illustration alt={alt}>
      <rect x="16" y="16" width="128" height="68" rx="6" fill="var(--surface)" stroke="var(--line)" />
      <rect x="26" y="24" width="38" height="12" rx="6" fill="var(--brand)" />
      <path d="M40 30h10M45 25v10" stroke="var(--brand-ink)" strokeWidth="2" strokeLinecap="round" />
      <rect x="26" y="46" width="108" height="10" rx="4" fill="var(--surface-2)" />
      <circle cx="36" cy="51" r="3.5" fill="none" stroke="var(--muted)" strokeWidth="1.5" />
      <path d="M40 51h16m-4 0v3m-5-3v3" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="26" y="62" width="108" height="10" rx="4" fill="var(--surface-2)" />
    </Illustration>
  );
}
