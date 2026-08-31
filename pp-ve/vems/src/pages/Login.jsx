import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const nav = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      nav('/dashboard');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const quickLogin = (e) => {
    setEmail(e);
    setPassword('password123');
  };

  return (
    <div className="login-page">
      <div style={{ width: '100%', maxWidth: 480, padding: 20 }}>
        <div className="login-card">
          <div className="login-logo">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8 }}>
              <div style={{ width: 44, height: 44, background: '#0f1724', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Truck size={24} color="white" />
              </div>
              <div style={{ textAlign: 'left' }}>
                <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f1724', lineHeight: 1.1 }}>VEMS</h1>
                <p style={{ fontSize: 11, color: 'var(--gray-400)', letterSpacing: '0.5px' }}>VEHICLE EXPENSE MANAGEMENT</p>
              </div>
            </div>
            <p style={{ fontSize: 14, color: 'var(--gray-500)', marginTop: 4 }}>Sign in to your account</p>
          </div>

          {error && (
            <div className="alert danger" style={{ marginBottom: 16 }}>
              <AlertTriangle size={15} />
              {error}
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Email address</label>
              <input type="email" className="form-input" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@orgfleet.com" required autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} className="form-input" value={password}
                  onChange={e => setPassword(e.target.value)} placeholder="••••••••••" required style={{ paddingRight: 40 }} />
                <button type="button" onClick={() => setShowPw(t => !t)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)' }}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button type="submit" className="btn btn-primary w-full" style={{ width: '100%', justifyContent: 'center', padding: '11px', fontSize: 15 }} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 16, marginTop: 20 }}>
            <p style={{ fontSize: 12, color: 'var(--gray-400)', textAlign: 'center', marginBottom: 12 }}>
              Demo accounts (password: <code style={{ background: 'var(--gray-100)', padding: '1px 6px', borderRadius: 4 }}>password123</code>)
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { label: 'Super Admin', email: 'rajiv@orgfleet.com' },
                { label: 'Plant Admin — Manesar', email: 'deepak@orgfleet.com' },
                { label: 'Plant Admin — Pune', email: 'priya@orgfleet.com' },
              ].map(u => (
                <button key={u.email} type="button" onClick={() => quickLogin(u.email)}
                  style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', textAlign: 'left', fontSize: 12, color: 'var(--gray-700)', transition: 'all 0.15s' }}>
                  <span style={{ fontWeight: 600 }}>{u.label}</span><br />
                  <span style={{ color: 'var(--gray-400)' }}>{u.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 20 }}>
          VEMS v1.0 · Fleet Expense Management System
        </p>
      </div>
    </div>
  );
}
