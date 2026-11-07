import { useKitLabel } from "@farm-fixtures/rsc-kit";

// A shared module with no directive, used only by client components: in React Server Components
// it belongs to the client graph, so the package resolves to its build for client code.
export function useSharedKitLabel() {
  return useKitLabel();
}
