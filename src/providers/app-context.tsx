"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { UserProfile as User } from "@/types/user";

interface AppContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  showSignModal: boolean;
  setShowSignModal: (show: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// Simple provider that stores the signed-in user and whether the auth modal is open.
export function AppContextProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [showSignModal, setShowSignModal] = useState(false);

  return (
    <AppContext.Provider
      value={{
        user,
        setUser,
        showSignModal,
        setShowSignModal,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

// Backwards compatible alias — older imports can keep using AppWrapper.
export const AppWrapper = AppContextProvider;

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useAppContext must be used within an AppContextProvider");
  }
  return context;
}
