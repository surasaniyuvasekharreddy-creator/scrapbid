let token = localStorage.getItem("token");
export const setToken = t => { token = t; t ? localStorage.setItem("token", t) : localStorage.removeItem("token"); };
export async function api(path, method = "GET", body) {
  const res = await fetch("/api" + path, { method, headers: { "Content-Type": "application/json", ...(token && { Authorization: "Bearer " + token }) }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
export async function downloadExcel() {
  const res = await fetch("/api/export", { headers: { Authorization: "Bearer " + token } });
  const a = document.createElement("a"); a.href = URL.createObjectURL(await res.blob()); a.download = "scrapbid.xlsx"; a.click();
}
export const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");
