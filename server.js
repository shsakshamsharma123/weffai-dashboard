require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

// ==========================================
// FIREBASE ADMIN SETUP (For Automated Alerts)
// ==========================================
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. SECURED CREDENTIALS FROM .ENV
// ==========================================
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; 

// ==========================================
// 2. EMAIL CONFIGURATION
// ==========================================
const transporter = nodemailer.createTransport({
  service: 'gmail', 
  auth: {
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASS     
  }
});

// ==========================================
// 3. WHATSAPP ROUTE (Dynamic Template)
// ==========================================
app.post('/api/send-whatsapp', async (req, res) => {
  const { to, adminName, workerName, working, idle, distracted, away, totalFrames, camera } = req.body;

  try {
    const metaUrl = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

    const response = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to, 
        type: "template",
        template: {
          name: "daily_efficiency_alert", 
          language: { code: "en" },       
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: String(adminName) },      
                { type: "text", text: String(workerName) },     
                { type: "text", text: String(working) },        
                { type: "text", text: String(idle) },           
                { type: "text", text: String(distracted) },     
                { type: "text", text: String(away) },           
                { type: "text", text: String(totalFrames) },    
                { type: "text", text: String(camera) }          
              ]
            }
          ]
        }
      })
    });

    const data = await response.json();
    
    if (data.error) {
      console.error("Meta API Error:", data.error);
      return res.status(400).json({ success: false, error: data.error.message });
    }

    console.log("WhatsApp Message Sent successfully:", data.messages[0].id);
    res.status(200).json({ success: true, messageId: data.messages[0].id });

  } catch (error) {
    console.error("Network Error:", error);
    res.status(500).json({ success: false, error: "Failed to connect to WhatsApp API" });
  }
});

// ==========================================
// 4. EMAIL ROUTE
// ==========================================
app.post('/api/send-email', async (req, res) => {
  const { to, subject, body } = req.body;

  try {
    const info = await transporter.sendMail({
      from: `"WeffAI Alerts" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: subject,
      text: body
    });

    console.log("Email sent: %s", info.messageId);
    res.status(200).json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error("Email Error:", error);
    res.status(500).json({ success: false, error: "Failed to send email" });
  }
});

// ==========================================
// 5. AUTOMATED 3-HOUR ALERTS (CRON ENGINE)
// ==========================================
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

const runAutomatedAlerts = async () => {
  console.log(`[${new Date().toISOString()}] ⏰ Triggering Automated 3-Hour Efficiency Alerts...`);
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const statsDoc = await db.collection("daily_stats").doc(todayStr).get();
    
    if (!statsDoc.exists) {
      console.log("ℹ️ No tracking data found for today yet. Skipping automated alerts.");
      return;
    }

    const statsData = statsDoc.data().workers || {};
    
    // Fetch worker profiles to attach correct names and emails
    const profilesSnap = await db.collection("worker_profiles").get();
    const profiles = {};
    profilesSnap.forEach(doc => profiles[doc.id] = doc.data());

    // Process each worker's stats securely on the server
    for (const [workerId, stat] of Object.entries(statsData)) {
      // Skip if the worker doesn't have sufficient frames to report
      if (!stat.totalFrames || stat.totalFrames < 60) continue;

      const profile = profiles[workerId] || {};
      const email = profile.email || `${workerId.toLowerCase()}@company.com`;
      const name = profile.name || `Worker ${workerId}`;
      const workstation = profile.workstation || "Workstation-1";

      // Calculate human readable time matching the Python engine's FPS (1 fps)
      const totalSeconds = Math.floor(stat.totalFrames / 1); 
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const formattedTime = hours > 0 ? `${stat.totalFrames} (approx ${hours} hr ${minutes} min)` : `${stat.totalFrames} (${minutes} min)`;

      console.log(`✉️ Dispatching automated alerts for ${name}...`);

      // 1. Fire Email Alert
      await transporter.sendMail({
        from: `"WeffAI Alerts" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `Automated Efficiency Update: ${name}`,
        text: `Hello ${name},\n\nHere is your automated 3-hour efficiency update:\n\nWorking: ${stat.working}%\nPassive Work: ${stat.idle}%\nDistracted: ${stat.distracted}%\nAway: ${stat.away}%\n\nMonitored Time: ${formattedTime}\nWorkstation: ${workstation}`
      });

      // 2. Fire WhatsApp Alert
      const metaUrl = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
      await fetch(metaUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: "916239037112", // Replace with dynamic worker phone number if added to profile later
          type: "template",
          template: {
            name: "daily_efficiency_alert", 
            language: { code: "en" },       
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: "Automated System" },      
                  { type: "text", text: String(name) },     
                  { type: "text", text: String(stat.working) },        
                  { type: "text", text: String(stat.idle) },           
                  { type: "text", text: String(stat.distracted) },     
                  { type: "text", text: String(stat.away) },           
                  { type: "text", text: String(formattedTime) },    
                  { type: "text", text: String(workstation) }          
                ]
              }
            ]
          }
        })
      });
    }
    console.log("✅ Automated 3-Hour Alerts completed successfully.");
  } catch (error) {
    console.error("❌ Error running automated alerts:", error);
  }
};

// Start the continuous 3-hour background loop
setInterval(runAutomatedAlerts, THREE_HOURS_MS);

// ==========================================
// 6. START SERVER
// ==========================================
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});