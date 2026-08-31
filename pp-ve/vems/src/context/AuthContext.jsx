import { createContext, useContext, useState, useEffect } from 'react';
import { USERS, MGMT_TOKEN } from '../data/sampleData';

const AuthContext = createContext(null);

// Demo auth - replace with Firebase Auth in production
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('vems_user');
    if (saved) {
      try { setUser(JSON.parse(saved)); } catch {}
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    // Demo: match against sample users
    const found = USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!found) throw new Error('User not found');
    // Demo password: "password123" for all
    if (password !== 'password123') throw new Error('Invalid password');
    setUser(found);
    localStorage.setItem('vems_user', JSON.stringify(found));
    return found;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('vems_user');
  };

  const checkMgmtToken = (token) => {
    return token === MGMT_TOKEN.token && MGMT_TOKEN.active;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, checkMgmtToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
