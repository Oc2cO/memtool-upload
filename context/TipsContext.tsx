import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "./AuthContext";
import { useMemories } from "./MemoriesContext";
import { TIPS, FACTS, Tip, Fact } from "../lib/dailyTips";

interface TipsContextType {
  todayTip: Tip;
  todayFact: Fact;
  favorites: string[];
  toggleFavorite: (tipId: string) => Promise<void>;
  isLoading: boolean;
}

const TipsContext = createContext<TipsContextType | null>(null);

const CATEGORY_MAPPING: Record<string, Tip["category"]> = {
  health: "wellness",
  work: "productivity",
  errand: "productivity",
  reflection: "motivation",
  idea: "motivation",
  social: "memory",
  call: "memory",
};

export function TipsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { memories } = useMemories();
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadFavorites = async () => {
      if (!user) {
        setFavorites([]);
        setIsLoading(false);
        return;
      }
      try {
        const stored = await AsyncStorage.getItem(`favorite_tips_${user.email}`);
        if (stored) {
          setFavorites(JSON.parse(stored));
        }
      } catch (e) {
        console.error("Failed to load favorites", e);
      } finally {
        setIsLoading(false);
      }
    };
    loadFavorites();
  }, [user]);

  const toggleFavorite = async (tipId: string) => {
    if (!user) return;
    const newFavorites = favorites.includes(tipId)
      ? favorites.filter((id) => id !== tipId)
      : [...favorites, tipId];
    
    setFavorites(newFavorites);
    try {
      await AsyncStorage.setItem(`favorite_tips_${user.email}`, JSON.stringify(newFavorites));
    } catch (e) {
      console.error("Failed to save favorites", e);
    }
  };

  const todayTip = useMemo(() => {
    const today = new Date();
    const dateSeed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    
    // Calculate tag distribution
    const distribution: Record<Tip["category"], number> = {
      memory: 1,
      wellness: 1,
      productivity: 1,
      motivation: 1,
    };

    memories.forEach((m: any) => {
      if (m.tags && Array.isArray(m.tags)) {
        m.tags.forEach((tag: string) => {
          const cat = CATEGORY_MAPPING[tag];
          if (cat) distribution[cat]++;
        });
      }
    });

    // Create weighted pool
    const pool: Tip[] = [];
    TIPS.forEach((tip) => {
      const weight = distribution[tip.category] || 1;
      for (let i = 0; i < weight; i++) {
        pool.push(tip);
      }
    });

    // Deterministic selection from pool
    const index = dateSeed % pool.length;
    return pool[index];
  }, [memories]);

  const todayFact = useMemo(() => {
    const today = new Date();
    const dateSeed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    const index = dateSeed % FACTS.length;
    return FACTS[index];
  }, []);

  return (
    <TipsContext.Provider
      value={{
        todayTip,
        todayFact,
        favorites,
        toggleFavorite,
        isLoading,
      }}
    >
      {children}
    </TipsContext.Provider>
  );
}

export const useTips = () => {
  const ctx = useContext(TipsContext);
  if (!ctx) throw new Error("useTips must be used within TipsProvider");
  return ctx;
};
