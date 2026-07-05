// ═══════════════════════════════════════════════════════════════
//  firebase-backend.js  —  QMS GALAXY  |  Secure Backend Layer
//  This file is THIS app's own dedicated backend — it must point at
//  its own Firebase project, never the "skr-task" project shared by
//  your other 5 apps. See setup-guide.html for how to provision one.
//
//  Loaded by index.html via:
//    <script type="module" src="firebase-backend.js"></script>
//
//  It exposes window.fb* functions that index.html's inline script
//  calls — same pattern as your other app's firebase-backend.js.
// ═══════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, setDoc, getDoc, query, orderBy, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, sendEmailVerification, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ⚠️ SECURITY: this MUST be a Firebase project dedicated to THIS app only —
// do not reuse "skr-task" (the project shared by your other 5 apps).
// Create a new project in the Firebase Console, enable Email/Password
// sign-in under Authentication, then paste its config below.
const firebaseConfig = {
  apiKey: "AIzaSyB7NRvppBiezuf7tMGOL7reo_fckVWNctY",
  authDomain: "skr-task.firebaseapp.com",
  projectId: "skr-task",
  storageBucket: "skr-task.firebasestorage.app",
  messagingSenderId: "1011690659933",
  appId: "1:1011690659933:web:ab66955064274828682db4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ════════════════════════════════════════════════════════════════
//  REAL ADMIN AUTH — replaces the old client-side PIN check.
//  The PIN was cosmetic: anyone could open devtools, see it was just
//  a JS `if` check, and call window.fbSaveEnquiry / write to Firestore
//  directly. The actual gate now lives in TWO places a user cannot
//  bypass from the browser:
//   1) Firebase Authentication (a real server-verified login)
//   2) Firestore Security Rules (see firestore.rules) which check
//      request.auth.uid against an "admins" collection before
//      allowing any write to protected data.
// ════════════════════════════════════════════════════════════════
window.fbAdminLogin = async function(email, password){
  try{
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const adminSnap = await getDoc(doc(db, "admins", cred.user.uid));
    if(!adminSnap.exists()){
      await signOut(auth);
      return { success:false, error:"This account is not authorized as an admin." };
    }
    return { success:true, uid:cred.user.uid };
  } catch(e){
    var map = {
      "auth/user-not-found":"No account found with this email.",
      "auth/wrong-password":"Incorrect password.",
      "auth/invalid-credential":"Incorrect email or password.",
      "auth/invalid-email":"Invalid email address.",
      "auth/too-many-requests":"Too many attempts. Try again later."
    };
    return { success:false, error: map[e.code] || "Login failed. Please try again." };
  }
};
window.fbAdminLogout = async function(){ try{ await signOut(auth); }catch(e){} };
window.fbChangeAdminPassword = async function(newPass){
  try{
    if(!auth.currentUser) return { success:false, error:"Not signed in." };
    await updatePassword(auth.currentUser, newPass);
    return { success:true };
  } catch(e){
    if(e.code === "auth/requires-recent-login"){
      return { success:false, error:"For security, please sign out and sign back in, then try again." };
    }
    return { success:false, error: e.message || "Could not update password." };
  }
};
window.fbOnAdminAuthChange = function(cb){ return onAuthStateChanged(auth, cb); };
window.fbAdminSendPasswordReset = async function(email){
  try{
    await sendPasswordResetEmail(auth, email);
    return { success:true };
  } catch(e){
    var map = {
      "auth/user-not-found":"No account found with this email.",
      "auth/invalid-email":"Please enter a valid email address.",
      "auth/too-many-requests":"Too many attempts. Try again later."
    };
    // Note: Firebase intentionally does NOT distinguish "user not found" in
    // some project configurations (to avoid leaking which emails exist).
    // If your project has "Email enumeration protection" on, this will
    // return success even for unregistered emails — that's expected.
    return { success:false, error: map[e.code] || e.message || "Could not send reset email." };
  }
};

function fbStatus(ok, msg){
  var el = document.getElementById("fb-status");
  if(!el){ el=document.createElement("div"); el.id="fb-status";
    el.style.cssText="position:fixed;bottom:70px;right:20px;z-index:9999;padding:8px 16px;border-radius:8px;font-size:0.78rem;font-family:'Exo 2',sans-serif;font-weight:600;pointer-events:none;transition:opacity 0.5s;";
    document.body.appendChild(el); }
  el.style.background = ok ? "rgba(0,200,83,0.15)" : "rgba(255,80,80,0.15)";
  el.style.border = ok ? "1px solid rgba(0,200,83,0.4)" : "1px solid rgba(255,80,80,0.4)";
  el.style.color = ok ? "#69f0ae" : "#ff8a8a";
  el.style.opacity = "1";
  el.textContent = (ok ? "🔥 Firebase: " : "⚠ Firebase: ") + msg;
  clearTimeout(el._t);
  el._t = setTimeout(function(){ el.style.opacity="0"; }, 3000);
}

// 1. CONTACT FORM ENQUIRIES
window.fbSaveEnquiry = async function(entry){
  try{
    await addDoc(collection(db,"qms_enquiries"), {
      name: entry.name||"", email: entry.email||"", phone: entry.phone||"",
      service: entry.service||"General", message: entry.message||"",
      reply: "", time: serverTimestamp(), timeStr: entry.time||""
    });
    fbStatus(true,"Enquiry saved");
  } catch(e){ fbStatus(false,"Enquiry save failed"); console.error(e); }
};

window.fbGetEnquiries = async function(){
  try{
    var q = query(collection(db,"qms_enquiries"), orderBy("time","desc"));
    var snap = await getDocs(q);
    return snap.docs.map(function(d){ return Object.assign({fbId:d.id},d.data()); });
  } catch(e){ fbStatus(false,"Load enquiries failed"); return []; }
};

window.fbUpdateEnquiryReply = async function(fbId, reply){
  try{ await updateDoc(doc(db,"qms_enquiries",fbId),{reply:reply}); fbStatus(true,"Reply saved"); }
  catch(e){ fbStatus(false,"Reply save failed"); }
};

window.fbDeleteEnquiry = async function(fbId){
  try{ await deleteDoc(doc(db,"qms_enquiries",fbId)); fbStatus(true,"Enquiry deleted"); }
  catch(e){ fbStatus(false,"Delete failed"); }
};

// 2. PAYMENT / ORDER RECORDS
window.fbSavePayment = async function(record){
  try{
    await addDoc(collection(db,"qms_payments"),{
      productName: record.productName||"Consultancy Services",
      amount: record.amount||0, mode: record.mode||"",
      invoiceNo: record.invoiceNo||"", time: serverTimestamp(),
      timeStr: new Date().toLocaleString("en-IN"), status: "initiated"
    });
    fbStatus(true,"Payment recorded");
  } catch(e){ fbStatus(false,"Payment record failed"); console.error(e); }
};

window.fbGetPayments = async function(){
  try{
    var q = query(collection(db,"qms_payments"), orderBy("time","desc"));
    var snap = await getDocs(q);
    return snap.docs.map(function(d){ return Object.assign({fbId:d.id},d.data()); });
  } catch(e){ fbStatus(false,"Load payments failed"); return []; }
};

// 3. ADMIN SETTINGS & PRODUCTS
window.fbSaveSiteConfig = async function(data){
  try{
    var toSave = JSON.parse(JSON.stringify(data));
    delete toSave.pin; // NEVER store PIN in Firebase
    delete toSave.logoSrc; // base64 image — too large for Firestore, kept in localStorage only
    // Strip base64 product images — store only text fields in Firestore
    if(Array.isArray(toSave.products)){
      toSave.products = toSave.products.map(function(p){
        var pc = Object.assign({}, p);
        delete pc.imgSrc;
        return pc;
      });
    }
    await setDoc(doc(db,"qms_siteconfig","main"), toSave, {merge:true});
    fbStatus(true,"Settings synced to cloud");
  } catch(e){ fbStatus(false,"Settings sync failed"); console.error(e); }
};

window.fbLoadSiteConfig = async function(){
  try{
    var snap = await getDoc(doc(db,"qms_siteconfig","main"));
    if(snap.exists()){ fbStatus(true,"Settings loaded"); return snap.data(); }
    return null;
  } catch(e){ fbStatus(false,"Settings load failed"); return null; }
};

// 4. FORUM MEMBERS — real Firebase Authentication accounts.
// Previously this stored a plaintext `pass` field directly in Firestore
// (readable by anyone with read access to the collection). Passwords are
// now verified by Firebase's servers and never stored or transmitted as
// plaintext by this app. Firestore only holds a public, secret-free
// profile: { name, username, role, joined } — no email, no password.
window.fbForumRegister = async function(name, username, email, password){
  try{
    // Check username availability BEFORE creating the auth account, so a
    // taken username doesn't leave behind an orphaned login with no profile.
    var uq = query(collection(db,"qms_forum_profiles"), where("username","==",username));
    var uSnap = await getDocs(uq);
    if(!uSnap.empty){
      return { success:false, error:"Username already taken. Choose another." };
    }
    var cred = await createUserWithEmailAndPassword(auth, email, password);
    var profile = {
      name: name||"", username: username||"", role:"Member",
      joined: new Date().toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})
    };
    await setDoc(doc(db,"qms_forum_profiles", cred.user.uid), profile);
    try{ await sendEmailVerification(cred.user); }catch(_){ /* non-fatal — account still works */ }
    fbStatus(true,"Account created");
    return { success:true, profile: Object.assign({id:cred.user.uid, emailVerified:cred.user.emailVerified}, profile) };
  } catch(e){
    var map = {
      "auth/email-already-in-use":"This email is already registered.",
      "auth/weak-password":"Password must be at least 6 characters.",
      "auth/invalid-email":"Please enter a valid email address."
    };
    return { success:false, error: map[e.code] || e.message || "Registration failed." };
  }
};

window.fbForumLogin = async function(email, password){
  try{
    var cred = await signInWithEmailAndPassword(auth, email, password);
    var snap = await getDoc(doc(db,"qms_forum_profiles", cred.user.uid));
    if(!snap.exists()){
      await signOut(auth);
      return { success:false, error:"No forum profile found for this account." };
    }
    return { success:true, profile: Object.assign({id:cred.user.uid, emailVerified:cred.user.emailVerified}, snap.data()) };
  } catch(e){
    var map = {
      "auth/user-not-found":"No account found with this email.",
      "auth/wrong-password":"Incorrect password.",
      "auth/invalid-credential":"Incorrect email or password.",
      "auth/invalid-email":"Invalid email address.",
      "auth/too-many-requests":"Too many attempts. Try again later."
    };
    return { success:false, error: map[e.code] || "Login failed. Please try again." };
  }
};

window.fbForumLogout = async function(){ try{ await signOut(auth); }catch(e){} };

window.fbForumResendVerification = async function(){
  try{
    if(!auth.currentUser) return { success:false, error:"Not signed in." };
    if(auth.currentUser.emailVerified) return { success:false, error:"This email is already verified." };
    await sendEmailVerification(auth.currentUser);
    return { success:true };
  } catch(e){
    if(e.code === "auth/too-many-requests"){
      return { success:false, error:"Too many requests — please wait a bit before retrying." };
    }
    return { success:false, error: e.message || "Could not send verification email." };
  }
};

window.fbForumSendPasswordReset = async function(email){
  try{
    await sendPasswordResetEmail(auth, email);
    return { success:true };
  } catch(e){
    var map = {
      "auth/user-not-found":"No account found with this email.",
      "auth/invalid-email":"Please enter a valid email address.",
      "auth/too-many-requests":"Too many attempts. Try again later."
    };
    return { success:false, error: map[e.code] || e.message || "Could not send reset email." };
  }
};

// Admin panel: list/remove forum member PROFILES. Note: deleting a profile
// here removes them from the forum's member list, but does NOT delete
// their underlying Firebase Authentication account — client code cannot
// delete other users' auth accounts (this requires the Admin SDK / a
// server). To fully remove someone's login ability, also delete their
// entry under Authentication → Users in the Firebase Console.
window.fbGetForumProfiles = async function(){
  try{
    var snap = await getDocs(collection(db,"qms_forum_profiles"));
    return snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
  } catch(e){ fbStatus(false,"Load members failed"); return []; }
};

window.fbDeleteForumProfile = async function(uid){
  try{ await deleteDoc(doc(db,"qms_forum_profiles",uid)); fbStatus(true,"Profile removed"); }
  catch(e){ fbStatus(false,"Remove failed"); }
};

// 5. FORUM THREADS
window.fbSaveThread = async function(thread){
  try{
    /* Always stamp a server timestamp so listing/ordering works.
       Without this, threads were saved without `ts` and any later
       getDocs(...orderBy("ts")) silently skipped them. */
    var toSave = Object.assign({}, thread, { ts: serverTimestamp() });
    await setDoc(doc(db,"qms_forum_threads", thread.id), toSave);
    fbStatus(true,"Thread saved");
  } catch(e){ fbStatus(false,"Thread save failed"); console.error(e); }
};

window.fbGetThreads = async function(){
  /* Do NOT use orderBy("ts") here — Firestore silently omits any document
     that doesn't have the orderBy field, so threads saved before the `ts`
     field was added would never appear. Fetch everything and sort
     client-side by `id` (which embeds Date.now()) as a stable fallback. */
  try{
    var snap = await getDocs(collection(db,"qms_forum_threads"));
    var arr = snap.docs.map(function(d){ return d.data(); });
    arr.sort(function(a,b){
      /* newest first: prefer ts.seconds, then numeric id suffix */
      var ta = (a && a.ts && typeof a.ts.seconds==='number') ? a.ts.seconds*1000 : 0;
      var tb = (b && b.ts && typeof b.ts.seconds==='number') ? b.ts.seconds*1000 : 0;
      if(!ta){
        var m=String(a&&a.id||'').match(/(\d+)/); ta = m?parseInt(m[1],10):0;
      }
      if(!tb){
        var m2=String(b&&b.id||'').match(/(\d+)/); tb = m2?parseInt(m2[1],10):0;
      }
      return tb - ta;
    });
    return arr;
  } catch(e){ fbStatus(false,"Load threads failed"); console.error(e); return []; }
};

window.fbDeleteThread = async function(threadId){
  try{ await deleteDoc(doc(db,"qms_forum_threads",threadId)); fbStatus(true,"Thread deleted"); }
  catch(e){ fbStatus(false,"Thread delete failed"); }
};

window.fbUpdateThread = async function(threadId, data){
  try{
    /* Touch `ts` on every update so existing threads without it gain one. */
    var payload = Object.assign({}, data, { ts: serverTimestamp() });
    await updateDoc(doc(db,"qms_forum_threads",threadId), payload);
  } catch(e){ console.error("Thread update failed",e); }
};

// 6. OUTLINE PDFs (per product/service)
// Firestore caps a single document at ~1,048,576 bytes. A base64-encoded PDF
// inflates by ~4/3, so a 750 KB PDF → 1 MB base64, leaving NO room for other
// fields and overflowing the limit.
//
// Solution: store a small *manifest* doc with metadata + chunk count, then
// store the base64 payload as N sibling docs of ≤700 KB each.
//
//   qms_outlines/{key}            → { name, type, size, chunks, ts }
//   qms_outlines/{key}_chunk_0    → { data: "<base64 piece>" }
//   qms_outlines/{key}_chunk_1    → { data: "<base64 piece>" }
//   ...
//
// This lets us accept files up to ~10 MB without hitting Firestore's limit.
var OUTLINE_CHUNK_BYTES = 700000;  // ~700 KB of base64 per Firestore doc

window.fbSaveOutline = async function(key, payload){
  try{
    /* Strip the `data:application/pdf;base64,` prefix to save bytes;
       we'll re-add it when reading. */
    var raw = payload.data || '';
    var commaIdx = raw.indexOf(',');
    var b64 = commaIdx>=0 ? raw.slice(commaIdx+1) : raw;
    var prefix = commaIdx>=0 ? raw.slice(0, commaIdx+1) : 'data:'+(payload.type||'application/pdf')+';base64,';

    /* Slice base64 into chunks */
    var chunks = [];
    for(var i=0;i<b64.length;i+=OUTLINE_CHUNK_BYTES){
      chunks.push(b64.slice(i, i+OUTLINE_CHUNK_BYTES));
    }
    if(chunks.length===0) chunks.push('');

    fbStatus(true,"Uploading "+chunks.length+" chunk(s)…");

    /* Clean up any previous chunks that exceed the new count (in case the
       file was previously larger). Best-effort, ignore errors. */
    try{
      var oldSnap = await getDoc(doc(db,"qms_outlines",key));
      if(oldSnap.exists()){
        var oldData = oldSnap.data();
        var oldCount = (oldData && oldData.chunks) || 0;
        for(var j=chunks.length; j<oldCount; j++){
          try{ await deleteDoc(doc(db,"qms_outlines", key+"_chunk_"+j)); }catch(_){}
        }
      }
    }catch(_){}

    /* Write all chunk docs in parallel */
    var writes = chunks.map(function(piece, idx){
      return setDoc(doc(db,"qms_outlines", key+"_chunk_"+idx), { data: piece, idx: idx });
    });
    await Promise.all(writes);

    /* Write the manifest LAST so a half-failed upload doesn't leave a stale manifest */
    await setDoc(doc(db,"qms_outlines",key), {
      name: payload.name || '',
      type: payload.type || 'application/pdf',
      size: payload.size || 0,
      chunks: chunks.length,
      prefix: prefix,
      ts: serverTimestamp()
    });
    fbStatus(true,"Outline synced ("+chunks.length+" chunk"+(chunks.length===1?'':'s')+")");
    return true;
  } catch(e){
    fbStatus(false,"Outline sync failed: "+(e&&e.message||e));
    console.error("Outline cloud save failed:",e);
    return false;
  }
};

window.fbGetOutline = async function(key){
  try{
    var manifest = await getDoc(doc(db,"qms_outlines",key));
    if(!manifest.exists()) return null;
    var m = manifest.data();
    var chunkCount = m.chunks || 0;
    if(chunkCount === 0){
      /* Legacy doc that stored data inline (pre-chunking format) */
      return { name:m.name||'', type:m.type||'application/pdf', size:m.size||0, data:m.data||'' };
    }
    /* Fetch chunks in parallel and concatenate */
    var fetches = [];
    for(var i=0;i<chunkCount;i++){
      fetches.push(getDoc(doc(db,"qms_outlines", key+"_chunk_"+i)));
    }
    var snaps = await Promise.all(fetches);
    var b64 = '';
    for(var k=0;k<snaps.length;k++){
      var s = snaps[k];
      if(s.exists()) b64 += (s.data().data || '');
    }
    var prefix = m.prefix || ('data:'+(m.type||'application/pdf')+';base64,');
    return { name:m.name||'', type:m.type||'application/pdf', size:m.size||0, data: prefix + b64 };
  } catch(e){ console.error("Outline fetch failed:",e); return null; }
};

window.fbDeleteOutline = async function(key){
  try{
    /* Look up manifest to learn how many chunks to delete */
    var manifest = await getDoc(doc(db,"qms_outlines",key));
    var chunkCount = 0;
    if(manifest.exists()) chunkCount = (manifest.data().chunks || 0);
    var deletes = [ deleteDoc(doc(db,"qms_outlines",key)) ];
    for(var i=0;i<chunkCount;i++){
      deletes.push(deleteDoc(doc(db,"qms_outlines", key+"_chunk_"+i)));
    }
    await Promise.all(deletes);
    fbStatus(true,"Outline removed from cloud");
  } catch(e){ console.error("Outline delete failed:",e); }
};

/* Lightweight index — manifests only, NEVER reads chunk docs.
   Filters out the `_chunk_N` sibling docs that hold the actual payload. */
window.fbGetOutlineIndex = async function(){
  try{
    var snap = await getDocs(collection(db,"qms_outlines"));
    var idx = {};
    snap.docs.forEach(function(d){
      var id = d.id;
      if(/_chunk_\d+$/.test(id)) return;  /* skip chunk docs */
      var data = d.data() || {};
      /* Only count it as a real outline if it has a manifest (chunks field)
         OR a legacy `data` field. This skips orphan/corrupt docs. */
      if(typeof data.chunks==='number' || data.data){
        idx[id] = { name: data.name||'', size: data.size||0, type: data.type||'application/pdf' };
      }
    });
    return idx;
  } catch(e){ console.error("Outline index fetch failed:",e); return {}; }
};

// INIT — load all cloud data on page load
(async function fbInit(){
  fbStatus(true,"Connecting...");
  try{
    var cloudConfig = await window.fbLoadSiteConfig();
    if(cloudConfig){
      var localPin = window.siteData ? window.siteData.pin : "";
      var localLogoSrc = window.siteData ? window.siteData.logoSrc : "";
      var localProdImgs = {};
      if(window.siteData && Array.isArray(window.siteData.products)){
        window.siteData.products.forEach(function(p,i){ if(p.imgSrc) localProdImgs[i]=p.imgSrc; });
      }
      window.siteData = Object.assign(window.siteData||{}, cloudConfig);
      window.siteData.pin = localPin;
      if(localLogoSrc) window.siteData.logoSrc = localLogoSrc;
      if(Array.isArray(window.siteData.products)){
        window.siteData.products.forEach(function(p,i){ if(localProdImgs[i]) p.imgSrc=localProdImgs[i]; });
      }
      localStorage.setItem("qms_sitedata", JSON.stringify(window.siteData));
      if(window.applyAllSiteData) window.applyAllSiteData();
      if(window.applyPaymentData) window.applyPaymentData();
    }
    /* NOTE: Enquiries are admin-only to read (see firestore.rules) since
       they contain customer names/emails/phone numbers. They are no
       longer fetched here on public page load — every visitor previously
       got a silent "permission denied" on this call. They're now fetched
       only after a successful admin login (see doAdminLogin in index.html). */
    var cloudThreads = await window.fbGetThreads();
    if(cloudThreads.length){
      localStorage.setItem("qms_forum_threads", JSON.stringify(cloudThreads));
      if(window.renderThreadList) window.renderThreadList();
    }
    /* Outline PDFs index — metadata only (so cards know what to show)
       The actual base64 PDF data is fetched on-demand when a client clicks Download. */
    var outlineIndex = await window.fbGetOutlineIndex();
    if(outlineIndex){
      window._outlineIndex = outlineIndex;
      /* Re-render product/service cards now that we know which have outlines */
      if(window.renderProducts) window.renderProducts();
      if(window.renderServices) window.renderServices();
    }
    fbStatus(true,"Connected ✓");
  } catch(e){
    fbStatus(false,"Connection error — using local data");
    console.error("Firebase init:",e);
  }
})();
