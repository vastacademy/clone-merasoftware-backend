const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
require('dotenv').config()
const connnectDB = require("./config/db")
const router = require("./routes")
const fileCleanupScheduler = require('./helpers/fileCleanupScheduler');
const { scheduleAutoRenewal } = require('./cron/autoRenewalCron');
const cron = require("node-cron");
const axios = require("axios");


const app = express()
fileCleanupScheduler.scheduleCleanup();
scheduleAutoRenewal();

console.log('File cleanup scheduler initialized');
console.log('Auto-renewal scheduler initialized');

const rawAllowedOrigins = [
  'https://mera-software.vercel.app',
  'https://www.mera-software.vercel.app',
  'https://merasoftware.com',
  'https://www.merasoftware.com',
  'https://portal.merasoftware.com',
  'https://admin.merasoftware.com',
  'https://partner.merasoftware.com',
  'https://clone-merasoftware-frontend.vercel.app',
  process.env.FORNTEND_URL,
  process.env.FRONTEND_URL,
  process.env.CLIENT_PORTAL_URL,
  process.env.STAFF_PORTAL_URL,
  process.env.ADMIN_PORTAL_URL,
  process.env.PARTNER_PORTAL_URL,
  'http://localhost:3000'
];

const allowedOrigins = rawAllowedOrigins
  .filter(Boolean)
  .map((origin) => origin.replace(/\/$/, ''));

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    const normalisedOrigin = origin.replace(/\/$/, '');
    if (allowedOrigins.includes(normalisedOrigin)) {
      return callback(null, true);
    }

    console.log('Origin not allowed by CORS:', origin);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"]
}));

app.options('*', cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const normalisedOrigin = origin.replace(/\/$/, '');
    if (allowedOrigins.includes(normalisedOrigin)) {
      return callback(null, true);
    }
    console.log('Preflight origin not allowed by CORS:', origin);
    return callback(null, false);
  }
}));


app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ limit: '10mb', extended: true }))
app.use(cookieParser())

app.use("/api", router)

app.use('/uploads', express.static('uploads'));

app.head('/ping', (req, res) => {
  console.log('HEAD Ping received at:', new Date().toISOString());
  res.status(200).end(); // No body, only headers
});


const PORT = process.env.PORT || 8080;
const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL;

// 2️⃣ Cron Job: Har 5 minutes me `/ping` API call karega
cron.schedule("*/5 * * * *", async () => {
  try {
    if (KEEP_ALIVE_URL) {
      await axios.head(KEEP_ALIVE_URL);
      console.log(` ✅ Keep-alive request sent to ${KEEP_ALIVE_URL}`);
    } else {
      console.warn("⚠️ KEEP_ALIVE_URL is not set in .env file");
    }
  } catch (error) {
    console.error("❌ Keep-alive request failed:", error.message);
  }
});

async function startServer() {
  try {
    await connnectDB();
    console.log("Connected to DB");
    app.listen(PORT, () => {
      console.log("Server is running " + PORT);
    });
  } catch (error) {
    console.error("Failed to connect to DB:", error.message);
    process.exit(1);
  }
}

startServer();
