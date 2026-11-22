export default function BrokenPage(): never {
  throw new Error("The broken page threw while rendering.");
}
