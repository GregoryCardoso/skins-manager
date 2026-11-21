// Limite do arquivo de backup na importação (igual ao BACKUP_MAX_BYTES do backend: 100 MB).
export const BACKUP_MAX_BYTES = 100 * 1024 * 1024;

export const bytesToMb = (bytes: number): number => Math.round(bytes / (1024 * 1024));

// Verdadeiro quando o arquivo passa do limite e nem deve ser enviado (T83).
export const isBackupTooLarge = (sizeBytes: number, maxBytes = BACKUP_MAX_BYTES): boolean => sizeBytes > maxBytes;
