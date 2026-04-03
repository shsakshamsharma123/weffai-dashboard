// ══════════════════════════════════════════════════════════
// components/LoginPage.jsx
// ══════════════════════════════════════════════════════════
import { useState } from "react";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseSetup"; 

const LoginPage = ({ onLogin }) => {
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  const auth = getAuth();

  const handleLogin = async () => {
    setError("");
    if (!email || !password) { 
      setError("Please enter email and password."); 
      return; 
    }
    setLoading(true);

    try {
      const cleanEmail = email.toLowerCase().trim();
      const adminDoc = await getDoc(doc(db, "allowed_admins", cleanEmail));
      
      if (!adminDoc.exists()) {
        setError("Unauthorized email. You are not registered as an admin.");
        setLoading(false);
        return;
      }
      
      try {
        // 1. First, try to sign in normally
        const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
        onLogin({ email: userCredential.user.email, name: "Admin", uid: userCredential.user.uid });
      } catch (loginError) {
        // 2. In modern Firebase, invalid-credential means EITHER wrong password OR user doesn't exist.
        if (loginError.code === 'auth/invalid-credential' || loginError.code === 'auth/user-not-found') {
            try {
              // Let's try creating the account...
              const newUser = await createUserWithEmailAndPassword(auth, cleanEmail, password);
              onLogin({ email: newUser.user.email, name: "Admin", uid: newUser.user.uid });
            } catch (createError) {
              // 3. If it says email already in use, the account EXISTS, but they typed the wrong password initially!
              if (createError.code === 'auth/email-already-in-use') {
                 throw { code: 'auth/wrong-password', message: 'Incorrect password for this existing account.' };
              } else {
                 throw createError;
              }
            }
        } else {
            throw loginError; 
        }
      }
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError("Invalid password. Please try again.");
      } else if (err.code === 'permission-denied') {
        setError("Database blocked the request. Please update Firestore Rules.");
      } else if (err.code === 'auth/operation-not-allowed') {
        setError("Email/Password sign-in is disabled in Firebase Console.");
      } else {
        setError(err.message || "Authentication failed. Check credentials.");
      }
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    setError("");
    if (!email) {
      setError("Please enter your email address first to reset your password.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.toLowerCase().trim());
      alert(`Password reset email sent to ${email}. Please check your inbox.`);
    } catch (err) {
      console.error(err);
      setError("Failed to send reset email: " + err.message);
    }
  };

  return (
    <div className="login-page">
      <div className="login-gif-panel">
        <img src="/new_webpages.gif" alt="Office" onError={e => e.target.style.display = "none"} />
        <div className="login-gif-overlay">
          <div className="login-brand">Worker Efficiency System</div>
          <div className="login-tagline">Intelligent Monitoring for <span>Modern Workplaces</span></div>
          <div className="login-sub">Real-time worker efficiency tracking powered by computer vision and AI analytics.</div>
        </div>
      </div>
      <div className="login-form-panel">
        <div className="login-logo">
          <img src="/automat_logo.png" alt="Logo"
            style={{ height: 36, objectFit: "contain", marginRight: 8 }}
            onError={e => e.target.style.display = "none"} />
          <div className="login-logo-text" style={{ fontSize: 22 }}>Weff<span>AI</span></div>
        </div>
        <h1 className="form-heading">Welcome back</h1>
        <p className="form-sub">Sign in to your admin dashboard</p>
        
        {error && <div className="login-error">⚠ {error}</div>}
        
        <div className="form-group">
          <label className="form-label">Email Address</label>
          <input className="form-input" type="email" placeholder="admin@company.com"
            value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleLogin()} />
        </div>
        <div className="form-group">
          <label className="form-label">Password</label>
          <input className="form-input" type="password" placeholder="••••••••"
            value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleLogin()} />
        </div>
        <div className="form-forgot">
          <button onClick={handleForgotPassword} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--blue-500)", fontWeight: 500 }}>
            Forgot password?
          </button>
        </div>
        <button className="btn-login" onClick={handleLogin} disabled={loading}>
          {loading ? "Signing in…" : "Sign In →"}
        </button>
        <div className="login-footer">© 2025 WeffAI · Worker Efficiency Intelligence Platform</div>
      </div>
    </div>
  );
};

export default LoginPage;