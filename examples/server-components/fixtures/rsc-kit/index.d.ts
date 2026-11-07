// Types for both builds: the server build's KitQuote is async, the client build's is not.
import type { ReactNode } from "react";

export declare function KitQuote(props: { topic: string }): ReactNode | Promise<ReactNode>;
export declare function kitGreeting(name: string): string;
export declare function useKitLabel(): { label: string; click(): void };
export declare function KitProvider(props: { initial: string; children?: ReactNode }): ReactNode;
export declare function KitValue(): ReactNode;
