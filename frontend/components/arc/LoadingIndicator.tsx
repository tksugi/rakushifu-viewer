import type { CSSProperties } from 'react';
import styles from './LoadingIndicator.module.css';

/** Arc Library's skeleton placeholder and button spinner, adapted for CSS-only use.
 * No global theme or animation runtime is needed. See README.md and LICENSE. */
export function LoadingIndicator({ label = '読み込み中', compact = false, lines = 3 }: { label?: string; compact?: boolean; lines?: number }) {
  if (compact) return <span className={styles.compact} role="status" aria-label={label} aria-busy="true"><span className={styles.spinner} aria-hidden="true" /></span>;
  const count = Math.min(Math.max(Math.floor(lines), 1), 6);
  return <div className={styles.root} role="status" aria-label={label} aria-busy="true">
    <span className={styles.lines} aria-hidden="true">{Array.from({ length: count }, (_, index) => <span className={styles.line} style={{ '--index': index } as CSSProperties} key={index} />)}</span>
  </div>;
}
