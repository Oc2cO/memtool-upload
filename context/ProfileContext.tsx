// App-scope read-through cache for the user personality profile.
// Paint from AsyncStorage on mount, refresh from `GET /profile` in
// the background. Backend is the source of truth; cache is just a
// fast first paint. Writes go via PUT/DELETE and update both layers.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  cacheProfile,
  clearCachedProfile,
  fetchProfile,
  loadCachedProfile,
  removeProfile,
  saveProfile,
  type UserProfile,
  type UserProfileEmpty,
  type UserProfileInput,
} from "@/lib/profile";
import { useAuth } from "./AuthContext";

type ProfileState = UserProfile | UserProfileEmpty | null;

interface ProfileContextValue {
  profile: ProfileState;
  isLoading: boolean;
  refresh: () => Promise<void>;
  save: (input: UserProfileInput) => Promise<UserProfile>;
  clear: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

function isCreated(p: ProfileState): p is UserProfile {
  return !!p && p.created === true;
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileState>(null);
  const [isLoading, setIsLoading] = useState(false);
  const lastEmail = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user?.email) return;
    try {
      const fresh = await fetchProfile(user.email);
      setProfile(fresh);
      if (isCreated(fresh)) await cacheProfile(user.email, fresh);
      else await clearCachedProfile(user.email);
    } catch {
      /* leave cached value in place; background refresh is best-effort */
    }
  }, [user?.email]);

  useEffect(() => {
    const email = user?.email ?? null;
    if (email === lastEmail.current) return;
    lastEmail.current = email;

    if (!email) {
      setProfile(null);
      setIsLoading(false);
      return;
    }

    let alive = true;
    (async () => {
      setIsLoading(true);
      const cached = await loadCachedProfile(email);
      if (alive && cached) setProfile(cached);
      try {
        const fresh = await fetchProfile(email);
        if (!alive) return;
        setProfile(fresh);
        if (isCreated(fresh)) await cacheProfile(email, fresh);
        else await clearCachedProfile(email);
      } catch {
        /* keep cache */
      } finally {
        if (alive) setIsLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [user?.email]);

  const save = useCallback(
    async (input: UserProfileInput): Promise<UserProfile> => {
      if (!user?.email) throw new Error("save: not signed in");
      const saved = await saveProfile(user.email, input);
      setProfile(saved);
      await cacheProfile(user.email, saved);
      return saved;
    },
    [user?.email],
  );

  const clear = useCallback(async () => {
    if (!user?.email) return;
    await removeProfile(user.email);
    await clearCachedProfile(user.email);
    setProfile(null);
  }, [user?.email]);

  return (
    <ProfileContext.Provider value={{ profile, isLoading, refresh, save, clear }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside <ProfileProvider>");
  return ctx;
}
