import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth, AuthProvider } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import Sidebar from './components/Sidebar';
import { ToastContainer } from './components/UI';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Vehicles from './pages/Vehicles';
import Expenses from './pages/Expenses';
import Mileage from './pages/Mileage';
import CO2 from './pages/CO2';
import Reports from './pages/Reports';
import BulkUpload from './pages/BulkUpload';
import Alerts from './pages/Alerts';
import Plants from './pages/Plants';
import Users from './pages/Users';
import { AuditLog, Settings, Maintenance } from './pages/Misc';
import Management from './pages/Management';

function ProtectedLayout() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}><div style={{ width: 40, height: 40, border: '3px solid #e5e7eb', borderTopColor: '#1a56a0', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /><style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style></div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <Outlet />
      </div>
    </div>
  );
}

function SuperAdminRoute() {
  const { user } = useAuth();
  if (user?.role !== 'superadmin') return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/management" element={<Management />} />

            <Route element={<ProtectedLayout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/vehicles" element={<Vehicles />} />
              <Route path="/vehicles/:id" element={<Vehicles />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/mileage" element={<Mileage />} />
              <Route path="/co2" element={<CO2 />} />
              <Route path="/maintenance" element={<Maintenance />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/bulk" element={<BulkUpload />} />
              <Route path="/alerts" element={<Alerts />} />

              <Route element={<SuperAdminRoute />}>
                <Route path="/plants" element={<Plants />} />
                <Route path="/users" element={<Users />} />
                <Route path="/audit" element={<AuditLog />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          <ToastContainer />
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
