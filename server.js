require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

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
// 5. START SERVER
// ==========================================
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});