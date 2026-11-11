// @types/node が入手できないオフライン環境用の最小宣言。@types/node を導入するコミットで、このファイルを同じコミット内で必ず削除すること。
declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export namespace test {
    function todo(name: string): void;
  }
}
declare module 'node:assert/strict' {
  const assert: {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(fn: () => unknown, expected?: unknown, message?: string): void;
  };
  export default assert;
}
