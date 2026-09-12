import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { fns } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, Alert, Spinner } from '@/components/ui';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { isSuperAdmin } = useAuth();
  const [testEmail,  setTestEmail]  = useState('');
  const [testLoading,setTestLoading]= useState(false);
  const [testResult, setTestResult] = useState<'success'|'error'|null>(null);

  const sendTest = async () => {
    if (!testEmail) return;
    setTestLoading(true); setTestResult(null);
    try {
      const fn = httpsCallable(fns, 'sendTestEmail');
      await fn({ to: testEmail });
      setTestResult('success');
      toast.success('Test email sent! Check your inbox.');
    } catch (e) {
      setTestResult('error');
      toast.error('Failed: ' + (e as Error).message);
    } finally { setTestLoading(false); }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" />

      {/* Email configuration */}
      <div className="card mb-4">
        <div className="card-header"><h3 className="text-sm font-semibold">📧 Email Notifications</h3></div>
        <div className="card-body space-y-4">
          <Alert type="info">
            Gmail credentials are stored securely in <strong>Google Cloud Secret Manager</strong> — not in the app. 
            To update: <code>firebase functions:secrets:set GMAIL_USER</code>
          </Alert>
          {isSuperAdmin && (
            <div>
              <label className="form-label">Test Email Configuration</label>
              <div className="flex gap-2">
                <input type="email" className="form-input" value={testEmail}
                  onChange={e => setTestEmail(e.target.value)} placeholder="Send test to…" />
                <button className="btn-secondary whitespace-nowrap" onClick={sendTest} disabled={testLoading || !testEmail}>
                  {testLoading ? <Spinner size="sm" /> : null} Send Test
                </button>
              </div>
              {testResult === 'success' && <p className="text-sm text-green-600 mt-1">✅ Test email sent successfully</p>}
              {testResult === 'error'   && <p className="text-sm text-red-600   mt-1">❌ Failed — check Cloud Function logs</p>}
            </div>
          )}
        </div>
      </div>

      {/* Notification schedule info */}
      <div className="card mb-4">
        <div className="card-header"><h3 className="text-sm font-semibold">⏰ Automated Notifications</h3></div>
        <div className="card-body">
          <div className="space-y-2 text-sm text-gray-600">
            {[
              ['Audit Assignment', 'Immediately when audit is assigned'],
              ['Audit Submission', 'Immediately when auditor submits'],
              ['Audit Approval', 'Immediately when approved'],
              ['Action Assignment', 'Immediately when action is created'],
              ['Action Verification', 'Immediately when submitted/verified/rejected'],
              ['Overdue Reminders', 'Daily at 08:00 IST via Cloud Scheduler'],
              ['Upcoming Audit Reminders', 'Daily check — notifies if due within 3 days'],
            ].map(([label, desc]) => (
              <div key={label} className="flex items-start gap-3 py-1.5 border-b border-gray-50 last:border-0">
                <div className="w-2 h-2 bg-green-500 rounded-full mt-1.5 flex-shrink-0" />
                <div><div className="font-medium text-gray-700">{label}</div><div className="text-gray-400 text-xs">{desc}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Security info */}
      {isSuperAdmin && (
        <div className="card">
          <div className="card-header"><h3 className="text-sm font-semibold">🔒 Security</h3></div>
          <div className="card-body text-sm text-gray-600 space-y-2">
            <p>• Firestore Security Rules enforce plant-level data isolation</p>
            <p>• Firebase Storage Rules limit uploads to authenticated users (max 10MB)</p>
            <p>• All privileged operations validated on Cloud Functions backend</p>
            <p>• User roles are set via Firebase custom claims (not just Firestore)</p>
            <p>• Activity logs maintained for all important operations</p>
          </div>
        </div>
      )}
    </div>
  );
}
