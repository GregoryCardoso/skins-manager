'use client';

import { useState } from 'react';
import { isSafeImageUrl } from '@/lib/safeUrl';
import type { Category } from '@/types/api';
import styles from './ItemImage.module.css';

interface Props {
  category: Category;
  url: string | null | undefined;
  size?: number;
}

// Imagem do catálogo (somente https://) com troca para o ícone da categoria se faltar, for insegura ou falhar.
export default function ItemImage({ category, url, size = 48 }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showRemote = isSafeImageUrl(url) && failedUrl !== url;
  const src = showRemote ? url : `/icons/${category}.svg`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.image}
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        if (showRemote) setFailedUrl(url ?? null);
      }}
    />
  );
}
