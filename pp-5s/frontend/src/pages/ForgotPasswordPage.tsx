import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Shield, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Alert, Spinner } from '@/components/ui';

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<{ email: string }>();

  const onSubmit = async ({ email }: { email: string }) => {
    setError(''); setLoading(true);
    try { await resetPassword(email); setSent(true); }
    catch { setError('Failed to send reset email. Check the address and try again.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-primary-900 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-white/10 rounded-2xl mb-4">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">5S Management System</h1>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Reset your password</h2>
          <p className="text-sm text-gray-500 mb-6">Enter your email and we'll send a reset link.</p>
          {sent ? (
            <Alert type="success">Reset email sent! Check your inbox and follow the link.</Alert>
          ) : (
            <>
              {error && <div className="mb-4"><Alert type="error">{error}</Alert></div>}
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="form-label">Email address</label>
                  <input type="email" className="form-input"
                    {...register('email', { required: 'Email is required' })} />
                  {errors.email && <p className="form-error">{errors.email.message}</p>}
                </div>
                <button type="submit" disabled={loading} className="btn-primary btn-lg w-full justify-center">
                  {loading ? <Spinner size="sm" /> : 'Send Reset Link'}
                </button>
              </form>
            </>
          )}
          <Link to="/login" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mt-6">
            <ArrowLeft className="w-4 h-4" /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
