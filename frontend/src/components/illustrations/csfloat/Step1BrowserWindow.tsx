import Illustration from './Illustration';

// Passo 1: uma janela de navegador genérica com a barra de endereço.
export default function Step1BrowserWindow({ alt }: { alt: string }) {
  return (
    <Illustration alt={alt}>
      <rect x="16" y="14" width="128" height="72" rx="6" fill="var(--surface)" stroke="var(--line)" />
      <path d="M16 20a6 6 0 0 1 6-6h116a6 6 0 0 1 6 6v8H16z" fill="var(--brand-soft)" />
      <circle cx="26" cy="21" r="2.5" fill="var(--muted)" />
      <circle cx="35" cy="21" r="2.5" fill="var(--muted)" />
      <circle cx="44" cy="21" r="2.5" fill="var(--muted)" />
      <rect x="54" y="17" width="82" height="8" rx="4" fill="var(--surface)" stroke="var(--line)" />
      <rect x="28" y="40" width="50" height="6" rx="3" fill="var(--line)" />
      <rect x="28" y="52" width="104" height="6" rx="3" fill="var(--line)" />
      <rect x="28" y="64" width="72" height="6" rx="3" fill="var(--line)" />
    </Illustration>
  );
}
