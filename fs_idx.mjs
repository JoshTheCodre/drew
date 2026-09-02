import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
const app = initializeApp({ apiKey: "AIzaSyBw45wO_jzZ7RZYm6UsKSTfl7z7irINSs0", projectId: "my-pro-35d45", appId: "1:1046749694292:web:c248f7f228fc3e9f0a60c1", messagingSenderId: "1046749694292" });
const db = getFirestore(app);
try {
  await getDocs(query(collection(db, "ledger"), where("userId", "==", "nobody"), orderBy("createdAt", "desc"), limit(5)));
  console.log("ledger where+orderBy: OK");
} catch (e) { console.log("ledger where+orderBy FAILS:", e.code, "-", String(e.message).slice(0, 160)); }
try {
  await getDocs(query(collection(db, "ledger"), where("userId", "==", "nobody")));
  console.log("ledger where-only: OK");
} catch (e) { console.log("ledger where-only FAILS:", e.code); }
process.exit(0);
