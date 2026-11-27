// ─────────────────────────────────────────────────────────────
//  PTMS – Reports Module
//  Auto-load · Type + Plant pills · Excel + PDF export
// ─────────────────────────────────────────────────────────────

import { db } from "./firebase.v2.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { requirePlantUser } from "./auth.v2.js";

export async function showReportsPage(container, user) {
  if (!requirePlantUser()) return;

  const thisMonth   = new Date().toISOString().slice(0,7);
  const fromDefault = `${thisMonth}-01`;
  const toDefault   = new Date().toISOString().slice(0,10);

  const typePillDefs = [
    {val:"all",        label:"All",          color:"#555"   },
    {val:"dispatched", label:"Dispatched",   color:"#1565c0"},
    {val:"received",   label:"Received",     color:"#2e7d32"},
    {val:"discrepancy",label:"Discrepancies",color:"#c62828"},
  ];

  container.innerHTML = `
    <div class="page-title">📋 Reports</div>
    <div class="card section">
      <div class="card-body">
        <div class="filter-bar" style="align-items:flex-start;gap:1.2rem;flex-wrap:wrap">

          <div>
            <div style="font-size:.78rem;font-weight:700;color:#4a4a6a;margin-bottom:.4rem">TYPE</div>
            <div id="rptPills" style="display:flex;gap:.5rem;flex-wrap:wrap">
              ${typePillDefs.map(p=>`
                <button class="rpt-pill${p.val==="all"?" active":""}" data-val="${p.val}"
                  style="padding:.38rem 1rem;border-radius:999px;border:2px solid ${p.color};
                         background:${p.val==="all"?p.color:"#fff"};
                         color:${p.val==="all"?"#fff":p.color};
                         font-weight:700;font-size:.82rem;cursor:pointer;transition:all .15s">
                  ${p.label}</button>`).join("")}
            </div>
          </div>

          <div>
            <div style="font-size:.78rem;font-weight:700;color:#4a4a6a;margin-bottom:.4rem">PLANT</div>
            <div id="rptPlantPills" style="display:flex;gap:.5rem;flex-wrap:wrap">
              <button class="rpt-plant-pill active" data-plant="" data-color="#4a4a6a"
                style="padding:.38rem 1rem;border-radius:999px;border:2px solid #4a4a6a;
                       background:#4a4a6a;color:#fff;font-weight:700;font-size:.82rem;cursor:pointer">
                🏭 All Plants</button>
            </div>
          </div>

          <div style="display:flex;gap:.7rem;align-items:flex-end;flex-wrap:wrap">
            <div>
              <label style="font-size:.78rem;font-weight:700;color:#4a4a6a;display:block;margin-bottom:.3rem">FROM</label>
              <input type="date" id="rptFrom" value="${fromDefault}"
                style="padding:.38rem .7rem;border:1.5px solid #d0d0e8;border-radius:8px;font-size:.85rem">
            </div>
            <div>
              <label style="font-size:.78rem;font-weight:700;color:#4a4a6a;display:block;margin-bottom:.3rem">TO</label>
              <input type="date" id="rptTo" value="${toDefault}"
                style="padding:.38rem .7rem;border:1.5px solid #d0d0e8;border-radius:8px;font-size:.85rem">
            </div>
          </div>

          <div style="display:flex;gap:.5rem;align-items:flex-end">
            <button id="exportXlsBtn" style="display:none;padding:.42rem 1rem;border-radius:8px;border:2px solid #1d6f42;background:#fff;color:#1d6f42;font-weight:700;font-size:.85rem;cursor:pointer">📊 Excel</button>
            <button id="exportPdfBtn" style="display:none;padding:.42rem 1rem;border-radius:8px;border:2px solid #c62828;background:#fff;color:#c62828;font-weight:700;font-size:.85rem;cursor:pointer">🖨 PDF</button>
          </div>

        </div>
      </div>
    </div>

    <div id="reportSummaryRow" class="stat-grid" style="display:none"></div>

    <div class="card section" id="reportResultCard" style="display:none">
      <div class="card-header" id="reportResultTitle">Results</div>
      <div class="card-body table-wrap" id="reportResult"><div class="spinner">Loading…</div></div>
    </div>`;

  // ── Plant pills (all users) ───────────────────────────────────
  const plantColors = ["#1565c0","#2e7d32","#6a1b9a","#e65100","#00695c","#c62828","#4527a0","#558b2f","#00838f","#ad1457"];
  const pSnap = await getDocs(collection(db,"plants"));
  const pillBox = container.querySelector("#rptPlantPills");
  pSnap.docs
    .sort((a,b)=>a.data().name.localeCompare(b.data().name))
    .forEach((d,i)=>{
      if(user.role !== "superAdmin" && d.id === user.plantId) return;
      const pd=d.data(), c=plantColors[i%plantColors.length];
      const btn=document.createElement("button");
      btn.className="rpt-plant-pill";
      btn.dataset.plant=d.id;
      btn.dataset.color=c;
      btn.dataset.name=pd.name;
      btn.textContent=pd.code||pd.name;
      btn.title=pd.name;
      Object.assign(btn.style,{padding:".38rem 1rem",borderRadius:"999px",
        border:`2px solid ${c}`,background:"#fff",color:c,
        fontWeight:"700",fontSize:".82rem",cursor:"pointer",transition:"all .15s"});
      pillBox.appendChild(btn);
    });

  let currentRows=[], currentFilters={};

  // ── Refresh ───────────────────────────────────────────────────
  async function refresh(){
    const from   =container.querySelector("#rptFrom").value;
    const to     =container.querySelector("#rptTo").value;
    const type   =container.querySelector(".rpt-pill.active")?.dataset.val||"all";
    const plantId=container.querySelector(".rpt-plant-pill.active")?.dataset.plant||"";
    const plantName=container.querySelector(".rpt-plant-pill.active")?.dataset.name||
                    container.querySelector(".rpt-plant-pill.active")?.textContent?.trim()||"All Plants";
    const typeName =container.querySelector(".rpt-pill.active")?.textContent?.trim()||"All";

    currentFilters={from,to,type:typeName,plant:plantName};
    container.querySelector("#reportResultCard").style.display="";
    container.querySelector("#reportResult").innerHTML=`<div class="spinner">Loading…</div>`;

    const result=await runReport({from,to,type,plantId,user});
    currentRows=result.rows;

    container.querySelector("#reportSummaryRow").style.display="";
    container.querySelector("#reportSummaryRow").innerHTML=`
      <div class="stat-tile"><div class="stat-label">Total Records</div><div class="stat-value">${result.total}</div></div>
      <div class="stat-tile green"><div class="stat-label">Qty Dispatched</div><div class="stat-value">${result.totalQtyDispatched.toFixed(2)}</div></div>
      <div class="stat-tile ${result.totalQtyReceived<result.totalQtyDispatched?"orange":"green"}">
        <div class="stat-label">Qty Received</div><div class="stat-value">${result.totalQtyReceived.toFixed(2)}</div></div>
      <div class="stat-tile ${result.discrepancies>0?"red":""}">
        <div class="stat-label">Discrepancies</div><div class="stat-value">${result.discrepancies}</div></div>`;

    container.querySelector("#reportResultTitle").textContent=`${result.total} Records`;
    container.querySelector("#reportResult").innerHTML=renderReportTable(result.rows);
  }

  // ── Type pills ────────────────────────────────────────────────
  const tColors={all:"#555",dispatched:"#1565c0",received:"#2e7d32",discrepancy:"#c62828"};
  container.querySelectorAll(".rpt-pill").forEach(pill=>{
    pill.addEventListener("click",()=>{
      container.querySelectorAll(".rpt-pill").forEach(p=>{
        const c=tColors[p.dataset.val];
        p.style.background="#fff";p.style.color=c;p.style.borderColor=c;p.classList.remove("active");
      });
      const c=tColors[pill.dataset.val];
      pill.style.background=c;pill.style.color="#fff";pill.style.borderColor=c;
      pill.classList.add("active");
      refresh();
    });
  });

  // ── Plant pills ───────────────────────────────────────────────
  pillBox.addEventListener("click",e=>{
    const pill=e.target.closest(".rpt-plant-pill");
    if(!pill)return;
    container.querySelectorAll(".rpt-plant-pill").forEach(p=>{
      const c=p.dataset.color||"#4a4a6a";
      p.style.background="#fff";p.style.color=c;p.style.borderColor=c;p.classList.remove("active");
    });
    const c=pill.dataset.color||"#4a4a6a";
    pill.style.background=c;pill.style.color="#fff";pill.style.borderColor=c;
    pill.classList.add("active");
    refresh();
  });

  container.querySelector("#rptFrom").addEventListener("change",refresh);
  container.querySelector("#rptTo").addEventListener("change",refresh);

  // ── Export buttons ────────────────────────────────────────────
  container.querySelector("#exportXlsBtn").addEventListener("click",()=>
    exportXlsx(currentRows,`PTMS_Report_${currentFilters.from}_${currentFilters.to}`,currentFilters));
  container.querySelector("#exportPdfBtn").addEventListener("click",()=>
    exportPdf(currentRows,currentFilters));

  refresh();
}

// ── Run Report ────────────────────────────────────────────────
async function runReport({from,to,type,plantId,user}){
  const snap=await getDocs(collection(db,"dispatches"));
  let rows=[];
  snap.forEach(d=>{
    const dp=d.data();

    if(user.role!=="superAdmin"){
      if(dp.fromPlantId!==user.plantId&&dp.toPlantId!==user.plantId)return;
    }

    if(plantId){
      if(type==="dispatched"){
        if(dp.toPlantId!==plantId)return;
      } else if(type==="received"){
        if(dp.fromPlantId!==plantId)return;
      } else {
        if(dp.fromPlantId!==plantId && dp.toPlantId!==plantId)return;
      }
    }

    if(type==="received"&&!["received","discrepancy"].includes(dp.status))return;
    if(type==="discrepancy"&&dp.status!=="discrepancy")return;

    const recordDate = dp.date ||
      (dp.createdAt?.toDate ? dp.createdAt.toDate().toISOString().slice(0,10) : null);
    if(from && recordDate && recordDate < from)return;
    if(to   && recordDate && recordDate > to  )return;

    rows.push({id:d.id,...dp});
  });
  rows.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const totalQtyDispatched=rows.reduce((s,r)=>s+(r.qtyDispatched||0),0);
  const totalQtyReceived  =rows.reduce((s,r)=>s+(r.qtyReceived  ||0),0);
  const discrepancies     =rows.filter(r=>r.status==="discrepancy").length;
  return{rows,total:rows.length,totalQtyDispatched,totalQtyReceived,discrepancies};
}

// ── Render Table ──────────────────────────────────────────────
function renderReportTable(rows){
  if(!rows.length)return`<div class="empty-state"><div class="empty-icon">📋</div><p>No records found.</p></div>`;
  const exportBtns = `
    <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-bottom:.6rem">
      <button onclick="document.getElementById('exportXlsBtn').click()" style="padding:.38rem .9rem;border-radius:8px;border:2px solid #1d6f42;background:#fff;color:#1d6f42;font-weight:700;font-size:.82rem;cursor:pointer">📊 Excel</button>
      <button onclick="document.getElementById('exportPdfBtn').click()" style="padding:.38rem .9rem;border-radius:8px;border:2px solid #c62828;background:#fff;color:#c62828;font-weight:700;font-size:.82rem;cursor:pointer">🖨 PDF</button>
    </div>`;
  let html=`<table><thead><tr>
    <th>Dispatch ID</th><th>Dispatch Date/Time</th><th>Receipt Date/Time</th><th>From</th><th>To</th>
    <th>Material</th><th>Unit</th><th>Dispatched</th><th>Received</th>
    <th>Diff</th><th>Vehicle</th><th>Driver</th><th>Status</th><th>View</th>
  </tr></thead><tbody>`;
  rows.forEach(r=>{
    const diff=r.qtyReceived!=null?r.qtyReceived-r.qtyDispatched:null;
    const ds=diff!=null?`${diff>=0?"+":""}${diff.toFixed(2)}`:"—";
    const dc=diff==null?"":diff<0?"color:#c62828":diff>0?"color:#1565c0":"color:#2e7d32";
    const dispDT=r.createdAt?.toDate?r.createdAt.toDate().toLocaleString("en-IN"):(r.date||"—");
    const recvDT=(r.arrivalDate&&r.arrivalTime)?r.arrivalDate+" "+r.arrivalTime:(r.arrivalDate||"—");
    html+=`<tr data-doc-id="${r.id}">
      <td><span class="dispatch-id">${r.dispatchId}</span></td>
      <td>${dispDT}</td><td>${recvDT}</td><td>${r.fromPlantName}</td><td>${r.toPlantName}</td>
      <td>${r.material}</td><td>${r.unit}</td>
      <td>${r.qtyDispatched}</td><td>${r.qtyReceived??"—"}</td>
      <td style="${dc};font-weight:700">${ds}</td>
      <td>${r.vehicleNo||"—"}</td><td>${r.driverName||"—"}</td>
      <td><span class="badge status-${r.status}">${statusLabel(r.status)}</span></td>
      <td style="text-align:center"><button data-vd="1" onclick="window.viewDispatch('${r.id}')"
        style="background:#1565c0;color:#fff;border:none;border-radius:7px;padding:.35rem .85rem;font-size:.82rem;font-weight:700;cursor:pointer">🔍 View</button></td>
    </tr>`;
  });
  return html+`</tbody></table>`;
}

// ── Excel Export ──────────────────────────────────────────────
async function exportXlsx(rows, filename, filters){
  if(!window.XLSX){
    await new Promise((res,rej)=>{
      const s=document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload=res;s.onerror=rej;
      document.head.appendChild(s);
    });
  }
  const X=window.XLSX;
  const headers=["Dispatch ID","Date","From Plant","To Plant","Material","Unit",
    "Qty Dispatched","Qty Received","Difference","Vehicle No","Vehicle Type",
    "Driver Name","Driver Phone","Departure Time","Arrival Date","Arrival Time",
    "E-Way Bill","Batch","Status","Remarks","Receipt Remarks"];
  const data=[headers];
  rows.forEach(r=>{
    const diff=r.qtyReceived!=null?r.qtyReceived-r.qtyDispatched:"";
    data.push([r.dispatchId,r.date,r.fromPlantName,r.toPlantName,r.material,r.unit,
      r.qtyDispatched,r.qtyReceived??"",diff,r.vehicleNo??"",r.vehicleType??"",
      r.driverName??"",r.driverPhone??"",r.departureTime??"",
      r.arrivalDate??"",r.arrivalTime??"",r.ewayBill??"",r.batch??"",r.status,
      r.remarks??"",r.receiptRemarks??""]);
  });
  const ws=X.utils.aoa_to_sheet(data);
  ws["!cols"]=[14,12,18,18,16,8,13,12,10,14,13,16,14,14,12,12,14,10,12,20,20].map(w=>({wch:w}));
  const wb=X.utils.book_new();
  X.utils.book_append_sheet(wb,ws,"PTMS Report");
  const ws2=X.utils.aoa_to_sheet([
    ["PTMS – Plant Transfer Management System"],
    ["Generated:",new Date().toLocaleString("en-IN")],
    ["Period:",`${filters.from} to ${filters.to}`],
    ["Type:",filters.type],["Plant:",filters.plant],[],
    ["Total Records",rows.length],
    ["Total Qty Dispatched",rows.reduce((s,r)=>s+(r.qtyDispatched||0),0)],
    ["Total Qty Received",  rows.reduce((s,r)=>s+(r.qtyReceived||0),0)],
    ["Discrepancies",       rows.filter(r=>r.status==="discrepancy").length],
  ]);
  ws2["!cols"]=[{wch:28},{wch:30}];
  X.utils.book_append_sheet(wb,ws2,"Summary");
  X.writeFile(wb,filename+".xlsx");
  window.showToast?.("Excel exported.","success");
}

// ── PDF Export ────────────────────────────────────────────────
function exportPdf(rows, filters){
  const logoPath=location.origin+location.pathname.replace(/\/[^/]*$/,"/")+"/assets/logo.png";
  const sColors={dispatched:"#1565c0","in-transit":"#e65100",received:"#2e7d32",discrepancy:"#c62828"};
  const tRows=rows.map(r=>{
    const diff=r.qtyReceived!=null?r.qtyReceived-r.qtyDispatched:null;
    const ds=diff!=null?`${diff>=0?"+":""}${diff.toFixed(2)}`:"—";
    const dc=diff==null?"#333":diff<0?"#c62828":diff>0?"#1565c0":"#2e7d32";
    const sc=sColors[r.status]||"#555";
    return `<tr>
      <td style="font-family:monospace;font-size:.75rem;background:#f4f6fb;padding:3px 6px;border-radius:3px">${r.dispatchId}</td>
      <td>${r.date||"—"}</td><td>${r.fromPlantName}</td><td>${r.toPlantName}</td>
      <td>${r.material}</td><td style="text-align:center">${r.unit}</td>
      <td style="text-align:right">${r.qtyDispatched}</td>
      <td style="text-align:right">${r.qtyReceived??"—"}</td>
      <td style="text-align:right;color:${dc};font-weight:700">${ds}</td>
      <td>${r.vehicleNo||"—"}</td>
      <td style="color:${sc};font-weight:700;font-size:.75rem">${statusLabel(r.status)}</td>
    </tr>`;
  }).join("");

  const totalD=rows.reduce((s,r)=>s+(r.qtyDispatched||0),0);
  const totalR=rows.reduce((s,r)=>s+(r.qtyReceived||0),0);
  const disc=rows.filter(r=>r.status==="discrepancy").length;

  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PTMS Report</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;padding:24px;font-size:.82rem}
    .hdr{display:flex;align-items:center;justify-content:space-between;
         border-bottom:3px solid #1a1a2e;padding-bottom:14px;margin-bottom:16px}
    .logo-block{display:flex;align-items:center;gap:12px}
    .logo-block img{height:56px;max-width:160px;object-fit:contain}
    .brand{font-size:1.4rem;font-weight:800;color:#1a1a2e;line-height:1}
    .brand-sub{font-size:.72rem;color:#666;margin-top:3px}
    .meta{text-align:right;font-size:.78rem;color:#555;line-height:1.6}
    .meta strong{font-size:1rem;color:#1a1a2e;display:block}
    .chips{display:flex;gap:.6rem;margin-bottom:14px;flex-wrap:wrap}
    .chip{background:#f0f2f8;padding:.28rem .8rem;border-radius:999px;font-size:.74rem;font-weight:700;color:#4a4a6a}
    .kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:.8rem;margin-bottom:16px}
    .kpi-box{background:#f8f9fc;border-radius:8px;padding:.7rem 1rem;border-top:3px solid #4f8ef7}
    .kpi-box.g{border-top-color:#2e7d32}.kpi-box.o{border-top-color:#e65100}.kpi-box.r{border-top-color:#c62828}
    .kpi-label{font-size:.68rem;font-weight:700;color:#888;text-transform:uppercase}
    .kpi-val{font-size:1.4rem;font-weight:800;color:#1a1a2e}
    table{width:100%;border-collapse:collapse;font-size:.76rem}
    th{background:#1a1a2e;color:#fff;padding:7px 7px;text-align:left;white-space:nowrap;font-size:.74rem}
    td{padding:5px 7px;border-bottom:1px solid #eef0f8;vertical-align:middle}
    tr:nth-child(even) td{background:#f8f9fc}
    .footer{margin-top:14px;font-size:.7rem;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:8px}
    @media print{@page{margin:1.2cm}body{padding:0}}
  </style></head><body>

  <div class="hdr">
    <div class="logo-block">
      <img src="${logoPath}" onerror="this.style.display='none'" alt="Logo">
      <div>
        <div class="brand">PTMS</div>
        <div class="brand-sub">Plant Transfer Management System</div>
      </div>
    </div>
    <div class="meta">
      <strong>Dispatch Report</strong>
      Generated: ${new Date().toLocaleString("en-IN")}<br>
      Period: ${filters.from} → ${filters.to}
    </div>
  </div>

  <div class="chips">
    <span class="chip">📋 Type: ${filters.type}</span>
    <span class="chip">🏭 Plant: ${filters.plant}</span>
    <span class="chip">📦 Records: ${rows.length}</span>
  </div>

  <div class="kpi">
    <div class="kpi-box"><div class="kpi-label">Total Records</div><div class="kpi-val">${rows.length}</div></div>
    <div class="kpi-box g"><div class="kpi-label">Qty Dispatched</div><div class="kpi-val">${totalD.toFixed(2)}</div></div>
    <div class="kpi-box ${totalR<totalD?"o":"g"}"><div class="kpi-label">Qty Received</div><div class="kpi-val">${totalR.toFixed(2)}</div></div>
    <div class="kpi-box ${disc>0?"r":""}"><div class="kpi-label">Discrepancies</div><div class="kpi-val">${disc}</div></div>
  </div>

  <table>
    <thead><tr>
      <th>Dispatch ID</th><th>Date</th><th>From</th><th>To</th>
      <th>Material</th><th>Unit</th><th>Dispatched</th><th>Received</th>
      <th>Diff</th><th>Vehicle</th><th>Status</th>
    </tr></thead>
    <tbody>${tRows}</tbody>
  </table>

  <div class="footer">PTMS – Plant Transfer Management System &nbsp;|&nbsp; Confidential &nbsp;|&nbsp; ${new Date().toLocaleDateString("en-IN")}</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),400);<\/script>
  </body></html>`;

  const win=window.open("","_blank");
  if(!win){alert("Allow pop-ups for PDF export");return;}
  win.document.write(html);
  win.document.close();
}

function statusLabel(s){
  return{dispatched:"Dispatched","in-transit":"In Transit",received:"Received",discrepancy:"Discrepancy"}[s]||s;
}
