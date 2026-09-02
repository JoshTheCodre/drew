import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, getDocs, collection, query, where } from "firebase/firestore";
const app = initializeApp({ apiKey: "AIzaSyBw45wO_jzZ7RZYm6UsKSTfl7z7irINSs0", projectId: "my-pro-35d45", appId: "1:1046749694292:web:c248f7f228fc3e9f0a60c1", messagingSenderId: "1046749694292" });
const db = getFirestore(app);
const [cmd, arg] = process.argv.slice(2);
if (cmd === "word") {
  const s = await getDoc(doc(db, "wdMatches", arg));
  console.log(s.exists() ? s.data().word : "MISSING");
} else if (cmd === "audit") {
  const wallets = await getDocs(collection(db, "wallets"));
  const ledger = await getDocs(collection(db, "ledger"));
  let bad = 0, deposits = 0, house = 0, playerFunds = 0, escrow = 0;
  const sums = new Map();
  ledger.forEach(d => { const e = d.data();
    const s = sums.get(e.userId) ?? { a: 0, e: 0 }; s.a += e.availableDelta; s.e += e.escrowDelta; sums.set(e.userId, s);
    if (e.kind === "deposit") deposits += e.availableDelta;
  });
  wallets.forEach(d => { const w = d.data(); const s = sums.get(d.id) ?? { a: 0, e: 0 };
    if (s.a !== w.availableCents || s.e !== w.escrowCents) { bad++; console.log("  MISMATCH", d.id, w.availableCents, w.escrowCents, "vs ledger", s.a, s.e); }
    if (w.availableCents < 0 || w.escrowCents < 0) { bad++; console.log("  NEGATIVE", d.id); }
    if (d.id === "house") house = w.availableCents; else { playerFunds += w.availableCents + w.escrowCents; escrow += w.escrowCents; }
  });
  console.log("  wallets:", wallets.size, "| ledger rows:", ledger.size);
  console.log(bad === 0 ? "  OK: every wallet matches its ledger exactly" : `  ${bad} PROBLEMS`);
  console.log("  deposited", deposits, "= player funds", playerFunds, "+ house", house, "->", deposits === playerFunds + house ? "OK: nothing created or destroyed" : "LEAK");
  const active = await getDocs(query(collection(db, "wdMatches"), where("status", "in", ["waiting", "active"])));
  let locked = 0; active.forEach(d => { const m = d.data(); locked += m.status === "active" ? m.stakeCents * 2 : m.stakeCents; });
  console.log("  escrow held", escrow, "| stakes in unsettled matches", locked, "->", escrow === locked ? "OK" : "MISMATCH");
} else if (cmd === "payouts") {
  const l = await getDocs(query(collection(db, "ledger"), where("refId", "==", arg)));
  l.forEach(d => { const e = d.data(); console.log("  ", e.userId.padEnd(22), e.kind.padEnd(14), "avail", String(e.availableDelta).padStart(7), "escrow", String(e.escrowDelta).padStart(7)); });
  console.log("  payout entries:", l.docs.filter(d => d.data().kind === "payout").length);
}
process.exit(0);
