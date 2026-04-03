// ══════════════════════════════════════════════════════════
// src/firebaseSetup.js  —  Firebase Initialization
// ══════════════════════════════════════════════════════════
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

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