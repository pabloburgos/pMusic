/**
 * Distributive version of built-in `Omit<T, K>` that preserves discriminated unions.
 * Built-in `Omit<Union, K>` computes `keyof Union` across all members (intersecting keys)
 * and silently erases variant-specific payload properties.
 * Uses `PropertyKey` to keep full strict typing with zero unsafe widening.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type Unsubscribe = () => void;
