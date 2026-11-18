export function centsToRm(cents) {
  const n = Math.trunc(Number(cents) || 0);
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  return sign + Math.floor(a / 100) + "." + String(a % 100).padStart(2, "0");
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function csvResponse(filename, body) {
  return new Response("\uFEFF" + body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

export function constraintMessage(err) {
  const m = String((err && (err.message || err)) || "");
  if (/FOREIGN KEY/i.test(m)) return "还关联着进货或订单，不能删除。";
  if (/UNIQUE/i.test(m) && /legacy/i.test(m)) return "这个前台商品编号已经绑定过了。";
  if (/UNIQUE/i.test(m)) return "资料重复，没有保存。";
  if (/CHECK constraint failed/i.test(m)) return "库存不够，这次没有保存。请先看现有库存再改数量。";
  return null;
}

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return crypto.randomUUID();
}

export function csvCell(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvTable(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
