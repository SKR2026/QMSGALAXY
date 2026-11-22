import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  LayoutDashboard, Building2, Users, ClipboardList, Calendar,
  FileCheck, AlertCircle, BarChart3, Settings, LogOut, Menu, X,
  ChevronDown, Factory, MapPin, FileText, Shield
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { usePlant } from '@/context/PlantContext';
import toast from 'react-hot-toast';

interface NavItem {
  label: string;
  path:  string;
  icon:  React.ReactNode;
  roles?: string[];
  badge?: number;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',    path: '/app/dashboard',    icon: <LayoutDashboard className="sidebar-item-icon" /> },
  { label: 'Plants',       path: '/app/plants',       icon: <Factory className="sidebar-item-icon" />,         roles: ['superadmin'] },
  { label: 'Users',        path: '/app/users',        icon: <Users className="sidebar-item-icon" />,           roles: ['superadmin', 'plant_admin'] },
  { label: 'Areas',        path: '/app/areas',        icon: <MapPin className="sidebar-item-icon" />,          roles: ['superadmin', 'plant_admin'] },
  { label: 'Templates',    path: '/app/templates',    icon: <FileText className="sidebar-item-icon" />,        roles: ['superadmin', 'plant_admin'] },
  { label: 'Schedules',    path: '/app/schedules',    icon: <Calendar className="sidebar-item-icon" />,        roles: ['superadmin', 'plant_admin', 'auditor'] },
  { label: 'Audits',       path: '/app/audits',       icon: <ClipboardList className="sidebar-item-icon" /> },
  { label: 'Actions',      path: '/app/actions',      icon: <AlertCircle className="sidebar-item-icon" /> },
  { label: 'Reports',      path: '/app/reports',      icon: <BarChart3 className="sidebar-item-icon" />,       roles: ['superadmin', 'plant_admin'] },
  { label: 'Settings',     path: '/app/settings',     icon: <Settings className="sidebar-item-icon" />,        roles: ['superadmin', 'plant_admin'] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { userProfile, role, logout } = useAuth();
  const { plants, currentPlant, setCurrentPlant } = usePlant();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [plantMenuOpen, setPlantMenuOpen] = useState(false);

  const visibleNavItems = NAV_ITEMS.filter(
    item => !item.roles || item.roles.includes(role ?? '')
  );

  const handleLogout = async () => {
    try { await logout(); navigate('/login'); }
    catch { toast.error('Failed to sign out'); }
  };

  const initials = userProfile?.name
    ? userProfile.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        'fixed inset-y-0 left-0 z-30 w-60 bg-white border-r border-gray-200 flex flex-col',
        'transform transition-transform duration-200 ease-in-out',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        'lg:translate-x-0 lg:static lg:flex'
      )}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-100">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div className="overflow-hidden">
            <div className="font-bold text-gray-900 text-sm truncate">5S Management</div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wider">Manufacturing Excellence</div>
          </div>
          <button className="ml-auto lg:hidden p-1" onClick={() => setSidebarOpen(false)}>
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Plant Selector */}
        {plants.length > 0 && (
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="relative">
              <button
                onClick={() => setPlantMenuOpen(!plantMenuOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg text-sm transition-colors"
              >
                <Building2 className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="flex-1 text-left font-medium text-gray-700 truncate">
                  {currentPlant?.name ?? 'Select Plant'}
                </span>
                <ChevronDown className={clsx('w-3.5 h-3.5 text-gray-400 transition-transform', plantMenuOpen && 'rotate-180')} />
              </button>
              {plantMenuOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 overflow-hidden">
                  {role === 'superadmin' && (
                    <button
                      onClick={() => { setCurrentPlant(null); setPlantMenuOpen(false); }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 text-primary-600 font-medium"
                    >
                      All Plants
                    </button>
                  )}
                  {plants.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setCurrentPlant(p); setPlantMenuOpen(false); }}
                      className={clsx(
                        'w-full px-3 py-2 text-left text-sm hover:bg-gray-50',
                        currentPlant?.id === p.id ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700'
                      )}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {visibleNavItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => clsx('sidebar-item', isActive && 'active')}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge ? (
                <span className="ml-auto bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {item.badge}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-3 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-primary-700">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800 truncate">{userProfile?.name}</div>
              <div className="text-xs text-gray-400 capitalize truncate">{role?.replace('_', ' ')}</div>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile topbar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 sticky top-0 z-10">
          <button onClick={() => setSidebarOpen(true)} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <Menu className="w-5 h-5 text-gray-600" />
          </button>
          <div className="font-semibold text-gray-800">5S Management</div>
          {currentPlant && (
            <div className="ml-auto text-sm text-gray-500 truncate">{currentPlant.name}</div>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
