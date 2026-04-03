// ══════════════════════════════════════════════════════════
// App.js  —  Root Entry Point & Auth Controller
// ══════════════════════════════════════════════════════════
import React, { useState, useEffect } from "react";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

import GlobalStyles from "./styles/GlobalStyles";
import LoginPage    from "./components/LoginPage";
import Dashboard    from "./components/Dashboard"; 

// Firebase setup should be accessible or initialized here
const firebaseConfig = {
  apiKey: "AIzaSyDeT0MJp7Raf0qoJoiS0pKpoi1KM9kM13w",
  authDomain: "weffai-dashboard.firebaseapp.com",
  projectId: "weffai-dashboard",
  storageBucket: "weffai-dashboard.firebasestorage.app",
  messagingSenderId: "257923111216",
  appId: "1:257923111216:web:20ef45984330b1ed4910f5",
  measurementId: "G-BB5XRVGXG3"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser({ 
          email: currentUser.email, 
          name: "Admin", 
          uid: currentUser.uid 
        });
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      const auth = getAuth();
      await signOut(auth);
      setUser(null);
    } catch (error) {
      console.error("Error signing out: ", error);
    }
  };

  if (authLoading) {
    return (
      <div style={{ 
        height: '100vh', width: '100vw', 
        display: 'flex', justifyContent: 'center', alignItems: 'center', 
        background: '#0a1628', color: 'white'
      }}>
        <GlobalStyles />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
           <div style={{ 
             width: '48px', height: '48px', 
             border: '4px solid rgba(255,255,255,0.05)', 
             borderTopColor: '#3b82f6', 
             borderRadius: '50%', 
             animation: 'spin 1s linear infinite' 
           }} />
           <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b' }}>VERIFYING SESSION...</span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <GlobalStyles />
      {user ? (
        <Dashboard user={user} onLogout={handleLogout} />
      ) : (
        <LoginPage onLogin={setUser} />
      )}
    </>
  );
}