import { createContext, useContext, useState, useCallback } from 'react';
import {
  PLANTS, VEHICLES, EXPENSES, USERS, EXPENSE_CATEGORIES,
  getOrgStats, getMonthlyExpenses, getPlantExpenses, getCategoryExpenses,
  getExpiringDocuments, MGMT_TOKEN
} from '../data/sampleData';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [plants, setPlants] = useState(PLANTS);
  const [vehicles, setVehicles] = useState(VEHICLES);
  const [expenses, setExpenses] = useState(EXPENSES);
  const [users, setUsers] = useState(USERS);
  const [mgmtToken, setMgmtToken] = useState(MGMT_TOKEN);
  const [notifications] = useState(getExpiringDocuments(60));
  const [auditLog, setAuditLog] = useState([
    { id: 1, action: 'LOGIN', user: 'Rajiv Mehta', detail: 'Super Admin login', ts: '2026-08-31T08:00:00' },
    { id: 2, action: 'EXPENSE_CREATE', user: 'Deepak Sharma', detail: 'Added fuel expense ₹8,500 for HR26-BX-1234', ts: '2026-08-30T14:22:00' },
    { id: 3, action: 'VEHICLE_UPDATE', user: 'Priya Nair', detail: 'Updated odometer for MH12-AB-9876', ts: '2026-08-29T11:10:00' },
    { id: 4, action: 'BULK_UPLOAD', user: 'Karthik Rajan', detail: 'Bulk upload: 47 records imported', ts: '2026-08-28T09:45:00' },
  ]);

  const [filters, setFilters] = useState({
    plantId: '',
    vehicleId: '',
    vehicleType: '',
    fuelType: '',
    category: '',
    dateFrom: '2026-01-01',
    dateTo: '2026-08-31',
  });

  const addAuditEntry = useCallback((action, user, detail) => {
    setAuditLog(prev => [{
      id: prev.length + 1,
      action,
      user,
      detail,
      ts: new Date().toISOString(),
    }, ...prev]);
  }, []);

  const filteredExpenses = useCallback(() => {
    return expenses.filter(e => {
      if (filters.plantId && e.plantId !== filters.plantId) return false;
      if (filters.vehicleId && e.vehicleId !== filters.vehicleId) return false;
      if (filters.category && e.category !== filters.category) return false;
      if (filters.dateFrom && e.date < filters.dateFrom) return false;
      if (filters.dateTo && e.date > filters.dateTo) return false;
      return true;
    });
  }, [expenses, filters]);

  const addExpense = useCallback((exp) => {
    const newExp = { ...exp, id: `exp-${Date.now()}`, createdAt: new Date().toISOString() };
    setExpenses(prev => [newExp, ...prev]);
    return newExp;
  }, []);

  const addVehicle = useCallback((vehicle) => {
    const newV = { ...vehicle, id: `v-${Date.now()}` };
    setVehicles(prev => [...prev, newV]);
    return newV;
  }, []);

  const updateVehicle = useCallback((id, updates) => {
    setVehicles(prev => prev.map(v => v.id === id ? { ...v, ...updates } : v));
  }, []);

  const addUser = useCallback((user) => {
    const newU = { ...user, id: `user-${Date.now()}` };
    setUsers(prev => [...prev, newU]);
    return newU;
  }, []);

  const regenerateMgmtToken = useCallback(() => {
    const token = `mgmt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setMgmtToken(prev => ({ ...prev, token, generatedAt: new Date().toISOString() }));
    return token;
  }, []);

  return (
    <AppContext.Provider value={{
      plants, vehicles, expenses, users, mgmtToken, notifications, auditLog, filters,
      setFilters, filteredExpenses, addExpense, addVehicle, updateVehicle, addUser,
      addAuditEntry, regenerateMgmtToken, setMgmtToken,
      orgStats: getOrgStats(filteredExpenses(), vehicles),
      monthlyExpenses: getMonthlyExpenses(filteredExpenses()),
      plantExpenses: getPlantExpenses(filteredExpenses()),
      categoryExpenses: getCategoryExpenses(filteredExpenses()),
      expCategories: EXPENSE_CATEGORIES,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
