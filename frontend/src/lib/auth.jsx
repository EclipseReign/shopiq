import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { api, setAccessToken } from "./api";

const AuthContext = createContext(null);
let connection;
function connect() {
  connection ||= api("/config").then((config) => ({
    config,
    client: config.cloud
      ? createClient(config.supabaseUrl, config.supabaseKey, {
          auth: { flowType: "pkce" },
        })
      : null,
  }));
  return connection;
}

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    client: null,
    config: null,
    session: null,
    error: "",
  });
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let mounted = true;
    let subscription;
    connect()
      .then(async ({ config, client }) => {
        if (!mounted) return;
        if (!client) {
          setState({
            loading: false,
            client,
            config,
            session: null,
            error: "",
          });
          return;
        }
        const update = (session) => {
          if (!mounted) return;
          setAccessToken(session?.access_token || "");
          setState({ loading: false, client, config, session, error: "" });
        };
        subscription = client.auth.onAuthStateChange((_event, session) =>
          update(session),
        ).data.subscription;
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        update(data.session);
      })
      .catch((error) => {
        if (mounted)
          setState((previous) => ({
            ...previous,
            loading: false,
            error: error.message,
          }));
      });
    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setAdmin(false);
    if (state.session)
      api("/me", { signal: controller.signal })
        .then((data) => setAdmin(data.admin))
        .catch(() => {});
    return () => controller.abort();
  }, [state.session?.access_token]);
  return (
    <AuthContext.Provider
      value={{ ...state, admin, user: state.session?.user || null }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
