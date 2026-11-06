import styles from "./badge.module.css";

export function Badge() {
  return (
    <span className={styles.badge} data-testid="styled-badge">
      Badge
    </span>
  );
}
