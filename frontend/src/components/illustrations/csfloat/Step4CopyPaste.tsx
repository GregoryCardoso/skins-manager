import Illustration from './Illustration';

// Passo 4: copiar a chave e colar num campo (dois blocos e uma seta).
export default function Step4CopyPaste({ alt }: { alt: string }) {
  return (
    <Illustration alt={alt}>
      <rect x="14" y="24" width="48" height="52" rx="6" fill="var(--surface)" stroke="var(--line)" />
      <rect x="22" y="36" width="32" height="8" rx="4" fill="var(--brand-soft)" stroke="var(--brand)" />
      <rect x="22" y="52" width="24" height="6" rx="3" fill="var(--line)" />
      <path d="M70 50h20m-6-6 6 6-6 6" fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="98" y="38" width="50" height="24" rx="6" fill="var(--surface)" stroke="var(--brand)" strokeWidth="1.5" />
      <circle cx="108" cy="50" r="2" fill="var(--muted)" />
      <circle cx="116" cy="50" r="2" fill="var(--muted)" />
      <circle cx="124" cy="50" r="2" fill="var(--muted)" />
      <circle cx="132" cy="50" r="2" fill="var(--muted)" />
    </Illustration>
  );
}
