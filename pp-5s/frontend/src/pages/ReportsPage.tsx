import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { FileDown, FileText, BarChart2, AlertCircle } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import toast from 'react-hot-toast';
import { fns } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { usePlant } from '@/context/PlantContext';
import { PageHeader, Spinner, Alert } from '@/components/ui';
import { exportToCsv } from '@/lib/utils';

type ReportType = 'audit' | 'action';

export default function ReportsPage() {
  const { role } = useAuth();
  const { plants, currentPlant } = usePlant();
  const [type,      setType]      = useState<ReportType>('audit');
  const [dateFrom,  setDateFrom]  = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [dateTo,    setDateTo]    = useState(new Date().toISOString().split('T')[0]);
  const [plantId,   setPlantId]   = useState(currentPlant?.id ?? '');
  const [loading,   setLoading]   = useState(false);
  const [data,      setData]      = useState<Record<string, unknown>[] | null>(null);
  const [error,     setError]     = useState('');

  const runReport = async () => {
    setLoading(true); setError(''); setData(null);
    try {
      const fn = httpsCallable<unknown, { success: boolean; data: Record<string, unknown>[] }>(fns, 'generateReport');
      const result = await fn({ plantId: plantId || undefined, dateFrom, dateTo, type });
      setData(result.data.data);
      if (!result.data.data.length) toast('No records found for selected filters.', { icon: 'ℹ️' });
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  };

  const exportCsv = () => {
    if (!data) return;
    if (type === 'audit') {
      exportToCsv(
        `5s-audit-report-${dateFrom}-${dateTo}`,
        data.map(r => [r.templateName, r.plantName, r.areaName, r.auditorName, String(r.overallScore) + '%', r.approvedAt] as string[]),
        ['Audit', 'Plant', 'Area', 'Auditor', 'Score', 'Approved Date']
      );
    } else {
      exportToCsv(
        `5s-action-report-${dateFrom}-${dateTo}`,
        data.map(r => [r.finding, r.ownerName, r.priority, r.status, r.targetDate] as string[]),
        ['Finding', 'Owner', 'Priority', 'Status', 'Target Date']
      );
    }
    toast.success('CSV downloaded');
  };

  const exportPdf = () => {
    if (!data) return;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Header
    pdf.setFillColor(29, 78, 216);
    pdf.rect(0, 0, 297, 20, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(14); pdf.setFont('helvetica', 'bold');
    pdf.text('5S Management System', 14, 8);
    pdf.setFontSize(10); pdf.setFont('helvetica', 'normal');
    pdf.text(type === 'audit' ? 'Audit Performance Report' : 'Corrective Action Report', 14, 14);
    pdf.text(`Period: ${dateFrom} to ${dateTo}`, 200, 8);
    pdf.text(`Generated: ${new Date().toLocaleString()}`, 200, 14);

    pdf.setTextColor(0, 0, 0);

    if (type === 'audit') {
      autoTable(pdf, {
        startY: 25,
        head: [['Audit Template', 'Plant', 'Area', 'Auditor', 'Score', 'Approved Date']],
        body: data.map(r => [r.templateName, r.plantName, r.areaName, r.auditorName, r.overallScore + '%', r.approvedAt]),
        headStyles: { fillColor: [29, 78, 216], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        alternateRowStyles: { fillColor: [245, 247, 255] },
        didParseCell: (d) => {
          if (d.column.index === 4 && d.section === 'body') {
            const v = parseInt(String(d.cell.raw));
            d.cell.styles.textColor = v >= 90 ? [22, 163, 74] : v >= 75 ? [29, 78, 216] : v >= 60 ? [161, 98, 7] : [185, 28, 28];
            d.cell.styles.fontStyle = 'bold';
          }
        }
      });
    } else {
      autoTable(pdf, {
        startY: 25,
        head: [['Finding', 'Owner', 'Priority', 'Status', 'Target Date']],
        body: data.map(r => [r.finding, r.ownerName, r.priority, r.status, r.targetDate]),
        headStyles: { fillColor: [29, 78, 216], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 8 },
        columnStyles: { 0: { cellWidth: 90 } },
        alternateRowStyles: { fillColor: [245, 247, 255] },
      });
    }

    // Footer
    const totalPages = (pdf as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8); pdf.setTextColor(150);
      pdf.text(`Page ${i} of ${totalPages}`, 148, 205, { align: 'center' });
    }

    pdf.save(`5s-${type}-report-${dateFrom}-${dateTo}.pdf`);
    toast.success('PDF downloaded');
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Generate audit and corrective action reports"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Filters panel */}
        <div className="card">
          <div className="card-header"><h3 className="text-sm font-semibold">Report Parameters</h3></div>
          <div className="card-body space-y-4">
            {/* Report type */}
            <div>
              <label className="form-label">Report Type</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setType('audit'); setData(null); }}
                  className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                    type === 'audit' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <BarChart2 className="w-4 h-4" /> Audit
                </button>
                <button
                  onClick={() => { setType('action'); setData(null); }}
                  className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                    type === 'action' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <AlertCircle className="w-4 h-4" /> Actions
                </button>
              </div>
            </div>

            {/* Plant */}
            {role === 'superadmin' && (
              <div>
                <label className="form-label">Plant</label>
                <select className="form-select" value={plantId} onChange={e => setPlantId(e.target.value)}>
                  <option value="">All Plants</option>
                  {plants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}

            {/* Date range */}
            <div>
              <label className="form-label">From Date</label>
              <input type="date" className="form-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="form-label">To Date</label>
              <input type="date" className="form-input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>

            <button className="btn-primary w-full justify-center" onClick={runReport} disabled={loading}>
              {loading ? <Spinner size="sm" /> : <BarChart2 className="w-4 h-4" />}
              Generate Report
            </button>
          </div>
        </div>

        {/* Results panel */}
        <div className="lg:col-span-2 space-y-4">
          {error && <Alert type="error">{error}</Alert>}

          {data !== null && (
            <>
              {/* Summary */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {type === 'audit' ? 'Audit Performance Report' : 'Corrective Action Report'}
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">{dateFrom} → {dateTo} · {data.length} records</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={exportCsv} className="btn-secondary btn-sm">
                      <FileDown className="w-3.5 h-3.5" /> CSV
                    </button>
                    <button onClick={exportPdf} className="btn-secondary btn-sm">
                      <FileText className="w-3.5 h-3.5" /> PDF
                    </button>
                  </div>
                </div>

                {type === 'audit' && data.length > 0 && (
                  <div className="grid grid-cols-3 gap-4 p-4 border-b border-gray-100">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary-600">{data.length}</div>
                      <div className="text-xs text-gray-500">Audits</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {Math.round(data.reduce((s, r) => s + (Number(r.overallScore) || 0), 0) / data.length)}%
                      </div>
                      <div className="text-xs text-gray-500">Avg Score</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {data.filter(r => (Number(r.overallScore) || 0) >= 75).length}
                      </div>
                      <div className="text-xs text-gray-500">Passed (≥75%)</div>
                    </div>
                  </div>
                )}

                {/* Data table */}
                <div className="overflow-x-auto">
                  <table className="table text-xs">
                    <thead>
                      <tr>
                        {type === 'audit'
                          ? ['Audit', 'Plant', 'Area', 'Auditor', 'Score', 'Date'].map(h => <th key={h}>{h}</th>)
                          : ['Finding', 'Owner', 'Priority', 'Status', 'Target'].map(h => <th key={h}>{h}</th>)
                        }
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((r, i) => (
                        <tr key={i}>
                          {type === 'audit' ? (
                            <>
                              <td className="font-medium max-w-[150px] truncate">{r.templateName as string}</td>
                              <td>{r.plantName as string}</td>
                              <td>{r.areaName as string}</td>
                              <td>{r.auditorName as string}</td>
                              <td>
                                <span className={`font-semibold ${(Number(r.overallScore) || 0) >= 90 ? 'text-green-600' : (Number(r.overallScore) || 0) >= 75 ? 'text-blue-600' : 'text-red-600'}`}>
                                  {r.overallScore as string}%
                                </span>
                              </td>
                              <td>{r.approvedAt as string}</td>
                            </>
                          ) : (
                            <>
                              <td className="max-w-[180px] truncate">{r.finding as string}</td>
                              <td>{r.ownerName as string}</td>
                              <td>{r.priority as string}</td>
                              <td>{r.status as string}</td>
                              <td>{r.targetDate as string}</td>
                            </>
                          )}
                        </tr>
                      ))}
                      {!data.length && (
                        <tr><td colSpan={6} className="py-8 text-center text-gray-400">No records found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {data === null && !loading && !error && (
            <div className="card p-12 text-center text-gray-400">
              <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select parameters and click Generate Report</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
