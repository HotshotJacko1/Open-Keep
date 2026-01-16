import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface SessionContextType {
  session: Session | null;
  supabase: typeof supabase;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const SessionContextProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSession(session);
        setLoading(false);
      } else {
        // Attempt anonymous sign-in
        supabase.auth.signInAnonymously().then(async ({ data, error }) => {
          if (!error && data.session) {
            setSession(data.session);

            // Create a new user record in the public Users table
            const { error: insertError } = await supabase
              .from('Users')
              .insert({
                user_id: data.session.user.id
              });

            if (insertError) {
              console.error("Error creating user record:", insertError);
            } else {
              console.log("New user record created in public.Users");
            }
          } else {
            console.error("Anonymous sign-in failed:", error);
          }
          setLoading(false);
        });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // We don't block UI for loading anymore to support offline-first/optimistic UI
  // if (loading) {
  //   return <div className="min-h-screen flex items-center justify-center text-lg">Loading authentication...</div>;
  // }

  return (
    <SessionContext.Provider value={{ session, supabase }}>
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionContextProvider');
  }
  return context;
};