import type { ReactNode } from 'react';
import { parseReleaseMarkdown, type Block, type Inline, type ListBlock } from '@/lib/releaseNotes';
import styles from './ReleaseNotes.module.css';

// Notas da versão em markdown (D193). Nunca injeta HTML: todo texto entra como filho de texto do React, que faz o
// escape. Só links https:// viram <a>, abertos no navegador padrão pela política de navegação do app.
function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'strong':
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case 'em':
        return <em key={index}>{renderInline(node.children)}</em>;
      case 'code':
        return <code key={index} className={styles.inlineCode}>{node.text}</code>;
      case 'link':
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer" className={styles.link}>
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

function renderList(list: ListBlock, key: number | string): ReactNode {
  const Tag = list.ordered ? 'ol' : 'ul';
  return (
    <Tag key={key} className={styles.list}>
      {list.items.map((item, index) => (
        <li key={index}>
          {renderInline(item.children)}
          {item.sublist && renderList(item.sublist, 'sub')}
        </li>
      ))}
    </Tag>
  );
}

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = block.level === 3 ? 'h3' : block.level === 4 ? 'h4' : 'h5';
      return <Tag key={index} className={styles.heading}>{renderInline(block.children)}</Tag>;
    }
    case 'paragraph':
      return <p key={index} className={styles.paragraph}>{renderInline(block.children)}</p>;
    case 'list':
      return renderList(block, index);
    case 'code':
      return (
        <pre key={index} className={styles.codeBlock}>
          <code>{block.text}</code>
        </pre>
      );
    case 'hr':
      return <hr key={index} className={styles.rule} />;
  }
}

export default function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks = parseReleaseMarkdown(markdown);
  return <div className={styles.notes}>{blocks.map(renderBlock)}</div>;
}
