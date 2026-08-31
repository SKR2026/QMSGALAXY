import { useState } from 'react';
import { Plus, Shield, User } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Modal, Badge, toast } from '../components/UI';
import { PLANTS } from '../data/sampleData';

export default function Users() {
  const { users, addUser, plants } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'plant_admin', plantId: '', phone: '' });

  const handleAdd = () => {
    if (!form.name || !form.email) return;
    addUser({ ...form, status: 'active' });
    toast.success(`User ${form.name} added`);
    setShowAdd(false);
    setForm({ name: '', email: '', role: 'plant_admin', plantId: '', phone: '' });
  };

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Users</h1><p className="page-subtitle">{users.length} system users</p></div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={15} /> Add User</button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Plant</th><th>Phone</th><th>Status</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: u.role === 'superadmin' ? 'var(--primary)' : 'var(--gray-200)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: u.role === 'superadmin' ? 'white' : 'var(--gray-600)' }}>
                        {u.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </div>
                      <span style={{ fontWeight: 600 }}>{u.name}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: 13 }}>{u.email}</td>
                  <td>
                    <Badge type={u.role === 'superadmin' ? 'blue' : 'gray'}>
                      {u.role === 'superadmin' ? '⭐ Super Admin' : 'Plant Admin'}
                    </Badge>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                    {u.plantId ? PLANTS.find(p => p.id === u.plantId)?.name : 'All Plants'}
                  </td>
                  <td style={{ fontSize: 12 }}>{u.phone}</td>
                  <td><Badge type={u.status === 'active' ? 'green' : 'gray'}>{u.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showAdd && (
        <Modal title="Add User" onClose={() => setShowAdd(false)}>
          <div className="form-grid">
            <div className="form-group"><label className="form-label required">Full Name</label><input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label required">Email</label><input type="email" className="form-input" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Role</label>
              <select className="form-select" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                <option value="plant_admin">Plant Admin</option>
                <option value="superadmin">Super Admin</option>
              </select>
            </div>
            {form.role === 'plant_admin' && (
              <div className="form-group"><label className="form-label">Assign Plant</label>
                <select className="form-select" value={form.plantId} onChange={e => setForm(p => ({ ...p, plantId: e.target.value }))}>
                  <option value="">Select plant</option>
                  {plants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+91-XXXXX-XXXXX" /></div>
          </div>
          <div className="modal-footer" style={{ paddingLeft: 0, paddingRight: 0, paddingBottom: 0 }}>
            <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleAdd}>Add User</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
