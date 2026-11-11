import { useEffect, useState, useCallback } from "react";
import { api, setToken, downloadExcel, inr } from "./api.js";

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem("user") || "null"));
  const login = (d) => { setToken(d.token); localStorage.setItem("user", JSON.stringify(d.user)); setUser(d.user); };
  const logout = () => { setToken(null); localStorage.removeItem("user"); setUser(null); };
  return (
    <div className="wrap">
      <header><h1>ScrapBid</h1>
        {user && <div className="right"><span>{user.name} ({user.role})</span>
          <button className="ghost" onClick={downloadExcel}>Download Excel</button>
          <button className="ghost" onClick={logout}>Log out</button></div>}
      </header>
      {!user ? <Auth onLogin={login} /> : user.role === "seller" ? <Seller /> : <Dealer />}
    </div>
  );
}

function Auth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ role: "seller" }); const [err, setErr] = useState("");
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const submit = async () => { try { onLogin(await api(`/auth/${mode}`, "POST", f)); } catch (e) { setErr(e.message); } };
  return (
    <div className="box">
      <h2>{mode === "login" ? "Log in" : "Create account"}</h2>
      {mode === "register" && <>
        <label>Name<input onChange={set("name")} /></label>
        <label>I am a<select value={f.role} onChange={set("role")}><option value="seller">Household (seller)</option><option value="dealer">Scrap dealer</option></select></label>
        <label>Address<input onChange={set("address")} /></label></>}
      <label>Phone<input onChange={set("phone")} /></label>
      <label>Password<input type="password" onChange={set("password")} /></label>
      {err && <p className="err">{err}</p>}
      <button className="main" onClick={submit}>{mode === "login" ? "Log in" : "Register"}</button>
      <button className="link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}>
        {mode === "login" ? "New here? Create an account" : "Have an account? Log in"}</button>
    </div>
  );
}

function usePoll(path, ms = 4000) {
  const [d, setD] = useState([]);
  const load = useCallback(() => api(path).then(setD).catch(() => {}), [path]);
  useEffect(() => { load(); const t = setInterval(load, ms); return () => clearInterval(t); }, [load, ms]);
  return [d, load];
}

function Seller() {
  const [rates, setRates] = useState({}); const [items, setItems] = useState([]);
  const [cat, setCat] = useState("Newspaper"), [kg, setKg] = useState(10), [photo, setPhoto] = useState(null), [address, setAddress] = useState("");
  const [reqs, reload] = usePoll("/requests/mine"); const [txns] = usePoll("/transactions", 8000);
  useEffect(() => { api("/rates").then(setRates); }, []);
  const readPhoto = e => { const f = e.target.files[0]; if (!f) return setPhoto(null); const r = new FileReader(); r.onload = () => setPhoto(r.result); r.readAsDataURL(f); };
  const add = () => { if (kg > 0) { setItems([...items, { category: cat, estKg: +kg, photo }]); setPhoto(null); } };
  const post = async () => { await api("/requests", "POST", { items, address }); setItems([]); reload(); };
  const market = items.reduce((a, i) => a + i.estKg * rates[i.category], 0);
  return (<>
    <div className="box"><h2>Sell scrap</h2>
      <div className="row"><label>Type<select value={cat} onChange={e => setCat(e.target.value)}>{Object.keys(rates).map(k => <option key={k}>{k}</option>)}</select></label>
        <label>Weight (kg)<input type="number" min="0.5" step="0.5" value={kg} onChange={e => setKg(e.target.value)} /></label></div>
      <label>Photo<input type="file" accept="image/*" onChange={readPhoto} /></label>
      <button className="ghost" onClick={add}>Add item</button>
      {items.map((i, k) => <div className="item" key={k}>{i.photo && <img src={i.photo} alt="" />}<b>{i.category}</b><span>{i.estKg} kg</span>
        <button className="x" onClick={() => setItems(items.filter((_, j) => j !== k))}>×</button></div>)}
      {items.length > 0 && <><p className="mute">Typical market value: {inr(market)}</p>
        <label>Pickup address<input value={address} onChange={e => setAddress(e.target.value)} /></label>
        <button className="main" onClick={post}>Ask dealers for offers</button></>}
    </div>
    {reqs.map(r => <div className="box" key={r._id}>
      <h3>{r.items.map(i => `${i.category} ${i.estKg}kg`).join(", ")} <span className="pill">{r.status}</span></h3>
      {r.status === "open" && (r.bids.length ? r.bids.map((b, k) => <div className={"tag" + (k === 0 ? " best" : "")} key={b._id}>
        <div><b>{b.dealer?.name}</b> ★ {b.dealer?.rating} · {b.distanceKm} km</div><div className="big">{inr(b.offerTotal)}</div>
        <button className="main" onClick={async () => { await api(`/requests/${r._id}/accept`, "POST", { bidId: b._id }); reload(); }}>Choose dealer</button></div>)
        : <p className="mute">Waiting for dealer offers…</p>)}
      {r.status === "accepted" && <p>Dealer is coming to weigh and pay you. Rates are locked; only the weight can change.</p>}
    </div>)}
    {txns.length > 0 && <div className="box"><h3>Completed sales</h3>{txns.map(t => <div className="item" key={t._id}><span>{new Date(t.createdAt).toLocaleDateString()}</span><b>{inr(t.payout)}</b></div>)}</div>}
  </>);
}

function Dealer() {
  const [open, reload] = usePoll("/requests/open"); const [won, reloadWon] = usePoll("/requests/won");
  const [txns] = usePoll("/transactions", 8000);
  return (<>
    <h2>Pickups you won</h2>
    {won.length === 0 && <p className="mute">None yet.</p>}
    {won.map(r => <Weigh key={r._id} r={r} done={() => { reloadWon(); reload(); }} />)}
    <h2>Open requests</h2>
    {open.length === 0 && <p className="mute">No open requests nearby.</p>}
    {open.map(r => <Offer key={r._id} r={r} done={reload} />)}
    {txns.length > 0 && <div className="box"><h3>Completed</h3>{txns.map(t => <div className="item" key={t._id}><span>Payout {inr(t.payout)}</span><span>Commission {inr(t.commission)}</span></div>)}</div>}
  </>);
}
function Offer({ r, done }) {
  const [v, setV] = useState(r.myBid?.offerTotal || ""); const [err, setErr] = useState("");
  return <div className="box"><h3>{r.items.map(i => `${i.category} ${i.estKg}kg`).join(", ")}</h3>
    <div className="thumbs">{r.items.filter(i => i.photo).map((i, k) => <img key={k} src={i.photo} alt="" />)}</div>
    <p className="mute">{r.seller?.name} · {r.address}</p>
    <label>Your offer for the full lot (₹)<input type="number" value={v} onChange={e => setV(e.target.value)} /></label>
    {err && <p className="err">{err}</p>}
    <button className="main" onClick={async () => { try { await api(`/requests/${r._id}/bids`, "POST", { offerTotal: +v }); done(); } catch (e) { setErr(e.message); } }}>
      {r.myBid ? "Update offer" : "Submit offer"}</button></div>;
}
function Weigh({ r, done }) {
  const [w, setW] = useState(r.items.map(i => i.estKg));
  const pay = r.items.reduce((a, i, k) => a + (+w[k] || 0) * r.bid.rates[i.category], 0);
  return <div className="box"><h3>{r.seller?.name} · {r.address}</h3>
    {r.items.map((i, k) => <div className="item" key={k}><b>{i.category}</b><span className="mute">{inr(r.bid.rates[i.category])}/kg</span>
      <input type="number" step="0.1" value={w[k]} onChange={e => setW(w.map((x, j) => j === k ? e.target.value : x))} /> kg</div>)}
    <p><b>Pay seller: {inr(pay)}</b></p>
    <button className="main" onClick={async () => { await api(`/requests/${r._id}/complete`, "POST", { actualKg: w.map(Number) }); done(); }}>Confirm weight &amp; complete</button></div>;
}
