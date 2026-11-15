let layoutCount = 0;
let pageCount = 0;

export const getLayoutCount = () => layoutCount;
export const getPageCount = () => pageCount;

export function bumpLayoutCount(): void {
  layoutCount++;
}

export function bumpPageCount(): void {
  pageCount++;
}
