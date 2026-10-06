/**
 * calendar.js
 * Audit calendar view with monthly grid and status indicators.
 */

let calendarYear  = new Date().getFullYear();
let calendarMonth = new Date().getMonth(); // 0-indexed

async function renderCalendar() {
  await buildCalendarGrid();
}

function prevMonth() {
  calendarMonth--;
  if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
  buildCalendarGrid();
}

function nextMonth() {
  calendarMonth++;
  if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
  buildCalendarGrid();
}

async function buildCalendarGrid() {
  const label = document.getElementById('calendarMonthLabel');
  if (label) {
    label.textContent = new Date(calendarYear, calendarMonth, 1)
      .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }

  const grid = document.getElementById('calendarGrid');
  if (!grid) return;

  // Date range for the month
  const firstDay = new Date(calendarYear, calendarMonth, 1);
  const lastDay  = new Date(calendarYear, calendarMonth + 1, 0);
  const fromStr  = firstDay.toISOString().split('T')[0];
  const toStr    = lastDay.toISOString().split('T')[0];

  // Load audits for the month
  const user    = window.currentUser;
  const plantId = getActivePlantId();

  let query = col('audits').where('plannedDate', '>=', fromStr).where('plannedDate', '<=', toStr);
  if (plantId) query = query.where('plantId', '==', plantId);
  else if (user.role !== ROLES.SUPER_ADMIN) query = query.where('plantId', '==', user.plantId);

  let auditsByDate = {};
  try {
    const snap = await query.get();
    snap.forEach(doc => {
      const a   = doc.data();
      const key = a.plannedDate;
      if (!auditsByDate[key]) auditsByDate[key] = [];
      auditsByDate[key].push({ id: doc.id, ...a });
    });
  } catch (e) {
    console.warn('[Calendar] Load error:', e.message);
  }

  // Build grid HTML
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const today    = todayISO();

  let html = `
    <div class="cal-header-row">
      ${dayNames.map(d => `<div class="cal-day-name">${d}</div>`).join('')}
    </div>
    <div class="cal-days-grid">
  `;

  // Pad start of month
  const startPad = firstDay.getDay();
  const prevMonth_ = new Date(calendarYear, calendarMonth, 0);

  for (let i = startPad - 1; i >= 0; i--) {
    html += `<div class="cal-cell other-month"><div class="cal-date">${prevMonth_.getDate() - i}</div></div>`;
  }

  // Days of month
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const dateStr   = `${calendarYear}-${String(calendarMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday   = dateStr === today;
    const dayAudits = auditsByDate[dateStr] || [];

    const auditDots = dayAudits.slice(0,3).map(a => {
      const color = auditStatusColor(a.status);
      return `<div class="cal-audit-dot" style="background:${color}20;color:${color};border:1px solid ${color}40"
               onclick="showCalendarDetail('${dateStr}');event.stopPropagation()"
               title="${a.status} — ${a.processName || a.id}">
               ${a.status === 'Overdue' ? '⚠' : '●'} ${(a.processName || a.id).substring(0,12)}
             </div>`;
    }).join('');

    const moreText = dayAudits.length > 3 ? `<div style="font-size:10px;color:var(--color-text-muted)">+${dayAudits.length - 3} more</div>` : '';

    html += `
      <div class="cal-cell ${isToday ? 'today' : ''}" onclick="showCalendarDetail('${dateStr}')">
        <div class="cal-date">${day}</div>
        ${auditDots}
        ${moreText}
      </div>
    `;
  }

  // Pad end
  const endPad = 6 - lastDay.getDay();
  for (let i = 1; i <= endPad; i++) {
    html += `<div class="cal-cell other-month"><div class="cal-date">${i}</div></div>`;
  }

  html += '</div>';
  grid.innerHTML = html;
}

async function showCalendarDetail(dateStr) {
  const detailCard = document.getElementById('calendarDayDetail');
  const detailDate = document.getElementById('calDetailDate');
  const detailList = document.getElementById('calDetailList');
  if (!detailCard) return;

  const d = new Date(dateStr + 'T00:00:00');
  detailDate.textContent = `Audits for ${d.toLocaleDateString('en-IN', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}`;

  try {
    const user    = window.currentUser;
    const plantId = getActivePlantId();
    let query = col('audits').where('plannedDate', '==', dateStr);
    if (plantId) query = query.where('plantId', '==', plantId);
    else if (user.role !== ROLES.SUPER_ADMIN) query = query.where('plantId', '==', user.plantId);

    const snap   = await query.get();
    const audits = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (audits.length === 0) {
      detailList.innerHTML = '<p class="text-muted" style="padding:16px">No audits scheduled for this day.</p>';
    } else {
      detailList.innerHTML = audits.map(a => `
        <div style="padding:12px 20px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:12px">
          <div style="flex:1">
            <div class="fw-600">${escapeHtml(a.processName || a.id)}</div>
            <div class="text-muted text-sm">${escapeHtml(a.departmentName)} · Level ${a.levelNumber} · ${escapeHtml(a.auditorName)}</div>
          </div>
          <div>${getAuditStatusBadge(a.status)}</div>
          <div>
            ${['Assigned','In Progress'].includes(a.status)
              ? `<button class="btn btn-primary btn-sm" onclick="openAuditExecution('${a.id}')">Execute</button>`
              : `<button class="btn btn-secondary btn-sm" onclick="viewAuditReport('${a.id}')">View</button>`}
          </div>
        </div>
      `).join('');
    }

    detailCard.classList.remove('hidden');
    detailCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (e) {
    detailList.innerHTML = `<p class="text-muted" style="padding:16px">${friendlyFirebaseError(e)}</p>`;
  }
}

function closeCalendarDetail() {
  document.getElementById('calendarDayDetail')?.classList.add('hidden');
}

function auditStatusColor(status) {
  const map = {
    'Planned':     '#6b7280',
    'Assigned':    '#1a56db',
    'In Progress': '#d97706',
    'Submitted':   '#7c3aed',
    'Under Review':'#7c3aed',
    'Verified':    '#059669',
    'Closed':      '#374151',
    'Overdue':     '#dc2626',
    'Cancelled':   '#9ca3af'
  };
  return map[status] || '#6b7280';
}
