import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  apiLogin,
  apiLogout,
  apiMe,
  apiRegister,
  clearToken,
  getToken,
  type User,
} from "@/lib/auth";
import { apiUpdateDisplayName, apiDeleteAccount, apiGetAvatar } from "@/lib/accountApi";
import { clearAiEngineCache } from "@/lib/aiEngineStorage";
import { setSentryUser } from "@/lib/sentry";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  hasSeenOnboarding: boolean;
  login: (email: string, pass: string) => Promise<void>;
  signup: (email: string, pass: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  updateAvatar: (uri: string | null) => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function displayNameKey(email: string): string {
  return `mt_display_name_${email}`;
}

function avatarKey(email: string): string {
  return `mt_avatar_${email}`;
}

async function clearLocalUserData(user: User | null): Promise<void> {
  if (!user?.email) return;

  const email = user.email;
  const userId = user.id;

  await Promise.allSettled([
    AsyncStorage.removeItem(displayNameKey(email)),
    AsyncStorage.removeItem(avatarKey(email)),
    AsyncStorage.removeItem(`mt_profile_${email}`),
    AsyncStorage.removeItem(`syncOutbox_${email}`),
    AsyncStorage.removeItem(`mt_review_asked_${email}`),
    AsyncStorage.removeItem(`mt_account_first_seen_${email}`),
    ...(userId ? [AsyncStorage.removeItem(`mt_ai_guide_thread_v1:${userId}`)] : []),
    AsyncStorage.removeItem("mt_ai_guide_count_v1"),
    AsyncStorage.removeItem(`memories_${email}`),
    ...(userId ? [AsyncStorage.removeItem(`memories_${userId}`)] : []),
    clearAiEngineCache(email),
  ]);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(false);

  // Tag the Sentry scope with the signed-in user id (no email) so
  // events show who hit them. Cleared on logout / account deletion
  // by passing null to setSentryUser.
  useEffect(() => {
    setSentryUser(user?.id ?? null);
  }, [user?.id]);

  useEffect(() => {
    const loadState = async () => {
      try {
        const onboardingFlag = await AsyncStorage.getItem("hasSeenOnboarding");
        if (onboardingFlag) setHasSeenOnboarding(true);

        const token = await getToken();
        if (token) {
          try {
            const { user: me } = await apiMe();
            const email = me.email;
            const storedName = email
              ? await AsyncStorage.getItem(displayNameKey(email))
              : null;
            const storedAvatar = email
              ? await AsyncStorage.getItem(avatarKey(email))
              : null;
            setUser({
              ...me,
              ...(storedName ? { display_name: storedName } : {}),
              ...(storedAvatar ? { avatar_uri: storedAvatar } : {}),
            });
            // Fetch the server-side avatar in the background so a fresh
            // install / new device picks up the persisted picture even
            // when AsyncStorage has nothing cached (Task #309). If the
            // server has a different URL than the cache, prefer the
            // server copy and update the cache.
            if (email) {
              apiGetAvatar()
                .then(async (serverUrl) => {
                  if (serverUrl && serverUrl !== storedAvatar) {
                    await AsyncStorage.setItem(avatarKey(email), serverUrl);
                    setUser((prev) =>
                      prev ? { ...prev, avatar_uri: serverUrl } : prev,
                    );
                  }
                })
                .catch(() => {});
            }
          } catch {
            await clearToken();
            setUser(null);
          }
        }
      } catch {
        // ignore — leave user null
      } finally {
        setIsLoading(false);
      }
    };
    loadState();
  }, []);

  const login = async (email: string, pass: string) => {
    const { user: u } = await apiLogin(email, pass);
    const storedName = u.email
      ? await AsyncStorage.getItem(displayNameKey(u.email))
      : null;
    const storedAvatar = u.email
      ? await AsyncStorage.getItem(avatarKey(u.email))
      : null;
    // Fetch the server-side avatar so signing in on a new device pulls
    // the previously-uploaded picture from App Storage (Task #309).
    let serverAvatar: string | null = null;
    try {
      serverAvatar = await apiGetAvatar();
    } catch {
      // ignore — fall back to cached value
    }
    const effectiveAvatar = serverAvatar ?? storedAvatar;
    if (u.email && serverAvatar && serverAvatar !== storedAvatar) {
      try {
        await AsyncStorage.setItem(avatarKey(u.email), serverAvatar);
      } catch {
        // ignore storage failures
      }
    }
    setUser({
      ...u,
      ...(storedName ? { display_name: storedName } : {}),
      ...(effectiveAvatar ? { avatar_uri: effectiveAvatar } : {}),
    });
  };

  const signup = async (email: string, pass: string, displayName: string) => {
    const { user: u } = await apiRegister(email, pass, displayName);
    setUser(u);
  };

  const logout = async () => {
    const currentUser = user;
    await clearLocalUserData(currentUser);
    await apiLogout();
    setUser(null);
  };

  const completeOnboarding = async () => {
    await AsyncStorage.setItem("hasSeenOnboarding", "true");
    setHasSeenOnboarding(true);
  };

  const updateDisplayName = async (name: string) => {
    if (!user?.email) throw new Error("updateDisplayName: not signed in");
    const trimmed = name.trim();
    setUser((prev) => (prev ? { ...prev, display_name: trimmed } : prev));
    await AsyncStorage.setItem(displayNameKey(user.email), trimmed);
    try {
      await apiUpdateDisplayName(trimmed);
    } catch {
      // Server sync failed — local state and AsyncStorage are still updated.
    }
  };

  const updateAvatar = async (uri: string | null) => {
    if (!user?.email) throw new Error("updateAvatar: not signed in");
    setUser((prev) => (prev ? { ...prev, avatar_uri: uri ?? undefined } : prev));
    try {
      if (uri) {
        await AsyncStorage.setItem(avatarKey(user.email), uri);
      } else {
        await AsyncStorage.removeItem(avatarKey(user.email));
      }
    } catch {
      // ignore storage failures — in-memory state is already updated
    }
  };

  const deleteAccount = async () => {
    if (!user?.email) throw new Error("deleteAccount: not signed in");
    // Call the server first so a network failure surfaces before we wipe local state.
    await apiDeleteAccount();
    // Wipe all local data tied to this account.
    await clearLocalUserData(user);
    // Sign out — clears the auth token and resets user state.
    await apiLogout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      hasSeenOnboarding,
      login,
      signup,
      logout,
      completeOnboarding,
      updateDisplayName,
      updateAvatar,
      deleteAccount,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
