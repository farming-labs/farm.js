export declare const Fragment: unique symbol;

export type Key = string | number | bigint;
export type Ref<T> = { current: T | null } | ((value: T | null) => void);

export interface LeafElement<P = any> {
  readonly type: string | Component<P> | AsyncComponent<P> | typeof Fragment;
  readonly key: Key | null;
  readonly ref: Ref<unknown> | null;
  readonly props: P;
}

export type Child = LeafElement | string | number | bigint | boolean | null | undefined;
export type Children = Child | readonly Children[];
export type Component<P = {}> = (props: P) => Children;
/** Renders on the server only: leaf/server waits for it, and the browser can't hydrate it. */
export type AsyncComponent<P = {}> = (props: P) => Promise<Children>;

export declare function createElement(
  type: string | Component<any> | AsyncComponent<any> | typeof Fragment,
  props?: Record<string, unknown> | null,
  ...children: Children[]
): LeafElement;
export declare function isValidElement(value: unknown): value is LeafElement;
/**
 * On the server, where leaf/server's stream sends what it has before waiting on the async
 * components inside. leaf streams in order, so `fallback` never shows.
 */
export declare function Suspense(props: { children?: Children; fallback?: Children }): Children;
export declare function toChildArray(children: Children): Array<LeafElement | string>;

export type SetState<T> = (next: T | ((previous: T) => T)) => void;
export declare function useState<T>(initial: T | (() => T)): [T, SetState<T>];
export declare function useReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initial: S,
): [S, (action: A) => void];
export declare function useEffect(
  effect: () => void | (() => void),
  deps?: readonly unknown[],
): void;
export declare function useRef<T>(initial: T): { current: T };
export declare function useMemo<T>(compute: () => T, deps: readonly unknown[]): T;
export declare function useCallback<T extends (...args: any[]) => unknown>(
  callback: T,
  deps: readonly unknown[],
): T;
export declare function depsChanged(
  previous: readonly unknown[] | null | undefined,
  next: readonly unknown[] | null | undefined,
): boolean;

export interface Context<T> {
  readonly defaultValue: T;
  /** Gives the components below it `value`. */
  readonly Provider: Component<{ value: T; children?: Children }>;
}
export declare function createContext<T>(defaultValue: T): Context<T>;
/** The value of the nearest `Provider` above the component, or the context's default. */
export declare function useContext<T>(context: Context<T>): T;

export interface Dispatcher {
  useState<T>(initial: T | (() => T)): [T, SetState<T>];
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  useRef<T>(initial: T): { current: T };
  useMemo<T>(compute: () => T, deps?: readonly unknown[]): T;
  useContext<T>(context: Context<T>): T;
}
export declare const internals: {
  render<P>(component: Component<P>, props: P, dispatcher: Dispatcher): Children;
};
