import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc, doc, query, where } from "firebase/firestore";
const app = initializeApp({ apiKey: "AIzaSyBw45wO_jzZ7RZYm6UsKSTfl7z7irINSs0", projectId: "my-pro-35d45", appId: "1:1046749694292:web:c248f7f228fc3e9f0a60c1", messagingSenderId: "1046749694292" });
const db = getFirestore(app);
// Drop the duplicate open/locked rounds left over from the racy creation path.
const snap = await getDocs(query(collection(db, "ppRounds"), where("status", "in", ["open", "locked"])));
let removed = 0;
for (const d of snap.docs) {
  const preds = await getDocs(query(collection(db, "ppPredictions"), where("roundId", "==", d.id)));
  if (preds.empty) { await deleteDoc(doc(db, "ppRounds", d.id)); removed++; }
}
console.log(`removed ${removed} empty duplicate rounds of ${snap.size}`);
process.exit(0);
