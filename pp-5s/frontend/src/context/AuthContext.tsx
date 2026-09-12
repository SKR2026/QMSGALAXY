import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User as FirebaseUser, onAuthStateChanged,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from 'firebase/auth';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import type { User, UserRole } from '@/types';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  userProfile:  User | null;
  role:         UserRole | null;
  plantIds:     string[];
  loading:      boolean;
  isSuperAdmin: boolean;
  isPlantAdmin: boolean;
  canAccessPlant: (plantId: string) => boolean;
  login:        (email: string, password: string) => Promise<void>;
  logout:       () => Promise<void>;
  resetPassword:(email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userProfile,  setUserProfile]  = useState<User | null>(null);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        try {
          const snap = await getDoc(doc(db, 'users', fbUser.uid));
          if (snap.exists()) {
            setUserProfile({ id: snap.id, ...snap.data() } as User);
            // Update last login
            await updateDoc(snap.ref, { lastLoginAt: serverTimestamp() });
          }
        } catch (e) {
          console.error('Failed to load user profile', e);
        }
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const role     = userProfile?.role ?? null;
  const plantIds = userProfile?.plantIds ?? [];

  const canAccessPlant = (plantId: string) =>
    role === 'superadmin' || plantIds.includes(plantId);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    await signOut(auth);
    setUserProfile(null);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  return (
    <AuthContext.Provider value={{
      firebaseUser, userProfile, role, plantIds, loading,
      isSuperAdmin: role === 'superadmin',
      isPlantAdmin: role === 'plant_admin',
      canAccessPlant,
      login, logout, resetPassword,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
