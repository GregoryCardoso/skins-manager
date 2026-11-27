// Limite do arquivo de backup na importação (igual ao BACKUP_MAX_BYTES do backend: 100 MB).
export const BACKUP_MAX_BYTES = 100 * 1024 * 1024;

export const bytesToMb = (bytes: number): number => Math.round(bytes / (1024 * 1024));

// Verdadeiro quando o arquivo passa do limite e nem deve ser enviado (T83).
export const isBackupTooLarge = (sizeBytes: number, maxBytes = BACKUP_MAX_BYTES): boolean => sizeBytes > maxBytes;

// Tamanho do arquivo para a prévia da importação (12.8): "512 KB" ou "12,4 MB", no formato do idioma.
export function formatFileSize(bytes: number, locale: string): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb)} MB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(1, Math.round(bytes / 1024)))} KB`;
}
