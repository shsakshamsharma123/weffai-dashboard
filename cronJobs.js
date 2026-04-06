const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// 1. Initialize Firebase Admin Securely via Environment Variables
if (!admin.apps.length) {
  try {
    // We parse the JSON string stored in Vercel's environment
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error("🔥 CRITICAL: Failed to parse FIREBASE_SERVICE_ACCOUNT env variable.");
    throw error;
  }
}
const db = admin.firestore();

// 2. Configure Email Transporter Securely
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASS 
  }
});

// 3. The Vercel API Route Handler
const runDailyReport = async (req, res) => {
  console.log("⏰ Vercel Cron Triggered: Starting Daily Report Generation...");

  if (process.env.PAUSE_EMAILS === "true") {
    console.log("⏸ Emails are paused via environment variable. Exiting.");
    return res.status(200).json({ success: true, message: "Cron paused. No emails sent." });
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    
    const profilesSnap = await db.collection("worker_profiles").get();
    const statsSnap = await db.collection("daily_stats").doc(today).get();

    if (!statsSnap.exists) {
      console.log(`No efficiency data found for ${today}.`);
      return res.status(200).json({ success: true, message: "No data to report today." });
    }

    const workerProfiles = {};
    profilesSnap.forEach(doc => {
      workerProfiles[doc.id] = doc.data();
    });

    const dailyData = statsSnap.data().workers || {};
    let adminReportText = `WeffAI Daily Efficiency Report\nDate: ${today}\n\n`;

    for (const [wid, stats] of Object.entries(dailyData)) {
      const profile = workerProfiles[wid] || {};
      const name = profile.name || `Worker ${wid}`;
      const email = profile.email || "no-email@company.com";
      const workstation = profile.workstation || "Workstation-1";

      const totalFrames = stats.totalFrames || 1;
      let working = 0, idle = 0, distracted = 0, away = 0;

      if (stats.raw_counts) {
        working = Math.round(((stats.raw_counts.Working || 0) / totalFrames) * 100);
        idle = Math.round(((stats.raw_counts.Idle || 0) / totalFrames) * 100);
        distracted = Math.round(((stats.raw_counts.Distracted || 0) / totalFrames) * 100);
        away = Math.round(((stats.raw_counts.Away || 0) / totalFrames) * 100);
      }

      adminReportText += `[${workstation}] ${name} (ID: ${wid})\n`;
      adminReportText += `Working: ${working}% | Idle: ${idle}% | Distracted: ${distracted}% | Away: ${away}%\n\n`;

      if (email && email.includes("@") && !email.includes("company.com")) {
        const workerText = `Hello ${name},\n\nHere is your daily efficiency summary for ${today}:\n\nWorking: ${working}%\nIdle: ${idle}%\nDistracted: ${distracted}%\nAway: ${away}%\n\nKeep up the great work!\n- WeffAI Automated System`;
        
        await transporter.sendMail({
          from: `"WeffAI Alerts" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: `Your Daily Efficiency Report - ${today}`,
          text: workerText
        });
      }
    }

    await transporter.sendMail({
      from: `"WeffAI Alerts" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER, 
      subject: `End of Day Admin Summary - ${today}`,
      text: adminReportText
    });

    return res.status(200).json({ success: true, message: "All daily reports sent successfully!" });

  } catch (error) {
    console.error("Error generating daily reports:", error);
    return res.status(500).json({ success: false, error: "Failed to run cron job." });
  }
};

module.exports = { runDailyReport };