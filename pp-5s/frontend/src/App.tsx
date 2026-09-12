import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { PlantProvider } from '@/context/PlantContext';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingScreen } from '@/components/ui';

// Lazy-loaded pages
const LoginPage          = lazy(() => import('@/pages/LoginPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'));
const DashboardPage      = lazy(() => import('@/pages/DashboardPage'));
const PlantsPage         = lazy(() => import('@/pages/PlantsPage'));
const UsersPage          = lazy(() => import('@/pages/UsersPage'));
const AreasPage          = lazy(() => import('@/pages/AreasPage'));
const TemplatesPage      = lazy(() => import('@/pages/TemplatesPage'));
const TemplateDetailPage = lazy(() => import('@/pages/TemplateDetailPage'));
const SchedulesPage      = lazy(() => import('@/pages/SchedulesPage'));
const AuditsPage         = lazy(() => import('@/pages/AuditsPage'));
const AuditDetailPage    = lazy(() => import('@/pages/AuditDetailPage'));
const ConductAuditPage   = lazy(() => import('@/pages/ConductAuditPage'));
const ActionsPage        = lazy(() => import('@/pages/ActionsPage'));
const ActionDetailPage   = lazy(() => import('@/pages/ActionDetailPage'));
const ReportsPage        = lazy(() => import('@/pages/ReportsPage'));
const SettingsPage       = lazy(() => import('@/pages/SettingsPage'));
const ProfilePage        = lazy(() => import('@/pages/ProfilePage'));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { firebaseUser, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!firebaseUser) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireRole({ children, roles }: { children: React.ReactNode; roles: string[] }) {
  const { role } = useAuth();
  if (!role || !roles.includes(role)) return <Navigate to="/app/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login"           element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/" element={<Navigate to="/app/dashboard" replace />} />

      {/* Protected */}
      <Route path="/app" element={
        <RequireAuth>
          <PlantProvider>
            <AppShell>
              <Suspense fallback={<LoadingScreen />}>
                <Routes>
                  <Route path="dashboard"          element={<DashboardPage />} />
                  <Route path="plants"             element={<RequireRole roles={['superadmin']}><PlantsPage /></RequireRole>} />
                  <Route path="users"              element={<RequireRole roles={['superadmin', 'plant_admin']}><UsersPage /></RequireRole>} />
                  <Route path="areas"              element={<AreasPage />} />
                  <Route path="templates"          element={<TemplatesPage />} />
                  <Route path="templates/:id"      element={<TemplateDetailPage />} />
                  <Route path="schedules"          element={<SchedulesPage />} />
                  <Route path="audits"             element={<AuditsPage />} />
                  <Route path="audits/:id"         element={<AuditDetailPage />} />
                  <Route path="audits/:id/conduct" element={<ConductAuditPage />} />
                  <Route path="actions"            element={<ActionsPage />} />
                  <Route path="actions/:id"        element={<ActionDetailPage />} />
                  <Route path="reports"            element={<RequireRole roles={['superadmin', 'plant_admin']}><ReportsPage /></RequireRole>} />
                  <Route path="settings"           element={<RequireRole roles={['superadmin', 'plant_admin']}><SettingsPage /></RequireRole>} />
                  <Route path="profile"            element={<ProfilePage />} />
                  <Route path="*"                  element={<Navigate to="dashboard" replace />} />
                </Routes>
              </Suspense>
            </AppShell>
          </PlantProvider>
        </RequireAuth>
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter basename="/pp-5S">
      <AuthProvider>
        <AppRoutes />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: { fontSize: '13px', maxWidth: '380px' },
            success: { iconTheme: { primary: '#22c55e', secondary: '#fff' } },
            error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  );
}
