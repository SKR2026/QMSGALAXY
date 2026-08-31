export const PLANTS = [
  { id: 'plant-a', name: 'Plant A — Manesar', code: 'MNS', location: 'Manesar, Haryana', adminId: 'admin1', status: 'active' },
  { id: 'plant-b', name: 'Plant B — Pune', code: 'PNE', location: 'Chakan, Pune', adminId: 'admin2', status: 'active' },
  { id: 'plant-c', name: 'Plant C — Chennai', code: 'CHN', location: 'Oragadam, Chennai', adminId: 'admin3', status: 'active' },
  { id: 'plant-d', name: 'Plant D — Sanand', code: 'SND', location: 'Sanand, Gujarat', adminId: 'admin4', status: 'active' },
];

export const VEHICLES = [
  { id: 'v1', regNo: 'HR26-BX-1234', make: 'Tata', model: 'Ace', type: 'LCV', fuel: 'Diesel', plantId: 'plant-a', dept: 'Logistics', driver: 'Ramesh Kumar', year: 2021, status: 'active', odometer: 84250, tankCapacity: 40, purchaseDate: '2021-03-15', insuranceExpiry: '2026-03-14', pollutionExpiry: '2025-09-30', fitnessExpiry: '2026-03-14' },
  { id: 'v2', regNo: 'HR26-CY-5678', make: 'Mahindra', model: 'Bolero', type: 'SUV', fuel: 'Diesel', plantId: 'plant-a', dept: 'Admin', driver: 'Suresh Singh', year: 2020, status: 'active', odometer: 112400, tankCapacity: 60, purchaseDate: '2020-07-20', insuranceExpiry: '2026-07-19', pollutionExpiry: '2026-01-15', fitnessExpiry: '2026-07-19' },
  { id: 'v3', regNo: 'MH12-AB-9876', make: 'Toyota', model: 'Innova', type: 'MUV', fuel: 'Diesel', plantId: 'plant-b', dept: 'Management', driver: 'Pradeep Jadhav', year: 2022, status: 'active', odometer: 54300, tankCapacity: 65, purchaseDate: '2022-01-10', insuranceExpiry: '2026-01-09', pollutionExpiry: '2026-04-20', fitnessExpiry: '2027-01-09' },
  { id: 'v4', regNo: 'MH14-CD-3456', make: 'Force', model: 'Traveller', type: 'Bus', fuel: 'Diesel', plantId: 'plant-b', dept: 'HR', driver: 'Vijay Patil', year: 2019, status: 'maintenance', odometer: 198700, tankCapacity: 90, purchaseDate: '2019-06-05', insuranceExpiry: '2025-09-15', pollutionExpiry: '2025-10-01', fitnessExpiry: '2025-09-15' },
  { id: 'v5', regNo: 'TN09-EF-7890', make: 'Ashok Leyland', model: 'Dost', type: 'LCV', fuel: 'Diesel', plantId: 'plant-c', dept: 'Logistics', driver: 'Murugan R', year: 2021, status: 'active', odometer: 73600, tankCapacity: 50, purchaseDate: '2021-09-12', insuranceExpiry: '2026-09-11', pollutionExpiry: '2026-03-10', fitnessExpiry: '2026-09-11' },
  { id: 'v6', regNo: 'GJ05-GH-2345', make: 'Maruti', model: 'Eeco', type: 'Van', fuel: 'CNG', plantId: 'plant-d', dept: 'Admin', driver: 'Haresh Patel', year: 2022, status: 'active', odometer: 41200, tankCapacity: 0, purchaseDate: '2022-05-18', insuranceExpiry: '2026-05-17', pollutionExpiry: '2026-11-20', fitnessExpiry: '2027-05-17' },
  { id: 'v7', regNo: 'HR26-IJ-6789', make: 'Isuzu', model: 'D-Max', type: 'Pickup', fuel: 'Diesel', plantId: 'plant-a', dept: 'Maintenance', driver: 'Ajay Yadav', year: 2020, status: 'active', odometer: 88900, tankCapacity: 76, purchaseDate: '2020-11-22', insuranceExpiry: '2026-11-21', pollutionExpiry: '2026-05-15', fitnessExpiry: '2026-11-21' },
  { id: 'v8', regNo: 'TN09-KL-4567', make: 'Tata', model: 'Prima', type: 'HCV', fuel: 'Diesel', plantId: 'plant-c', dept: 'Logistics', driver: 'Selvam K', year: 2018, status: 'active', odometer: 287500, tankCapacity: 300, purchaseDate: '2018-04-08', insuranceExpiry: '2026-04-07', pollutionExpiry: '2025-10-08', fitnessExpiry: '2026-04-07' },
];

export const EXPENSE_CATEGORIES = [
  'Fuel', 'Maintenance', 'Repairs', 'Spare Parts', 'Tyres', 'Battery',
  'Insurance', 'Road Tax', 'Toll', 'Parking', 'Driver Allowance',
  'Washing', 'Pollution/Fitness', 'Permit', 'Breakdown', 'Other'
];

export const FUEL_TYPES = ['Diesel', 'Petrol', 'CNG', 'Electric', 'LPG'];
export const VEHICLE_TYPES = ['LCV', 'HCV', 'SUV', 'MUV', 'Bus', 'Van', 'Pickup', 'Sedan', 'Hatchback'];

// CO2 emission factors (kg CO2 per litre)
export const CO2_FACTORS = {
  Diesel: 2.68,
  Petrol: 2.31,
  CNG: 1.95, // per kg
  LPG: 1.51,
  Electric: 0,
};

// Generate 8 months of expenses
function genExpenses() {
  const expenses = [];
  let id = 1;
  const vendors = ['HP Petroleum', 'Indian Oil', 'BPCL Pump', 'Star Auto Works', 'Speed Motors', 'National Tyres', 'Bajaj Auto Parts', 'Toll Plaza', 'Municipal Corp'];
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

  VEHICLES.forEach(v => {
    let odo = v.odometer - 15000;
    months.forEach((m, mi) => {
      // Fuel expense every month
      const fuelQty = v.type === 'HCV' ? Math.round(180 + Math.random() * 80) : v.type === 'Bus' ? Math.round(120 + Math.random() * 60) : Math.round(40 + Math.random() * 30);
      const fuelRate = v.fuel === 'Diesel' ? 90 + Math.random() * 8 : v.fuel === 'Petrol' ? 104 + Math.random() * 6 : 85 + Math.random() * 5;
      const dist = Math.round(fuelQty * (v.type === 'HCV' ? 4.5 : v.type === 'Bus' ? 5 : 8 + Math.random() * 3));
      odo += dist;

      expenses.push({
        id: `exp-${id++}`,
        vehicleId: v.id,
        plantId: v.plantId,
        date: `${m}-${String(5 + Math.floor(Math.random() * 20)).padStart(2, '0')}`,
        category: 'Fuel',
        vendor: vendors[Math.floor(Math.random() * 3)],
        invoiceNo: `INV-F-${1000 + id}`,
        amount: Math.round(fuelQty * fuelRate),
        gst: 0,
        paymentMethod: 'Cash',
        odometer: odo,
        quantity: fuelQty,
        fuelQty,
        ratePerLitre: Math.round(fuelRate * 100) / 100,
        description: `Fuel fill-up for ${v.regNo}`,
        hasBill: true,
        createdBy: 'admin1',
        createdAt: `${m}-05T09:30:00`,
      });

      // Maintenance every 2 months
      if (mi % 2 === 0) {
        expenses.push({
          id: `exp-${id++}`,
          vehicleId: v.id,
          plantId: v.plantId,
          date: `${m}-${String(10 + Math.floor(Math.random() * 10)).padStart(2, '0')}`,
          category: mi % 4 === 0 ? 'Maintenance' : 'Repairs',
          vendor: vendors[3 + Math.floor(Math.random() * 3)],
          invoiceNo: `INV-M-${2000 + id}`,
          amount: Math.round(2000 + Math.random() * 15000),
          gst: 18,
          paymentMethod: 'NEFT',
          odometer: odo + 200,
          quantity: 1,
          description: mi % 4 === 0 ? 'Periodic service' : 'Repair work',
          hasBill: true,
          createdBy: 'admin1',
          createdAt: `${m}-10T11:00:00`,
        });
      }

      // Toll monthly for logistics
      if (v.dept === 'Logistics') {
        expenses.push({
          id: `exp-${id++}`,
          vehicleId: v.id,
          plantId: v.plantId,
          date: `${m}-15`,
          category: 'Toll',
          vendor: 'NHAI Toll Plaza',
          invoiceNo: `TOLL-${3000 + id}`,
          amount: Math.round(800 + Math.random() * 1200),
          gst: 0,
          paymentMethod: 'FASTag',
          odometer: odo + 500,
          quantity: 1,
          description: 'Monthly toll charges',
          hasBill: true,
          createdBy: 'admin1',
          createdAt: `${m}-15T14:00:00`,
        });
      }
    });
  });
  return expenses;
}

export const EXPENSES = genExpenses();

export const USERS = [
  { id: 'superadmin', name: 'Rajiv Mehta', email: 'rajiv@orgfleet.com', role: 'superadmin', plantId: null, phone: '+91-98765-00001', status: 'active' },
  { id: 'admin1', name: 'Deepak Sharma', email: 'deepak@orgfleet.com', role: 'plant_admin', plantId: 'plant-a', phone: '+91-98765-00002', status: 'active' },
  { id: 'admin2', name: 'Priya Nair', email: 'priya@orgfleet.com', role: 'plant_admin', plantId: 'plant-b', phone: '+91-98765-00003', status: 'active' },
  { id: 'admin3', name: 'Karthik Rajan', email: 'karthik@orgfleet.com', role: 'plant_admin', plantId: 'plant-c', phone: '+91-98765-00004', status: 'active' },
  { id: 'admin4', name: 'Nilesh Shah', email: 'nilesh@orgfleet.com', role: 'plant_admin', plantId: 'plant-d', phone: '+91-98765-00005', status: 'active' },
];

export const MGMT_TOKEN = {
  token: 'mgmt-view-2026-secure-abc123',
  active: true,
  expiresAt: '2026-12-31',
  generatedAt: '2026-01-01',
  allowedViews: ['dashboard', 'expenses', 'co2', 'mileage', 'reports'],
};

// Helper: get stats
export function getOrgStats(expenses = EXPENSES, vehicles = VEHICLES) {
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const fuelExpenses = expenses.filter(e => e.category === 'Fuel');
  const totalFuel = fuelExpenses.reduce((s, e) => s + (e.fuelQty || 0), 0);
  const totalDist = vehicles.reduce((s, v) => s + v.odometer, 0);
  const avgMileage = totalFuel > 0 ? totalDist / totalFuel : 0;
  const co2 = fuelExpenses.reduce((s, e) => {
    const v = vehicles.find(x => x.id === e.vehicleId);
    const factor = CO2_FACTORS[v?.fuel] || 2.68;
    return s + (e.fuelQty || 0) * factor;
  }, 0);
  return {
    totalPlants: PLANTS.length,
    totalVehicles: vehicles.length,
    activeVehicles: vehicles.filter(v => v.status === 'active').length,
    totalExpenses,
    totalFuel,
    totalDist,
    avgMileage: Math.round(avgMileage * 10) / 10,
    co2: Math.round(co2),
    costPerKm: totalDist > 0 ? Math.round((totalExpenses / totalDist) * 100) / 100 : 0,
  };
}

export function getMonthlyExpenses(expenses = EXPENSES) {
  const map = {};
  expenses.forEach(e => {
    const m = e.date.substring(0, 7);
    map[m] = (map[m] || 0) + e.amount;
  });
  return Object.entries(map).sort().map(([month, amount]) => ({
    month: month.replace('2026-', 'M'),
    amount,
    fullMonth: month,
  }));
}

export function getPlantExpenses(expenses = EXPENSES) {
  return PLANTS.map(p => ({
    name: p.code,
    fullName: p.name,
    amount: expenses.filter(e => e.plantId === p.id).reduce((s, e) => s + e.amount, 0),
    vehicles: VEHICLES.filter(v => v.plantId === p.id).length,
  }));
}

export function getCategoryExpenses(expenses = EXPENSES) {
  const map = {};
  expenses.forEach(e => {
    map[e.category] = (map[e.category] || 0) + e.amount;
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([cat, amount]) => ({ cat, amount }));
}

export function getVehicleMileage(vehicleId, expenses = EXPENSES) {
  const fuelExp = expenses.filter(e => e.vehicleId === vehicleId && e.category === 'Fuel');
  const totalFuel = fuelExp.reduce((s, e) => s + (e.fuelQty || 0), 0);
  const v = VEHICLES.find(x => x.id === vehicleId);
  const totalDist = v ? v.odometer - (v.odometer - 15000) : 0; // approx
  return {
    totalFuel,
    totalDist,
    mileage: totalFuel > 0 ? Math.round((totalDist / totalFuel) * 10) / 10 : 0,
    costPerKm: v ? Math.round((fuelExp.reduce((s, e) => s + e.amount, 0) / Math.max(totalDist, 1)) * 100) / 100 : 0,
  };
}

export function getExpiringDocuments(daysThreshold = 60) {
  const today = new Date('2026-08-31');
  const alerts = [];
  VEHICLES.forEach(v => {
    const checks = [
      { label: 'Insurance', date: v.insuranceExpiry },
      { label: 'Pollution Certificate', date: v.pollutionExpiry },
      { label: 'Fitness Certificate', date: v.fitnessExpiry },
    ];
    checks.forEach(c => {
      if (!c.date) return;
      const exp = new Date(c.date);
      const diff = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
      if (diff <= daysThreshold) {
        alerts.push({
          vehicleId: v.id,
          regNo: v.regNo,
          plantId: v.plantId,
          docType: c.label,
          expiryDate: c.date,
          daysLeft: diff,
          severity: diff < 0 ? 'expired' : diff <= 15 ? 'critical' : diff <= 30 ? 'warning' : 'notice',
        });
      }
    });
  });
  return alerts.sort((a, b) => a.daysLeft - b.daysLeft);
}
