import express from "express";
import crypto from "crypto";
import pg from "pg";

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_SECRET = process.env.SHARKBOT_WEBHOOK_SECRET || "";
const WIDGET_KEY = process.env.WIDGET_KEY || "";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false });

await pool.query(`
  CREATE TABLE IF NOT EXISTS payments (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT UNIQUE,
    transaction_id TEXT,
    amount_cents BIGINT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

function verifySignature(rawBody, header) {
  if (!WEBHOOK_SECRET) return true; // Development mode only.
  if (!header) return false;

  let supplied = header.trim();
  if (supplied.startsWith("sha256=")) supplied = supplied.slice(7);

  // SharkBot's UI states that the request is signed with HMAC-SHA256.
  // We calculate it over the exact/raw request body.
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

  const a = Buffer.from(supplied, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function firstValue(obj, keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null) return obj[key];
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = firstValue(value, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function toCents(value) {
  if (value == null) return null;
  if (typeof value === "number") return Math.round(value * 100);
  const s = String(value).trim().replace(/\s/g, "").replace("R$", "");
  // Handles both 123.45 and Brazilian 123,45 formats.
  if (s.includes(",") && s.includes(".")) {
    return Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100);
  }
  if (s.includes(",")) return Math.round(Number(s.replace(",", ".")) * 100);
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function extractPayment(body) {
  const event = body?.event ?? body?.type ?? body?.name ?? "payment.approved";
  const eventId = firstValue(body, ["event_id", "eventId", "id", "delivery_id", "deliveryId"]);
  const transactionId = firstValue(body, [
    "transaction_id", "transactionId", "payment_id", "paymentId", "sale_id", "saleId"
  ]);
  const amount = firstValue(body, [
    "amount", "value", "gross_amount", "grossAmount", "amount_paid", "amountPaid",
    "sale_amount", "saleAmount", "price", "total"
  ]);
  const occurredAt = firstValue(body, [
    "paid_at", "paidAt", "approved_at", "approvedAt", "created_at", "createdAt", "timestamp"
  ]);

  return {
    event: String(event),
    eventId: eventId ? String(eventId) : null,
    transactionId: transactionId ? String(transactionId) : null,
    amountCents: toCents(amount),
    occurredAt: occurredAt ? new Date(occurredAt) : new Date()
  };
}

// Capture the raw body because HMAC signatures must be checked against the exact bytes.
app.post("/webhook/sharkbot", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    if (!verifySignature(req.body, req.header("X-Webhook-Signature"))) {
      return res.status(401).json({ error: "invalid_signature" });
    }

    let body;
    try {
      body = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "invalid_json" });
    }

    const payment = extractPayment(body);

    // Only count approved/paid events. The UI in the user's SharkBot account calls this "Pagamento Aprovado".
    const approved = /approved|paid|payment\.approved|payment\.paid|pagamento.?aprovado/i.test(payment.event);
    if (!approved) return res.status(200).json({ received: true, counted: false });

    if (payment.amountCents == null) {
      // We intentionally do not store the raw payload because it may contain customer PII.
      return res.status(422).json({
        error: "amount_not_found",
        message: "The webhook was received, but the amount field was not recognized. Check the SharkBot example payload and adapt extractPayment()."
      });
    }

    const eventId = payment.eventId || payment.transactionId || crypto.createHash("sha256").update(req.body).digest("hex");

    await pool.query(
      `INSERT INTO payments (event_id, transaction_id, amount_cents, occurred_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, payment.transactionId, payment.amountCents, payment.occurredAt]
    );

    return res.status(200).json({ received: true, counted: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server_error" });
  }
});

app.use(express.json());

function authorized(req, res, next) {
  if (!WIDGET_KEY) return res.status(503).json({ error: "WIDGET_KEY_not_configured" });
  if (req.header("X-Widget-Key") !== WIDGET_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/stats", authorized, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM(amount_cents) FILTER (WHERE occurred_at >= CURRENT_DATE),0) AS today_cents,
      COUNT(*) FILTER (WHERE occurred_at >= CURRENT_DATE) AS today_sales,
      COALESCE(SUM(amount_cents),0) AS total_cents,
      COUNT(*) AS total_sales
    FROM payments
  `);
  res.json({
    today: {
      sales: Number(rows[0].today_sales),
      amount: Number(rows[0].today_cents) / 100
    },
    total: {
      sales: Number(rows[0].total_sales),
      amount: Number(rows[0].total_cents) / 100
    },
    updatedAt: new Date().toISOString()
  });
});

app.listen(PORT, () => console.log(`SharkBot widget server listening on ${PORT}`));
