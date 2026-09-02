import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, deleteDoc } from "firebase/firestore";

const app = initializeApp({
  apiKey: "AIzaSyBw45wO_jzZ7RZYm6UsKSTfl7z7irINSs0",
  authDomain: "my-pro-35d45.firebaseapp.com",
  projectId: "my-pro-35d45",
  storageBucket: "my-pro-35d45.firebasestorage.app",
  messagingSenderId: "1046749694292",
  appId: "1:1046749694292:web:c248f7f228fc3e9f0a60c1",
});
const db = getFirestore(app);
const ref = doc(db, "_healthcheck", "ping");
try {
  await setDoc(ref, { at: Date.now() });
  const snap = await getDoc(ref);
  console.log("WRITE+READ OK ->", JSON.stringify(snap.data()));
  await deleteDoc(ref);
  console.log("RESULT: Firestore reachable; rules currently allow this access.");
} catch (e) {
  console.log("RESULT: FAILED:", e.code || e.name, "-", String(e.message).slice(0, 220));
}
process.exit(0);
