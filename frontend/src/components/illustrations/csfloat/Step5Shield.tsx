import Illustration from './Illustration';

// Passo 5: um escudo com um cadeado, para manter a chave em segredo.
export default function Step5Shield({ alt }: { alt: string }) {
  return (
    <Illustration alt={alt}>
      <path d="M80 14 112 26v22c0 18-13 31-32 38C61 79 48 66 48 48V26z" fill="var(--brand-soft)" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" />
      <rect x="68" y="46" width="24" height="18" rx="4" fill="var(--brand)" />
      <path d="M72 46v-5a8 8 0 0 1 16 0v5" fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="80" cy="55" r="2.5" fill="var(--brand-ink)" />
    </Illustration>
  );
}
