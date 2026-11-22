import React, { useState } from 'react';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useForm } from 'react-hook-form';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, Alert, Spinner } from '@/components/ui';
import { usePlant } from '@/context/PlantContext';
import toast from 'react-hot-toast';

export default function ProfilePage() {
  const { userProfile, firebaseUser, role } = useAuth();
  const { plants } = usePlant();
  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPwd,   setChangingPwd]   = useState(false);
  const [pwdError,      setPwdError]      = useState('');

  const { register: regProfile, handleSubmit: hsProfile } = useForm({
    defaultValues: { name: userProfile?.name ?? '', phone: userProfile?.phone ?? '', department: userProfile?.department ?? '' }
  });

  const { register: regPwd, handleSubmit: hsPwd, reset: resetPwd, formState: { errors: pwdErrors } } = useForm<{
    currentPassword: string; newPassword: string; confirmPassword: string;
  }>();

  const saveProfile = async (data: { name: string; phone: string; department: string }) => {
    if (!userProfile) return;
    setSavingProfile(true);
    try {
      await updateDoc(doc(db, 'users', userProfile.id), { ...data, updatedAt: serverTimestamp() });
      toast.success('Profile updated');
    } catch (e) { toast.error((e as Error).message); }
    finally { setSavingProfile(false); }
  };

  const changePassword = async (data: { currentPassword: string; newPassword: string; confirmPassword: string }) => {
    if (!firebaseUser?.email) return;
    if (data.newPassword !== data.confirmPassword) { setPwdError('Passwords do not match'); return; }
    setChangingPwd(true); setPwdError('');
    try {
      const cred = EmailAuthProvider.credential(firebaseUser.email, data.currentPassword);
      await reauthenticateWithCredential(firebaseUser, cred);
      await updatePassword(firebaseUser, data.newPassword);
      toast.success('Password changed'); resetPwd();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === 'auth/wrong-password') setPwdError('Current password is incorrect');
      else setPwdError('Failed to change password. Please try again.');
    } finally { setChangingPwd(false); }
  };

  const myPlants = plants.filter(p => userProfile?.plantIds?.includes(p.id));

  return (
    <div className="max-w-lg">
      <PageHeader title="My Profile" />

      {/* Avatar */}
      <div className="card mb-4">
        <div className="card-body flex items-center gap-4">
          <div className="w-14 h-14 bg-primary-100 rounded-full flex items-center justify-center text-xl font-bold text-primary-700">
            {userProfile?.name?.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="font-semibold text-gray-900">{userProfile?.name}</div>
            <div className="text-sm text-gray-500">{userProfile?.email}</div>
            <div className="text-xs text-primary-600 capitalize mt-0.5 font-medium">{role?.replace('_', ' ')}</div>
            {myPlants.length > 0 && (
              <div className="text-xs text-gray-400 mt-0.5">{myPlants.map(p => p.name).join(', ')}</div>
            )}
          </div>
        </div>
      </div>

      {/* Edit profile */}
      <div className="card mb-4">
        <div className="card-header"><h3 className="text-sm font-semibold">Profile Information</h3></div>
        <form onSubmit={hsProfile(saveProfile)} className="card-body space-y-4">
          <div>
            <label className="form-label">Full Name</label>
            <input className="form-input" {...regProfile('name')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Phone</label>
              <input className="form-input" {...regProfile('phone')} placeholder="+91 98765 43210" />
            </div>
            <div>
              <label className="form-label">Department</label>
              <input className="form-input" {...regProfile('department')} placeholder="Production" />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={savingProfile}>
            {savingProfile ? <Spinner size="sm" /> : null} Save Profile
          </button>
        </form>
      </div>

      {/* Change password */}
      <div className="card">
        <div className="card-header"><h3 className="text-sm font-semibold">Change Password</h3></div>
        <form onSubmit={hsPwd(changePassword)} className="card-body space-y-4">
          {pwdError && <Alert type="error">{pwdError}</Alert>}
          <div>
            <label className="form-label">Current Password</label>
            <input type="password" className="form-input" {...regPwd('currentPassword', { required: 'Required' })} />
            {pwdErrors.currentPassword && <p className="form-error">{pwdErrors.currentPassword.message}</p>}
          </div>
          <div>
            <label className="form-label">New Password</label>
            <input type="password" className="form-input"
              {...regPwd('newPassword', { required: 'Required', minLength: { value: 8, message: 'Min 8 characters' } })} />
            {pwdErrors.newPassword && <p className="form-error">{pwdErrors.newPassword.message}</p>}
          </div>
          <div>
            <label className="form-label">Confirm New Password</label>
            <input type="password" className="form-input" {...regPwd('confirmPassword', { required: 'Required' })} />
          </div>
          <button type="submit" className="btn-primary" disabled={changingPwd}>
            {changingPwd ? <Spinner size="sm" /> : null} Change Password
          </button>
        </form>
      </div>
    </div>
  );
}
