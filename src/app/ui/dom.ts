type Child = Node | string | null | undefined | false | Child[];

/** 最小の DOM ヘルパー。文字列は常に textContent 経由（HTML として解釈しない）。 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | boolean | number>> & { class?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v === undefined) continue;
    if (k === 'class') node.className = String(v);
    else if (k in node && typeof v !== 'string') (node as unknown as Record<string, unknown>)[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity as 1) as (Node | string | null | undefined | false)[]) if (c) node.append(c);
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

export const DISCLAIMER = 'これは耐震診断ではなく、統計的な目安です';
export const DISCLAIMER_DETAIL =
  '国の想定（最大クラスの地震）にもとづく地域ごとの統計から、建物の種類別の被害の割合を当てはめた推計です。お住まいの建物が実際にどうなるかを示すものではありません。';
