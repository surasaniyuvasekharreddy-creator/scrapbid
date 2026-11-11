# ScrapBid – reverse-auction marketplace for household scrap

Households post scrap (type, weight, photo). Nearby dealers bid. The seller picks the best offer, the dealer weighs on-site and pays by actual weight; the platform takes a small commission from the dealer.

**Stack:** React (Vite) · Node.js/Express · MongoDB (Mongoose) · Excel export (ExcelJS)

## Run locally
Requires Node 18+ and a running MongoDB (local or Atlas).

```bash
# terminal 1 – API
cd server && cp .env.example .env && npm install && npm start     # http://localhost:5000

# terminal 2 – web app
cd client && npm install && npm run dev                           # http://localhost:5173
```
Register one **seller** and one **dealer** (use two browsers/profiles) to try the full flow.

## Excel storage
MongoDB is the live store. After every change the API also rewrites `server/data/scrapbid.xlsx`
(sheets: Users, Requests, Bids, Transactions). Logged-in users can also click **Download Excel** (`GET /api/export`).

## API
| Method | Path | Role |
|---|---|---|
| POST | /api/auth/register, /api/auth/login | – |
| GET | /api/rates | – |
| POST | /api/requests | seller |
| GET | /api/requests/mine | seller |
| POST | /api/requests/:id/accept `{bidId}` | seller |
| GET | /api/requests/open, /api/requests/won | dealer |
| POST | /api/requests/:id/bids `{offerTotal}` | dealer |
| POST | /api/requests/:id/complete `{actualKg:[]}` | dealer |
| GET | /api/transactions, /api/export | any |

## Not yet built
Dealer KYC/verification, geo-matching (currently all open requests are shown), UPI payments, push notifications, Hindi/Telugu UI, live scrap-rate feed.
