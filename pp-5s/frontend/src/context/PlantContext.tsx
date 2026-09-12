import React, { createContext, useContext, useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from './AuthContext';
import type { Plant } from '@/types';

interface PlantContextValue {
  plants:       Plant[];
  currentPlant: Plant | null;
  setCurrentPlant: (plant: Plant | null) => void;
  loadingPlants: boolean;
}

const PlantContext = createContext<PlantContextValue | null>(null);

export function PlantProvider({ children }: { children: React.ReactNode }) {
  const { userProfile, isSuperAdmin } = useAuth();
  const [plants,        setPlants]        = useState<Plant[]>([]);
  const [currentPlant,  setCurrentPlantState] = useState<Plant | null>(null);
  const [loadingPlants, setLoadingPlants] = useState(true);

  useEffect(() => {
    if (!userProfile) { setPlants([]); setLoadingPlants(false); return; }

    const loadPlants = async () => {
      try {
        let q;
        if (isSuperAdmin) {
          q = query(collection(db, 'plants'), where('status', '==', 'active'), orderBy('name'));
        } else {
          if (!userProfile.plantIds.length) { setPlants([]); setLoadingPlants(false); return; }
          q = query(
            collection(db, 'plants'),
            where('__name__', 'in', userProfile.plantIds.slice(0, 10)),
            where('status', '==', 'active')
          );
        }
        const snap = await getDocs(q);
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Plant));
        setPlants(list);
        // Auto-select first plant if none selected
        if (!currentPlant && list.length > 0) {
          const stored = localStorage.getItem('5s_current_plant');
          const found  = stored ? list.find(p => p.id === stored) : null;
          setCurrentPlantState(found || list[0]);
        }
      } catch (e) {
        console.error('Failed to load plants', e);
      } finally {
        setLoadingPlants(false);
      }
    };

    loadPlants();
  }, [userProfile, isSuperAdmin]);

  const setCurrentPlant = (plant: Plant | null) => {
    setCurrentPlantState(plant);
    if (plant) localStorage.setItem('5s_current_plant', plant.id);
    else localStorage.removeItem('5s_current_plant');
  };

  return (
    <PlantContext.Provider value={{ plants, currentPlant, setCurrentPlant, loadingPlants }}>
      {children}
    </PlantContext.Provider>
  );
}

export function usePlant() {
  const ctx = useContext(PlantContext);
  if (!ctx) throw new Error('usePlant must be used within PlantProvider');
  return ctx;
}
