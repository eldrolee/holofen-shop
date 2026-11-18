/** 低库存：上架商品库存小于或等于这个数（含 0，前台显示售罄）。 */
export const LOW_STOCK_AT = 2;

/** 进货「已到货」才算进库存。其他状态目标是 0。 */
export function restockTarget(status, qty) {
  return status === "已到货" ? qty : 0;
}

/**
 * 订单一保存就占用库存。取消则目标变回 0。
 * 付款状态不参与，避免「记下订单」和「标已付款」各扣一次。
 */
export function orderTarget(cancelled, qty) {
  return cancelled ? 0 : qty;
}

/**
 * 同一件商品上，旧账已经造成的库存变化和新目标之间的差。
 * delta > 0 表示库存要增加。
 * @param {Map<string, number>} applied 已经作用在库存上的数量（进货是加过的，订单是扣过的）
 * @param {Map<string, number>} target 现在应该作用的数量
 * @param {"restock"|"order"} kind 进货的 applied 是加进去的；订单的 applied 是扣掉的
 */
export function stockDeltas(applied, target, kind) {
  const ids = new Set([...applied.keys(), ...target.keys()]);
  const out = [];
  for (const id of ids) {
    const have = applied.get(id) || 0;
    const want = target.get(id) || 0;
    const delta = kind === "order" ? have - want : want - have;
    if (delta !== 0) out.push({ product_id: id, delta });
  }
  return out;
}
