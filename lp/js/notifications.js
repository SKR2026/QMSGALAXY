/**
 * notifications.js
 * In-app notification bell — reads from Firestore notifications collection.
 * Cloud Functions write to this collection server-side.
 */

let notifUnsubscribe = null;

function startNotificationListener() {
  if (!window.currentUser) return;

  // Stop any existing listener
  if (notifUnsubscribe) notifUnsubscribe();

  notifUnsubscribe = col('notifications')
    .where('recipientUserId', '==', window.currentUser.uid)
    .where('read', '==', false)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .onSnapshot(snap => {
      renderNotifications(snap.docs);
    }, err => {
      console.warn('[Notifications] Listener error:', err.message);
    });
}

function renderNotifications(docs) {
  const badge   = document.getElementById('notifBadge');
  const list    = document.getElementById('notifList');
  const navBadgeMap = {
    'audit_overdue':  'navBadgeAudits',
    'audit_due':      'navBadgeAudits',
    'finding_created':'navBadgeFindings',
    'action_assigned':'navBadgeActions',
    'action_overdue': 'navBadgeActions',
    'action_returned':'navBadgeActions'
  };

  const count = docs.length;

  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  // Update nav badges
  const navCounts = {};
  docs.forEach(doc => {
    const type = doc.data().type;
    const navId = navBadgeMap[type];
    if (navId) navCounts[navId] = (navCounts[navId] || 0) + 1;
  });

  Object.keys(navBadgeMap).forEach(type => {
    const navId = navBadgeMap[type];
    const el = document.getElementById(navId);
    if (!el) return;
    const cnt = navCounts[navId] || 0;
    if (cnt > 0) {
      el.textContent = cnt;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  if (docs.length === 0) {
    list.innerHTML = '<div class="notif-empty">No unread notifications</div>';
    return;
  }

  list.innerHTML = docs.map(doc => {
    const n   = doc.data();
    const id  = doc.id;
    const col = notifTypeColor(n.type);
    const time = n.createdAt ? formatDateTime(n.createdAt) : '';

    return `
      <div class="notif-item unread" onclick="handleNotifClick('${id}','${n.relatedRecordType || ''}','${n.relatedRecordId || ''}')">
        <div class="notif-dot" style="background:${col}"></div>
        <div class="notif-item-body">
          <div class="notif-item-title">${escapeHtml(n.title || 'Notification')}</div>
          <div class="notif-item-msg">${escapeHtml(n.message || '')}</div>
          <div class="notif-item-time">${time}</div>
        </div>
      </div>
    `;
  }).join('');
}

function notifTypeColor(type) {
  const map = {
    'audit_assigned':  '#1a56db',
    'audit_due':       '#d97706',
    'audit_overdue':   '#dc2626',
    'finding_created': '#7c3aed',
    'action_assigned': '#0891b2',
    'action_due':      '#d97706',
    'action_overdue':  '#dc2626',
    'action_returned': '#ea580c',
    'action_approved': '#059669',
    'action_verified': '#059669',
    'escalation':      '#dc2626'
  };
  return map[type] || '#6b7280';
}

function toggleNotifications() {
  const panel = document.getElementById('notifPanel');
  panel.classList.toggle('hidden');
}

async function handleNotifClick(notifId, recordType, recordId) {
  // Mark as read
  try {
    await col('notifications').doc(notifId).update({ read: true, readAt: firebase.firestore.FieldValue.serverTimestamp() });
  } catch (e) { /* non-critical */ }

  // Navigate to related record
  const viewMap = {
    'audit':   'audits',
    'finding': 'findings',
    'action':  'actions'
  };

  const view = viewMap[recordType];
  if (view) {
    document.getElementById('notifPanel').classList.add('hidden');
    navigate(view);
  }
}

async function markAllNotificationsRead() {
  if (!window.currentUser) return;
  try {
    const snap = await col('notifications')
      .where('recipientUserId', '==', window.currentUser.uid)
      .where('read', '==', false)
      .get();

    const batch = db.batch();
    snap.forEach(doc => {
      batch.update(doc.ref, { read: true, readAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    await batch.commit();
    showToast('All notifications marked as read', 'success');
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}

/**
 * Create a notification document (called by workflows in the frontend).
 * Cloud Functions also create notifications server-side for automated events.
 */
async function createNotification(recipientUserId, type, title, message, relatedRecordType, relatedRecordId, plantId, reminderKey) {
  // Check for duplicate (idempotent)
  if (reminderKey) {
    const existing = await col('notifications')
      .where('reminderKey', '==', reminderKey)
      .limit(1)
      .get();
    if (!existing.empty) {
      console.log('[Notifications] Duplicate skipped:', reminderKey);
      return;
    }
  }

  await col('notifications').add({
    recipientUserId,
    plantId:           plantId || null,
    type,
    title,
    message,
    relatedRecordType: relatedRecordType || null,
    relatedRecordId:   relatedRecordId || null,
    read:              false,
    sent:              false,
    escalationLevel:   0,
    createdAt:         firebase.firestore.FieldValue.serverTimestamp(),
    reminderKey:       reminderKey || null
  });
}
