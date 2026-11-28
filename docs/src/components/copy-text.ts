function copyWithSelection(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  const didCopy = document.execCommand("copy");
  textarea.remove();
  return didCopy;
}

/**
 * Copies `value` and resolves whether it worked. The selection copy runs first, while the click's
 * user activation is still fresh, and answers when the Clipboard API is missing, refused, or never
 * settles (some embedded browsers leave its permission prompt pending).
 */
export async function copyText(value: string): Promise<boolean> {
  let clipboardTimer: number | undefined;
  const fallbackCopySucceeded = copyWithSelection(value);

  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");

    await Promise.race([
      navigator.clipboard.writeText(value),
      new Promise<never>((_, reject) => {
        clipboardTimer = window.setTimeout(
          () => reject(new Error("Clipboard permission timed out")),
          600,
        );
      }),
    ]);
    return true;
  } catch {
    return fallbackCopySucceeded;
  } finally {
    window.clearTimeout(clipboardTimer);
  }
}
