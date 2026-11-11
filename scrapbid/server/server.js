require("dotenv").config();
const express = require("express"), cors = require("cors"), mongoose = require("mongoose");
const jwt = require("jsonwebtoken"), bcrypt = require("bcryptjs"), ExcelJS = require("exceljs");
const path = require("path"), fs = require("fs");

const RATES = { Newspaper: 14, Cardboard: 8, "Books & mixed paper": 10, Iron: 30, Plastic: 12,
  Aluminium: 105, Brass: 380, Copper: 700, "Small e-waste": 30 }; // indicative Rs/kg
const COMMISSION = parseFloat(process.env.COMMISSION || "0.03");
const XLSX_PATH = path.join(__dirname, "data", "scrapbid.xlsx");

/* ---------- models ---------- */
const User = mongoose.model("User", new mongoose.Schema({
  name: String, phone: { type: String, unique: true }, password: String,
  role: { type: String, enum: ["seller", "dealer"] }, address: String, rating: { type: Number, default: 4.5 },
}, { timestamps: true }));
const Request = mongoose.model("Request", new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, address: String,
  items: [{ category: String, estKg: Number, photo: String }],
  status: { type: String, enum: ["open", "accepted", "completed", "cancelled"], default: "open" },
  acceptedBid: { type: mongoose.Schema.Types.ObjectId, ref: "Bid" },
}, { timestamps: true }));
const Bid = mongoose.model("Bid", new mongoose.Schema({
  request: { type: mongoose.Schema.Types.ObjectId, ref: "Request" },
  dealer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  offerTotal: Number, rates: Object, distanceKm: Number,
}, { timestamps: true }));
const Txn = mongoose.model("Txn", new mongoose.Schema({
  request: { type: mongoose.Schema.Types.ObjectId, ref: "Request" },
  bid: { type: mongoose.Schema.Types.ObjectId, ref: "Bid" },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  dealer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  lines: [{ category: String, estKg: Number, actualKg: Number, rate: Number, amount: Number }],
  payout: Number, commission: Number,
}, { timestamps: true }));

/* ---------- Excel sync: every change rewrites data/scrapbid.xlsx ---------- */
async function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = (name, cols, rows) => {
    const ws = wb.addWorksheet(name);
    ws.columns = cols.map(c => ({ header: c, key: c, width: Math.max(14, c.length + 4) }));
    ws.getRow(1).font = { bold: true };
    rows.forEach(r => ws.addRow(r));
  };
  const [users, reqs, bids, txns] = await Promise.all([
    User.find().lean(), Request.find().lean(), Bid.find().lean(), Txn.find().lean()]);
  sheet("Users", ["id", "name", "phone", "role", "address", "createdAt"],
    users.map(u => ({ id: String(u._id), name: u.name, phone: u.phone, role: u.role, address: u.address, createdAt: u.createdAt })));
  sheet("Requests", ["id", "sellerId", "address", "items", "totalEstKg", "status", "createdAt"],
    reqs.map(r => ({ id: String(r._id), sellerId: String(r.seller), address: r.address,
      items: r.items.map(i => `${i.category} ${i.estKg}kg`).join("; "),
      totalEstKg: r.items.reduce((a, i) => a + i.estKg, 0), status: r.status, createdAt: r.createdAt })));
  sheet("Bids", ["id", "requestId", "dealerId", "offerTotal", "distanceKm", "createdAt"],
    bids.map(b => ({ id: String(b._id), requestId: String(b.request), dealerId: String(b.dealer),
      offerTotal: b.offerTotal, distanceKm: b.distanceKm, createdAt: b.createdAt })));
  sheet("Transactions", ["id", "requestId", "sellerId", "dealerId", "actualKg", "payout", "commission", "createdAt"],
    txns.map(t => ({ id: String(t._id), requestId: String(t.request), sellerId: String(t.seller), dealerId: String(t.dealer),
      actualKg: t.lines.reduce((a, l) => a + l.actualKg, 0), payout: t.payout, commission: t.commission, createdAt: t.createdAt })));
  return wb;
}
let syncing = Promise.resolve();
const syncExcel = () => (syncing = syncing.then(async () => {
  try { fs.mkdirSync(path.dirname(XLSX_PATH), { recursive: true }); await (await buildWorkbook()).xlsx.writeFile(XLSX_PATH); }
  catch (e) { console.error("Excel sync failed:", e.message); }
}));

/* ---------- app + auth ---------- */
const app = express();
app.use(cors()); app.use(express.json({ limit: "15mb" }));
const sign = u => jwt.sign({ id: u._id, role: u.role }, process.env.JWT_SECRET || "dev", { expiresIn: "7d" });
const auth = (role) => (req, res, next) => {
  try {
    const p = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), process.env.JWT_SECRET || "dev");
    if (role && p.role !== role) return res.status(403).json({ error: "Not allowed for your role" });
    req.user = p; next();
  } catch { res.status(401).json({ error: "Please log in" }); }
};
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: e.message }); });

app.get("/api/rates", (_, res) => res.json(RATES));

app.post("/api/auth/register", wrap(async (req, res) => {
  const { name, phone, password, role, address } = req.body;
  if (!name || !phone || !password || !["seller", "dealer"].includes(role)) return res.status(400).json({ error: "Missing fields" });
  if (await User.findOne({ phone })) return res.status(409).json({ error: "Phone already registered" });
  const u = await User.create({ name, phone, role, address, password: await bcrypt.hash(password, 10) });
  syncExcel(); res.json({ token: sign(u), user: { id: u._id, name, role } });
}));
app.post("/api/auth/login", wrap(async (req, res) => {
  const u = await User.findOne({ phone: req.body.phone });
  if (!u || !(await bcrypt.compare(req.body.password || "", u.password))) return res.status(401).json({ error: "Wrong phone or password" });
  res.json({ token: sign(u), user: { id: u._id, name: u.name, role: u.role } });
}));

/* seller */
app.post("/api/requests", auth("seller"), wrap(async (req, res) => {
  const items = (req.body.items || []).filter(i => RATES[i.category] && i.estKg > 0);
  if (!items.length) return res.status(400).json({ error: "Add at least one item" });
  const r = await Request.create({ seller: req.user.id, items, address: req.body.address });
  syncExcel(); res.json(r);
}));
app.get("/api/requests/mine", auth("seller"), wrap(async (req, res) => {
  const rs = await Request.find({ seller: req.user.id }).sort("-createdAt").lean();
  for (const r of rs) r.bids = await Bid.find({ request: r._id }).populate("dealer", "name rating").sort("-offerTotal").lean();
  res.json(rs);
}));
app.post("/api/requests/:id/accept", auth("seller"), wrap(async (req, res) => {
  const r = await Request.findOne({ _id: req.params.id, seller: req.user.id, status: "open" });
  const b = r && await Bid.findOne({ _id: req.body.bidId, request: r._id });
  if (!b) return res.status(404).json({ error: "Request or bid not found" });
  r.status = "accepted"; r.acceptedBid = b._id; await r.save(); syncExcel(); res.json(r);
}));

/* dealer */
app.get("/api/requests/open", auth("dealer"), wrap(async (req, res) => {
  const rs = await Request.find({ status: "open" }).sort("-createdAt").populate("seller", "name").lean();
  const mine = await Bid.find({ dealer: req.user.id }).lean();
  res.json(rs.map(r => ({ ...r, myBid: mine.find(b => String(b.request) === String(r._id)) || null })));
}));
app.get("/api/requests/won", auth("dealer"), wrap(async (req, res) => {
  const bids = await Bid.find({ dealer: req.user.id }).lean();
  const rs = await Request.find({ acceptedBid: { $in: bids.map(b => b._id) }, status: "accepted" }).populate("seller", "name").lean();
  res.json(rs.map(r => ({ ...r, bid: bids.find(b => String(b._id) === String(r.acceptedBid)) })));
}));
app.post("/api/requests/:id/bids", auth("dealer"), wrap(async (req, res) => {
  const r = await Request.findOne({ _id: req.params.id, status: "open" });
  const offer = Number(req.body.offerTotal);
  if (!r || !(offer > 0)) return res.status(400).json({ error: "Request closed or offer invalid" });
  const market = r.items.reduce((a, i) => a + i.estKg * RATES[i.category], 0);
  const f = offer / market, rates = {};
  r.items.forEach(i => { rates[i.category] = +(RATES[i.category] * f).toFixed(2); }); // per-kg rates locked at bid time
  const b = await Bid.findOneAndUpdate({ request: r._id, dealer: req.user.id },
    { offerTotal: offer, rates, distanceKm: +(1 + Math.random() * 3).toFixed(1) }, { upsert: true, new: true });
  syncExcel(); res.json(b);
}));
app.post("/api/requests/:id/complete", auth("dealer"), wrap(async (req, res) => {
  const r = await Request.findOne({ _id: req.params.id, status: "accepted" });
  const b = r && await Bid.findOne({ _id: r.acceptedBid, dealer: req.user.id });
  if (!b) return res.status(404).json({ error: "Not your pickup" });
  const w = req.body.actualKg || [];
  const lines = r.items.map((i, k) => { const kg = Math.max(0, Number(w[k]) || 0), rate = b.rates[i.category];
    return { category: i.category, estKg: i.estKg, actualKg: kg, rate, amount: +(kg * rate).toFixed(2) }; });
  const payout = +lines.reduce((a, l) => a + l.amount, 0).toFixed(2);
  const t = await Txn.create({ request: r._id, bid: b._id, seller: r.seller, dealer: req.user.id, lines, payout, commission: +(payout * COMMISSION).toFixed(2) });
  r.status = "completed"; await r.save(); syncExcel(); res.json(t);
}));

app.get("/api/transactions", auth(), wrap(async (req, res) => {
  const q = req.user.role === "seller" ? { seller: req.user.id } : { dealer: req.user.id };
  res.json(await Txn.find(q).sort("-createdAt").lean());
}));
app.get("/api/export", auth(), wrap(async (req, res) => { // live Excel download
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=scrapbid.xlsx");
  await (await buildWorkbook()).xlsx.write(res); res.end();
}));

mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/scrapbid").then(() => {
  syncExcel(); app.listen(process.env.PORT || 5000, () => console.log("API on :" + (process.env.PORT || 5000)));
}).catch(e => { console.error("MongoDB connection failed:", e.message); process.exit(1); });
